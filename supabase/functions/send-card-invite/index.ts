import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sendTwilio(to: string, body: string) {
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
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { customer_id } = await req.json()
    if (!customer_id) return new Response(JSON.stringify({ error: 'customer_id required' }), { status: 400, headers: CORS })

    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, phone, email, stripe_customer_id')
      .eq('id', customer_id)
      .single()

    if (error || !customer) return new Response(JSON.stringify({ error: 'customer not found' }), { status: 404, headers: CORS })
    if (!customer.phone) return new Response(JSON.stringify({ error: 'customer has no phone number' }), { status: 400, headers: CORS })

    // Create or reuse Stripe customer
    let stripeCustomerId = customer.stripe_customer_id
    if (!stripeCustomerId) {
      const sc = await stripe.customers.create({
        name: customer.name ?? undefined,
        email: customer.email ?? undefined,
        metadata: { customer_id },
      })
      stripeCustomerId = sc.id
      await supabase.from('customers').update({ stripe_customer_id: stripeCustomerId }).eq('id', customer_id)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: stripeCustomerId,
      currency: 'cad',
      setup_intent_data: { metadata: { customer_id } },
      metadata: { customer_id },
      success_url: 'https://tdstorage.ca/card-saved',
      cancel_url:  'https://tdstorage.ca/card-cancelled',
    })

    const digits = customer.phone.replace(/\D/g, '')
    const normalized = digits.length === 10 ? '+1' + digits : '+' + digits
    const firstName = customer.name?.split(' ')[0] ?? 'there'
    const msg = `Hi ${firstName}, T&D Storage is inviting you to save a payment card for automatic billing. Tap here to securely add your card: ${session.url}`
    await sendTwilio(normalized, msg)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
