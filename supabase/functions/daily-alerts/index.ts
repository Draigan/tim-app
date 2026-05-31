import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'tim@timberfell.ca'

webpush.setVapidDetails(
  `mailto:${ADMIN_EMAIL}`,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function pushToAdmin(title: string, body: string, url: string) {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 100 })
  const adminUser = users.find(u => u.email === ADMIN_EMAIL)
  if (!adminUser) return

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', adminUser.id)
  if (!subs?.length) return

  const payload = JSON.stringify({ title, body, url })
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
    await supabase.from('push_subscriptions').delete().in('endpoint', expired.map(s => s.endpoint))
  }
}

function dateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } })

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
      await pushToAdmin('Overdue Pickup', `${label}${customer} was due yesterday`, '/inventory')
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
      await pushToAdmin(
        'Upcoming Reservation',
        `${label}${customer} — reserved in ${days} day${days === 1 ? '' : 's'}`,
        '/inventory'
      )
    }

    return new Response(
      JSON.stringify({ ok: true, overdue: overdue?.length ?? 0, upcoming: upcoming?.length ?? 0 }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
