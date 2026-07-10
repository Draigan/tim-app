import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ADMIN_EMAIL = 'tim@timberfell.ca'
const MAX_TITLE_LENGTH = 80
const MAX_BODY_LENGTH = 180
const NOTIFICATION_INBOX_URL = '/notifications'

webpush.setVapidDetails(
  `mailto:${ADMIN_EMAIL}`,
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

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || 'Chat'
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
  title,
  body,
  url,
  type = 'admin_push',
  severity = 'info',
  metadata = {},
}: {
  title: string
  body: string
  url: string
  type?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('app_notifications').insert({
    audience: 'admin',
    title,
    body,
    url,
    type,
    severity,
    metadata,
  })

  if (error) throw error
}

async function chatPayloadForCaller(userId: string, body: Record<string, unknown>): Promise<string | Response> {
  const messageId = typeof body.message_id === 'string' ? body.message_id.trim() : ''
  let message: any = null

  if (messageId) {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, user_id, sender_name, content, sent_at')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle()
    message = data
  } else {
    const content = cleanText(body.body, 1000)
    if (!content) return json({ error: 'message_id required' }, 400)

    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, user_id, sender_name, content, sent_at')
      .eq('user_id', userId)
      .eq('content', content)
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    message = data
  }

  if (!message) return json({ error: 'Forbidden' }, 403)

  return JSON.stringify({
    title: cleanText(firstName(message.sender_name ?? 'Chat'), MAX_TITLE_LENGTH) ?? 'Chat',
    body: cleanText(message.content, MAX_BODY_LENGTH) ?? 'New message',
    url: '/chat',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const requestBody = await req.json()
  const { title, body, url, exclude_user_id, to_all, to_self } = requestBody

  const cleanedTitle = cleanText(title, MAX_TITLE_LENGTH)
  const cleanedBody = cleanText(body, MAX_BODY_LENGTH)

  if (to_self) {
    if (!cleanedTitle || !cleanedBody) return json({ error: 'title and body required' }, 400)
    const payload = JSON.stringify({ title: cleanedTitle, body: cleanedBody, url: safeUrl(url) })
    const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('*').eq('user_id', user.id)
    if (!subs?.length) return json({ ok: true, sent: 0 })
    const sent = await sendToSubs(subs, payload)
    return json({ ok: true, sent })
  }

  if (to_all) {
    const payload = await chatPayloadForCaller(user.id, requestBody)
    if (payload instanceof Response) return payload

    // Broadcast is only for recorded chat messages. Never trust a client-selected exclude target.
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .neq('user_id', user.id)
    if (!subs?.length) return json({ ok: true, sent: 0 })
    const sent = await sendToSubs(subs, payload)
    return json({ ok: true, sent })
  }

  if (!cleanedTitle || !cleanedBody) return json({ error: 'title and body required' }, 400)

  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 })
  const adminUser = users.find(u => u.email === ADMIN_EMAIL)
  if (!adminUser) return json({ ok: true, sent: 0 })

  // Normal mode: notify admin about employee actions
  if (exclude_user_id === adminUser.id) return json({ ok: true, sent: 0 })
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
    .eq('user_id', adminUser.id)
  if (!subs?.length) return json({ ok: true, sent: 0 })
  const sent = await sendToSubs(subs, payload)
  return json({ ok: true, sent })
})
