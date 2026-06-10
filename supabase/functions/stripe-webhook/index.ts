import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function isPeriodLabel(label: string): boolean {
  return /^\d{4}-\d{2}$/.test(label)
}

function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function dateLabel(year: number, month: number, day: number): string {
  return `${periodLabel(year, month)}-${String(day).padStart(2, '0')}`
}

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + offset, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function paidThroughForPeriod(period: string, billingDay?: number | null): string | null {
  if (!billingDay || !isPeriodLabel(period)) return null
  const [y, m] = period.split('-').map(Number)
  const next = addMonths(y, m, 1)
  const nextStartDay = Math.min(billingDay, lastDayOf(next.year, next.month))
  const paidThrough = new Date(Date.UTC(next.year, next.month - 1, nextStartDay) - 86400000)
  return dateLabel(paidThrough.getUTCFullYear(), paidThrough.getUTCMonth() + 1, paidThrough.getUTCDate())
}

function dollarsFromCents(value: number): number {
  return Number((value / 100).toFixed(2))
}

function periodAmountsFromMetadata(value: unknown, labels: string[]): number[] | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const amounts = value.split(',').map(part => Number(part.trim()))
  if (amounts.length !== labels.length) return null
  if (!amounts.every(amount => Number.isFinite(amount) && amount >= 0)) return null
  return amounts
}

function paymentRecordAmountsFromMetadata({
  index,
  perMonth,
  periodAmounts,
  periodSubtotalAmounts,
  periodTaxAmounts,
  taxRate,
  taxLabel,
}: {
  index: number
  perMonth: number
  periodAmounts: number[] | null
  periodSubtotalAmounts: number[] | null
  periodTaxAmounts: number[] | null
  taxRate: unknown
  taxLabel: unknown
}) {
  const amountCents = periodAmounts?.[index]
  const subtotalCents = periodSubtotalAmounts?.[index] ?? amountCents
  const taxCents = periodTaxAmounts?.[index] ?? 0
  const parsedTaxRate = Number(taxRate)
  const label = typeof taxLabel === 'string' && taxLabel.trim() ? taxLabel.trim() : null

  return {
    amount: typeof amountCents === 'number' ? dollarsFromCents(amountCents) : perMonth,
    subtotal_amount: typeof subtotalCents === 'number' ? dollarsFromCents(subtotalCents) : perMonth,
    tax_amount: dollarsFromCents(taxCents),
    tax_rate: Number.isFinite(parsedTaxRate) && taxCents > 0 ? parsedTaxRate : 0,
    tax_label: taxCents > 0 ? label : null,
  }
}

async function extendPaidThroughByLabels(tenancyId: string, labels: string[]) {
  const { data: tenancy } = await supabase
    .from('storage_tenancies')
    .select('id, billing_day, paid_through_date')
    .eq('id', tenancyId)
    .maybeSingle()

  if (!tenancy) return

  const paidThroughCandidates = [tenancy.paid_through_date, ...labels.map(label => paidThroughForPeriod(label, tenancy.billing_day))]
    .filter(Boolean)
    .sort()
  const paidThroughDate = paidThroughCandidates[paidThroughCandidates.length - 1] as string | undefined

  if (paidThroughDate && paidThroughDate !== tenancy.paid_through_date) {
    await supabase.from('storage_tenancies')
      .update({ paid_through_date: paidThroughDate })
      .eq('id', tenancyId)
  }
}

async function extendPortablePaidThroughByLabels(assetId: string, labels: string[]) {
  const { data: rental } = await supabase
    .from('portable_storage_rentals')
    .select('asset_id, billing_day, paid_through_date')
    .eq('asset_id', assetId)
    .maybeSingle()

  if (!rental) return

  const paidThroughCandidates = [rental.paid_through_date, ...labels.map(label => paidThroughForPeriod(label, rental.billing_day))]
    .filter(Boolean)
    .sort()
  const paidThroughDate = paidThroughCandidates[paidThroughCandidates.length - 1] as string | undefined

  if (paidThroughDate && paidThroughDate !== rental.paid_through_date) {
    await supabase.from('portable_storage_rentals')
      .update({ paid_through_date: paidThroughDate })
      .eq('asset_id', assetId)
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

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
        .update({ stripe_payment_method_id: paymentMethodId, has_payment_method: true })
        .eq('id', customerId)
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      const {
        tenancy_id,
        unit_id,
        period_label,
        monthly_rate,
        period_amounts_cents,
        period_subtotal_amounts_cents,
        period_tax_amounts_cents,
        tax_rate,
        tax_label,
        unit_type,
        portable_asset_id,
        portable_rental_id,
      } = pi.metadata ?? {}

      if (period_label) {
        const labels = period_label.split(',').map((l: string) => l.trim()).filter(isPeriodLabel)
        if (labels.length === 0) return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
        const metadataMonthlyRate = Number(monthly_rate)
        const perMonth = Number.isFinite(metadataMonthlyRate) && metadataMonthlyRate > 0
          ? metadataMonthlyRate
          : labels.length > 1 ? pi.amount / 100 / labels.length : pi.amount / 100
        const periodAmounts = periodAmountsFromMetadata(period_amounts_cents, labels)
        const periodSubtotalAmounts = periodAmountsFromMetadata(period_subtotal_amounts_cents, labels)
        const periodTaxAmounts = periodAmountsFromMetadata(period_tax_amounts_cents, labels)

        if (unit_type === 'portable' || portable_asset_id || portable_rental_id) {
          let resolvedAssetId = portable_asset_id || null
          if (!resolvedAssetId && portable_rental_id) {
            const { data: r } = await supabase
              .from('portable_storage_rentals')
              .select('asset_id')
              .eq('id', portable_rental_id)
              .maybeSingle()
            resolvedAssetId = r?.asset_id ?? null
          }

          if (resolvedAssetId) {
            await supabase.from('portable_storage_payments').upsert(
              labels.map((label: string, index: number) => ({
                asset_id: resolvedAssetId,
                period_label: label,
                paid_at: new Date().toISOString(),
                ...paymentRecordAmountsFromMetadata({
                  index,
                  perMonth,
                  periodAmounts,
                  periodSubtotalAmounts,
                  periodTaxAmounts,
                  taxRate: tax_rate,
                  taxLabel: tax_label,
                }),
              })),
              { onConflict: 'asset_id,period_label' }
            )
            await extendPortablePaidThroughByLabels(resolvedAssetId, labels)
          }
        } else {
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
              labels.map((label: string, index: number) => ({
                tenancy_id: resolvedTenancyId,
                period_label: label,
                paid_at: new Date().toISOString(),
                ...paymentRecordAmountsFromMetadata({
                  index,
                  perMonth,
                  periodAmounts,
                  periodSubtotalAmounts,
                  periodTaxAmounts,
                  taxRate: tax_rate,
                  taxLabel: tax_label,
                }),
              })),
              { onConflict: 'tenancy_id,period_label' }
            )
            await extendPaidThroughByLabels(resolvedTenancyId, labels)
          }
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
