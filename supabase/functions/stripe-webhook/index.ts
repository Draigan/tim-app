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
      const { tenancy_id, unit_id, period_label } = pi.metadata ?? {}

      if (period_label) {
        const labels = period_label.split(',').map((l: string) => l.trim()).filter(Boolean)
        const perMonth = labels.length > 1 ? pi.amount / 100 / labels.length : pi.amount / 100

        // Resolve tenancy_id — prefer explicit, fall back to looking up active tenancy by unit_id
        let resolvedTenancyId = tenancy_id || null
        if (!resolvedTenancyId && unit_id) {
          const { data: t } = await supabase
            .from('storage_tenancies')
            .select('id')
            .eq('unit_id', unit_id)
            .is('end_date', null)
            .maybeSingle()
          resolvedTenancyId = t?.id ?? null
        }

        if (resolvedTenancyId) {
          await supabase.from('storage_payments').upsert(
            labels.map((label: string) => ({
              tenancy_id: resolvedTenancyId,
              period_label: label,
              paid_at: new Date().toISOString(),
              amount: perMonth,
            })),
            { onConflict: 'tenancy_id,period_label' }
          )
        }
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent
      const { unit_id, tenancy_id } = pi.metadata ?? {}
      console.error(`Charge failed for unit ${unit_id ?? ''} tenancy ${tenancy_id ?? ''}: ${pi.last_payment_error?.message}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
