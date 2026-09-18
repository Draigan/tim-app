import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Push-service contact address only. Never used to decide who sees what —
// roles do that.
const VAPID_CONTACT = (Deno.env.get('VAPID_CONTACT_EMAIL') ?? 'd@d.d').trim().toLowerCase()
const DEFAULT_SUPERUSER_EMAILS = ['d@d.d']
const MAX_TITLE_LENGTH = 80
const MAX_BODY_LENGTH = 180
const NOTIFICATION_INBOX_URL = '/notifications'
const SUPERUSER_ROLES = new Set(['superuser'])

// Superuser alerts arrive from a few different places; each kind decides how the
// notification is filed in the inbox.
const SUPERUSER_NOTIFICATION_KINDS: Record<string, { type: string; severity: 'info' | 'error' }> = {
  app_error: { type: 'app_error', severity: 'error' },
  storage_view: { type: 'storage_view', severity: 'info' },
}

// Manager alerts are filed the same way, so a client can pick a filing but
// never invent a notification type.
const MANAGER_NOTIFICATION_KINDS: Record<string, { type: string; severity: 'info' | 'success' }> = {
  calendar_event: { type: 'calendar_event', severity: 'info' },
}

webpush.setVapidDetails(
  `mailto:${VAPID_CONTACT}`,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
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

// Deployment and pickup announcements are the owner's alone — the superuser
// deliberately stays out of that stream, matching the 'admin' audience policy.
function isOwnerOnlyAccount(user: any): boolean {
  return userHasRole(user, OWNER_ROLES) && !isSuperuserAccount(user)
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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
  const stale: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = (r.reason as any)?.statusCode
      console.error(`push failed endpoint=${subs[i].endpoint.slice(0, 60)} status=${code}`, r.reason?.message)
      if (code === 410 || code === 404) stale.push(subs[i].endpoint)
    }
  })
  if (stale.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', stale)
  }
  return results.filter(r => r.status === 'fulfilled').length
}

async function createAppNotification({
  audience = 'admin',
  title,
  body,
  url,
  type = 'admin_push',
  severity = 'info',
  metadata = {},
}: {
  audience?: 'staff' | 'billing' | 'admin' | 'superuser'
  title: string
  body: string
  url: string
  type?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('app_notifications').insert({
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

async function superuserIds(): Promise<string[]> {
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  return users.filter(isSuperuserAccount).map(user => user.id)
}

// The owner plus every superuser — the people who run the business, as opposed
// to the superuser-only stream that carries app errors.
async function managerIds(): Promise<string[]> {
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  return users.filter(isManagerAccount).map(user => user.id)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const requestBody = await req.json()
  const { title, body, url, exclude_user_id, to_self, to_superuser, to_managers } = requestBody

  const cleanedTitle = cleanText(title, MAX_TITLE_LENGTH)
  const cleanedBody = cleanText(body, MAX_BODY_LENGTH)

  if (to_superuser) {
    if (!cleanedTitle || !cleanedBody) return json({ error: 'title and body required' }, 400)

    const kind = SUPERUSER_NOTIFICATION_KINDS[String(requestBody.kind ?? '')]
      ?? SUPERUSER_NOTIFICATION_KINDS.app_error

    const targetIds = await superuserIds()
    if (!targetIds.length) return json({ ok: true, sent: 0 })

    const targetUrl = safeUrl(url)
    const payload = JSON.stringify({ title: cleanedTitle, body: cleanedBody, url: targetUrl })

    await createAppNotification({
      audience: 'superuser',
      title: cleanedTitle,
      body: cleanedBody,
      url: targetUrl,
      type: kind.type,
      severity: kind.severity,
      metadata: {
        sender_user_id: user.id,
        ...metadataObject(requestBody.metadata ?? requestBody.error),
      },
    }).catch(err => {
      console.error('Superuser app notification failed.', err)
    })

    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', targetIds)
    if (!subs?.length) return json({ ok: true, sent: 0 })
    const sent = await sendToSubs(subs, payload)
    return json({ ok: true, sent })
  }

  if (to_managers) {
    if (!cleanedTitle || !cleanedBody) return json({ error: 'title and body required' }, 400)

    const kind = MANAGER_NOTIFICATION_KINDS[String(requestBody.kind ?? '')]
      ?? MANAGER_NOTIFICATION_KINDS.calendar_event

    const targetUrl = safeUrl(url)

    // The row is filed for everyone who can read it, including whoever acted —
    // the inbox is a record, not just an alert.
    await createAppNotification({
      audience: 'staff',
      title: cleanedTitle,
      body: cleanedBody,
      url: targetUrl,
      type: kind.type,
      severity: kind.severity,
      metadata: {
        sender_user_id: user.id,
        ...metadataObject(requestBody.metadata),
      },
    }).catch(err => {
      console.error('Manager app notification failed.', err)
    })

    // Nobody needs a push about something they just did themselves.
    const targetIds = (await managerIds()).filter(id => id !== user.id)
    if (!targetIds.length) return json({ ok: true, sent: 0 })

    const payload = JSON.stringify({ title: cleanedTitle, body: cleanedBody, url: targetUrl })
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', targetIds)
    if (!subs?.length) return json({ ok: true, sent: 0 })
    const sent = await sendToSubs(subs, payload)
    return json({ ok: true, sent })
  }

  if (to_self) {
    if (!cleanedTitle || !cleanedBody) return json({ error: 'title and body required' }, 400)
    const payload = JSON.stringify({ title: cleanedTitle, body: cleanedBody, url: safeUrl(url) })
    const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('*').eq('user_id', user.id)
    if (!subs?.length) return json({ ok: true, sent: 0 })
    const sent = await sendToSubs(subs, payload)
    return json({ ok: true, sent })
  }

  if (!cleanedTitle || !cleanedBody) return json({ error: 'title and body required' }, 400)

  // Deployment and pickup announcements: filed to the owner's stream only.
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  const ownerIds = users.filter(isOwnerOnlyAccount).map(u => u.id)
  if (!ownerIds.length) return json({ ok: true, sent: 0 })

  // Nobody needs an announcement about something they just did themselves.
  const targetIds = ownerIds.filter(id => id !== user.id && id !== exclude_user_id)
  if (!targetIds.length) return json({ ok: true, sent: 0 })
  const targetUrl = safeUrl(url)
  const payload = JSON.stringify({ title: cleanedTitle, body: cleanedBody, url: NOTIFICATION_INBOX_URL })

  await createAppNotification({
    title: cleanedTitle,
    body: cleanedBody,
    url: targetUrl,
    type: 'admin_push',
    severity: 'info',
    metadata: {
      sender_user_id: user.id,
    },
  }).catch(err => {
    console.error('Admin app notification failed.', err)
  })

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .in('user_id', targetIds)
  if (!subs?.length) return json({ ok: true, sent: 0 })
  const sent = await sendToSubs(subs, payload)
  return json({ ok: true, sent })
})
