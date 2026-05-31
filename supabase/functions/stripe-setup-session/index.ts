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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { customer_id, origin } = await req.json()
    if (!customer_id) return new Response(JSON.stringify({ error: 'customer_id required' }), { status: 400, headers: CORS })

    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, email, stripe_customer_id')
      .eq('id', customer_id)
      .single()

    if (error || !customer) return new Response(JSON.stringify({ error: 'customer not found' }), { status: 404, headers: CORS })

    // Create Stripe customer if one doesn't exist yet
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

    const appOrigin = origin ?? 'https://pvpzpkvgdyjujtelwbbs.supabase.co'

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: stripeCustomerId,
      currency: 'cad',
      setup_intent_data: {
        metadata: { customer_id },
      },
      metadata: { customer_id },
      success_url: `${appOrigin}/customers?card=saved`,
      cancel_url:  `${appOrigin}/customers?card=cancelled`,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
