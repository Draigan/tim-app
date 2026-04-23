import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ADMIN_EMAIL = 'tim@timberfell.ca'

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
    return r.status === 'rejected' && (r.reason as any)?.statusCode === 410
  })
  if (expired.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', expired.map(s => s.endpoint))
  }
  return results.filter(r => r.status === 'fulfilled').length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const { title, body, url, exclude_user_id, broadcast } = await req.json()
  if (!title || !body) return json({ error: 'title and body required' }, 400)

  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 })
  const adminUser = users.find(u => u.email === ADMIN_EMAIL)
  if (!adminUser) return json({ ok: true, sent: 0 })

  const payload = JSON.stringify({ title, body, url: url ?? '/' })

  if (broadcast) {
    // Admin-only: blast to all employees (everyone except admin)
    if (user.id !== adminUser.id) return json({ error: 'Forbidden' }, 403)
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .neq('user_id', adminUser.id)
    if (!subs?.length) return json({ ok: true, sent: 0 })
    const sent = await sendToSubs(subs, payload)
    return json({ ok: true, sent })
  }

  // Normal mode: notify admin about employee actions
  if (exclude_user_id === adminUser.id) return json({ ok: true, sent: 0 })
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', adminUser.id)
  if (!subs?.length) return json({ ok: true, sent: 0 })
  const sent = await sendToSubs(subs, payload)
  return json({ ok: true, sent })
})
