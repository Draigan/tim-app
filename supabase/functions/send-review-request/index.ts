import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const { phone, customerName, deploymentId } = await req.json()
  if (!phone) return json({ error: 'phone required' }, 400)

  const apiKey = Deno.env.get('REVIEW_API_KEY')
  if (!apiKey) return json({ error: 'Review API not configured' }, 500)

  const res = await fetch('https://dashboard.lodestonesystems.ca/api/external/review-request/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientId: 'timberfell', phone, customerName: customerName || undefined }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('review API error', res.status, text)
    return json({ error: 'Review API request failed' }, 502)
  }

  if (deploymentId) {
    await supabaseAdmin
      .from('deployments')
      .update({ review_requested_at: new Date().toISOString() })
      .eq('id', deploymentId)
  }

  return json({ ok: true })
})
