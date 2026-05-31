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

async function sendTwilio(to: string, body: string): Promise<void> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from       = Deno.env.get('TWILIO_FROM_NUMBER')!

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio ${res.status}: ${err}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const { to, body, ref_id, unit_type } = await req.json()
  if (!to || !body) return json({ error: 'to and body are required' }, 400)

  const digits = to.replace(/\D/g, '')
  const normalized = digits.length === 10 ? '+1' + digits : '+' + digits
  await sendTwilio(normalized, body)

  if (ref_id && unit_type) {
    const today = new Date().toISOString().slice(0, 10)
    await supabaseAdmin.from('sms_reminder_log').upsert({
      ref_id, unit_type, phone: normalized,
      sent_date: today, days_overdue: null, message: body,
    }, { onConflict: 'ref_id,sent_date', ignoreDuplicates: true })
  }

  return json({ ok: true })
})
