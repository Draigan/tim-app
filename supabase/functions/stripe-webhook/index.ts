import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('Missing signature', { status: 400 })

  let event: Stripe.Event
  try {
    const body = await req.text()
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
  } catch (err) {
    return new Response(`Webhook error: ${err}`, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'setup') return new Response('ok')

      const customerId = session.metadata?.customer_id
      if (!customerId) return new Response('ok')

      const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent as string)
      const paymentMethodId = setupIntent.payment_method as string

      // Set as default payment method on the Stripe customer
      await stripe.customers.update(session.customer as string, {
        invoice_settings: { default_payment_method: paymentMethodId },
      })

      await supabase
        .from('customers')
        .update({ stripe_payment_method_id: paymentMethodId })
        .eq('id', customerId)
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      const { unit_id, period_label } = pi.metadata ?? {}
      if (unit_id && period_label) {
        await supabase.from('storage_payments').upsert(
          { unit_id, period_label, paid_at: new Date().toISOString(), amount: pi.amount / 100 },
          { onConflict: 'unit_id,period_label' }
        )
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent
      const { unit_id } = pi.metadata ?? {}
      console.error(`Charge failed for unit ${unit_id}: ${pi.last_payment_error?.message}`)
      // Future: push notification to admin
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
