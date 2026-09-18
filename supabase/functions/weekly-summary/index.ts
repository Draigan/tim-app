import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Push-service contact address only. Never used to decide who sees what.
const VAPID_CONTACT = (Deno.env.get('VAPID_CONTACT_EMAIL') ?? 'd@d.d').trim().toLowerCase()
const DEFAULT_SUPERUSER_EMAILS = ['d@d.d']
const CALENDAR_URL = '/calendar'
const SUPERUSER_ROLES = new Set(['superuser'])

// The push banner is short by nature; the inbox row carries the full week.
const MAX_PUSH_BODY_LENGTH = 180
const MAX_PUSH_EVENTS = 3
const MAX_INBOX_EVENTS = 25

webpush.setVapidDetails(
  `mailto:${VAPID_CONTACT}`,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-weekly-summary-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }

  return diff === 0
}

function authorizeCron(req: Request): Response | null {
  const expected = Deno.env.get('WEEKLY_SUMMARY_CRON_SECRET')?.trim()
  if (!expected) return json({ error: 'Weekly summary cron secret is not configured.' }, 500)

  const supplied = req.headers.get('x-weekly-summary-cron-secret')?.trim() ?? ''
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return json({ error: 'Forbidden' }, 403)
  }

  return null
}

function emailsFromEnv(name: string, fallback: string[] = []): string[] {
  const raw = Deno.env.get(name)
  const values = raw
    ? raw.split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
    : []
  return values.length ? values : fallback
}

const SUPERUSER_EMAILS = emailsFromEnv('SUPERUSER_EMAILS', DEFAULT_SUPERUSER_EMAILS)

// Legacy "admin" users are owner-level too, matching app_private.current_user_is_owner().
const OWNER_ROLES = new Set(['owner', 'admin'])

function userHasRole(user: any, allowed: Set<string>): boolean {
  const metadata = user?.app_metadata ?? {}
  const role = metadata.role
  if (typeof role === 'string' && allowed.has(role.toLowerCase())) return true

  const roles = metadata.roles
  if (Array.isArray(roles)) return roles.some(item => allowed.has(String(item).toLowerCase()))
  if (roles && typeof roles === 'object') {
    return [...allowed].some(item => Boolean(roles[item]))
  }

  return false
}

function isSuperuserAccount(user: any): boolean {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : ''
  return userHasRole(user, SUPERUSER_ROLES) || SUPERUSER_EMAILS.includes(email)
}

// Everyone the staff inbox policy lets read a row, so push and inbox agree.
function isManagerAccount(user: any): boolean {
  return isSuperuserAccount(user) || userHasRole(user, OWNER_ROLES)
}

// Owners plus every superuser, by role. Paged high enough that the account list
// cannot outgrow the lookup the way the single-admin lookups elsewhere can.
async function recipientIds(): Promise<string[]> {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  return users.filter(isManagerAccount).map(user => user.id)
}

function dateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return dateStr(d)
}

function dayLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function timeLabel(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const [h, m] = value.split(':')
  const hour = Number(h)
  if (!Number.isFinite(hour)) return ''
  return ` ${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

function eventLine(event: any, weekStart: string, weekEnd: string): string {
  // An event that runs into the week from before it still belongs on the day
  // the week opens, not on a date the reader cannot see.
  const from = event.from_date < weekStart ? weekStart : event.from_date
  const spans = event.to_date > from
  const through = spans ? ` → ${dayLabel(event.to_date > weekEnd ? weekEnd : event.to_date)}` : ''
  return `${dayLabel(from)}${timeLabel(event.start_time)}${through} · ${event.title}`
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

async function sendPush(targetIds: string[], payload: string) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', targetIds)
  if (!subs?.length) return 0

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  )

  const stale = subs.filter((_, i) => {
    const result = results[i]
    const code = result.status === 'rejected' ? (result.reason as any)?.statusCode : null
    return code === 410 || code === 404
  })
  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale.map(s => s.endpoint))
  }

  return results.filter(r => r.status === 'fulfilled').length
}

async function createAppNotification(title: string, body: string, metadata: Record<string, unknown>) {
  // Filed as staff so both the owner and the superuser can read it back.
  const { error } = await supabase.from('app_notifications').insert({
    audience: 'staff',
    title,
    body,
    url: CALENDAR_URL,
    type: 'weekly_summary',
    severity: 'info',
    metadata,
  })

  if (error) throw error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorizationError = authorizeCron(req)
  if (authorizationError) return authorizationError

  try {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const weekStart = dateStr(today)
    const weekEnd = addDays(weekStart, 6)

    // Anything overlapping the week, so a run that started earlier still shows.
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('id, title, from_date, to_date, start_time')
      .lte('from_date', weekEnd)
      .gte('to_date', weekStart)
      .order('from_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })

    if (error) throw error

    const list = events ?? []
    const title = list.length
      ? `Week ahead · ${list.length} event${list.length === 1 ? '' : 's'}`
      : 'Week ahead · nothing scheduled'

    const lines = list.slice(0, MAX_INBOX_EVENTS).map(e => eventLine(e, weekStart, weekEnd))
    const inboxExtra = list.length > MAX_INBOX_EVENTS ? [`+${list.length - MAX_INBOX_EVENTS} more`] : []
    const inboxBody = list.length
      ? [...lines, ...inboxExtra].join('\n')
      : `Nothing on the calendar for ${dayLabel(weekStart)} – ${dayLabel(weekEnd)}.`

    const pushLines = lines.slice(0, MAX_PUSH_EVENTS)
    const pushExtra = list.length > MAX_PUSH_EVENTS ? ` +${list.length - MAX_PUSH_EVENTS} more` : ''
    const pushBody = truncate(
      list.length ? `${pushLines.join(' · ')}${pushExtra}` : inboxBody,
      MAX_PUSH_BODY_LENGTH,
    )

    const metadata = {
      week_start: weekStart,
      week_end: weekEnd,
      event_count: list.length,
      event_ids: list.map(e => e.id),
    }

    const targetIds = await recipientIds()
    const results = await Promise.allSettled([
      createAppNotification(title, inboxBody, metadata),
      targetIds.length
        ? sendPush(targetIds, JSON.stringify({ title, body: pushBody, url: CALENDAR_URL }))
        : Promise.resolve(0),
    ])

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Weekly summary delivery failed.', result.reason)
      }
    }

    const sent = results[1].status === 'fulfilled' ? results[1].value : 0
    return json({ ok: true, week_start: weekStart, week_end: weekEnd, events: list.length, sent })
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
