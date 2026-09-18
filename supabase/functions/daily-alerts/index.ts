import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Push-service contact address only. Never used to decide who sees what.
const VAPID_CONTACT = (Deno.env.get('VAPID_CONTACT_EMAIL') ?? 'd@d.d').trim().toLowerCase()
const DEFAULT_SUPERUSER_EMAILS = ['d@d.d']
const SUPERUSER_ROLES = new Set(['superuser'])
// Legacy "admin" users are owner-level too, matching app_private.current_user_is_owner().
const OWNER_ROLES = new Set(['owner', 'admin'])

function emailsFromEnv(name: string, fallback: string[] = []): string[] {
  const raw = Deno.env.get(name)
  const values = raw
    ? raw.split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
    : []
  return values.length ? values : fallback
}

const SUPERUSER_EMAILS = emailsFromEnv('SUPERUSER_EMAILS', DEFAULT_SUPERUSER_EMAILS)

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

// Everyone the staff inbox policy lets read a row: the owner plus every
// superuser, decided by role rather than by a hardcoded address.
function isManagerAccount(user: any): boolean {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : ''
  return userHasRole(user, SUPERUSER_ROLES)
    || SUPERUSER_EMAILS.includes(email)
    || userHasRole(user, OWNER_ROLES)
}

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
  'Access-Control-Allow-Headers': 'content-type, x-daily-alerts-cron-secret',
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
  const expected = Deno.env.get('DAILY_ALERTS_CRON_SECRET')?.trim()
  if (!expected) return json({ error: 'Daily alerts cron secret is not configured.' }, 500)

  const supplied = req.headers.get('x-daily-alerts-cron-secret')?.trim() ?? ''
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return json({ error: 'Forbidden' }, 403)
  }

  return null
}

async function sendToSubs(subs: any[], payload: string) {
  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  )

  const expired = subs.filter((_, i) => {
    const r = results[i]
    const code = r.status === 'rejected' ? (r.reason as any)?.statusCode : null
    return code === 410 || code === 404
  })
  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expired.map(s => s.endpoint))
  }
}

// The owner plus every superuser, so both phones get it. Paged high enough that
// the account list cannot outgrow the lookup.
async function pushToManagers(title: string, body: string, url: string) {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const targetIds = users.filter(isManagerAccount).map(user => user.id)
  if (!targetIds.length) return

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', targetIds)
  if (!subs?.length) return

  await sendToSubs(subs, JSON.stringify({ title, body, url }))
}

// The owner without the superuser, matching the 'admin' audience policy.
function isOwnerOnlyAccount(user: any): boolean {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : ''
  const superuser = userHasRole(user, SUPERUSER_ROLES) || SUPERUSER_EMAILS.includes(email)
  return userHasRole(user, OWNER_ROLES) && !superuser
}

async function pushToOwners(title: string, body: string, url: string) {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const targetIds = users.filter(isOwnerOnlyAccount).map(user => user.id)
  if (!targetIds.length) return

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', targetIds)
  if (!subs?.length) return

  await sendToSubs(subs, JSON.stringify({ title, body, url }))
}

// Alerts that belong to the owner alone: filed to the 'admin' audience, which
// the superuser cannot read, and pushed only to owner accounts.
async function notifyOwner({
  title,
  body,
  url,
  type,
  severity = 'warning',
  metadata = {},
}: {
  title: string
  body: string
  url: string
  type: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const results = await Promise.allSettled([
    createAppNotification({ audience: 'admin', title, body, url, type, severity, metadata }),
    pushToOwners(title, body, url),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Owner alert notification failed.', result.reason)
    }
  }
}

async function createAppNotification({
  audience = 'staff',
  title,
  body,
  url,
  type,
  severity = 'warning',
  metadata = {},
}: {
  audience?: 'staff' | 'billing' | 'admin' | 'superuser'
  title: string
  body: string
  url: string
  type: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabase.from('app_notifications').insert({
    audience,
    title,
    body,
    url,
    type,
    severity,
    metadata,
  })

  if (error) throw error
}

// Files the inbox row and pushes it to the owner and every superuser, so both
// phones see the same thing the inbox shows.
async function notifyManagers({
  title,
  body,
  url,
  type,
  severity = 'info',
  metadata = {},
}: {
  title: string
  body: string
  url: string
  type: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const results = await Promise.allSettled([
    createAppNotification({ title, body, url, type, severity, metadata }),
    pushToManagers(title, body, url),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Daily alert notification failed.', result.reason)
    }
  }
}

function dateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function fmtTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'All day'
  const [h, m] = value.split(':')
  const hour = Number(h)
  if (!Number.isFinite(hour)) return 'All day'
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

// Something that started before today is still on today's list, marked so it
// does not read as a fresh item starting this morning.
function todayEventLine(event: any, today: string): string {
  const carried = event.from_date < today ? ' (ongoing)' : ''
  return `${fmtTime(event.start_time)} · ${event.title}${carried}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorizationError = authorizeCron(req)
  if (authorizationError) return authorizationError

  try {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const offset = (days: number) => {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() + days)
      return dateStr(d)
    }

    const yesterday = offset(-1)
    const in1Day   = offset(1)
    const in3Days  = offset(3)

    // Overdue deployments — fires on the first day past expires_at
    const { data: overdue } = await supabase
      .from('deployments')
      .select('*, assets(label)')
      .is('picked_up_at', null)
      .eq('expires_at', yesterday)

    for (const dep of overdue ?? []) {
      const label    = dep.assets?.label ?? 'An asset'
      const customer = dep.customer_name ? ` — ${dep.customer_name}` : ''
      await notifyOwner({
        title: 'Overdue Pickup',
        body: `${label}${customer} was due yesterday`,
        url: '/inventory',
        type: 'overdue_pickup',
        severity: 'warning',
        metadata: {
          deployment_id: dep.id,
          asset_id: dep.asset_id,
          expires_at: dep.expires_at,
        },
      })
    }

    // Upcoming reservations — 3 days out and 1 day out
    const { data: upcoming } = await supabase
      .from('reservations')
      .select('*, assets(label)')
      .in('from_date', [in1Day, in3Days])

    for (const res of upcoming ?? []) {
      const label    = res.assets?.label ?? 'An asset'
      const customer = res.customer_name ? ` for ${res.customer_name}` : ''
      const days     = res.from_date === in1Day ? 1 : 3
      await notifyManagers({
        title: 'Upcoming Reservation',
        body: `${label}${customer} — reserved in ${days} day${days === 1 ? '' : 's'}`,
        url: '/inventory',
        type: 'upcoming_reservation',
        severity: 'info',
        metadata: {
          reservation_id: res.id,
          asset_id: res.asset_id,
          from_date: res.from_date,
          days,
        },
      })
    }

    // Morning-of reminder: everything on the calendar for today, in one push.
    // Silent on a clear day — an empty reminder every morning is just noise.
    const todayIso = dateStr(today)
    const { data: todayEvents } = await supabase
      .from('calendar_events')
      .select('id, title, from_date, to_date, start_time')
      .lte('from_date', todayIso)
      .gte('to_date', todayIso)
      .order('start_time', { ascending: true, nullsFirst: true })

    if (todayEvents?.length) {
      await notifyManagers({
        title: `Today · ${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'}`,
        body: todayEvents.map(e => todayEventLine(e, todayIso)).join('\n'),
        url: '/calendar',
        type: 'calendar_today',
        severity: 'info',
        metadata: {
          date: todayIso,
          event_count: todayEvents.length,
          event_ids: todayEvents.map(e => e.id),
        },
      })
    }

    return json({
      ok: true,
      overdue: overdue?.length ?? 0,
      upcoming: upcoming?.length ?? 0,
      today_events: todayEvents?.length ?? 0,
    })
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
