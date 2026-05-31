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

function currentPeriodLabel(): string {
  return new Date().toISOString().slice(0, 7)
}

function lastDayOfCurrentMonth(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
}

async function chargeUnit(unit: any, period: string) {
  const customer = unit.customers as { stripe_customer_id: string | null; stripe_payment_method_id: string | null } | null
  if (!customer?.stripe_payment_method_id || !customer?.stripe_customer_id) {
    return { status: 'skipped', reason: 'no_card' }
  }

  const { data: existing } = await supabase
    .from('storage_payments')
    .select('id')
    .eq('unit_id', unit.id)
    .eq('period_label', period)
    .maybeSingle()

  if (existing) return { status: 'skipped', reason: 'already_paid' }

  const pi = await stripe.paymentIntents.create({
    amount: Math.round(unit.monthly_rate * 100),
    currency: 'cad',
    customer: customer.stripe_customer_id,
    payment_method: customer.stripe_payment_method_id,
    off_session: true,
    confirm: true,
    metadata: { unit_id: unit.id, period_label: period, unit_number: unit.unit_number },
  })

  await supabase.from('storage_payments').upsert(
    { unit_id: unit.id, period_label: period, paid_at: new Date().toISOString(), amount: pi.amount / 100 },
    { onConflict: 'unit_id,period_label' }
  )

  return { status: 'charged' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const body = await req.json().catch(() => ({}))
    const period = currentPeriodLabel()

    // ── single unit charge (manual "Charge now" or one-time) ─────────────────
    if (body.unit_id) {
      const { data: unit, error } = await supabase
        .from('storage_units')
        .select('id, unit_number, monthly_rate, customer_id, customers(stripe_customer_id, stripe_payment_method_id)')
        .eq('id', body.unit_id)
        .single()

      if (error || !unit) return new Response(JSON.stringify({ error: 'unit not found' }), { status: 404, headers: CORS })
      if (!unit.monthly_rate) return new Response(JSON.stringify({ error: 'no rate set' }), { status: 400, headers: CORS })

      const months: number = body.months && body.months > 1 ? Math.min(body.months, 24) : 1

      if (months === 1) {
        const result = await chargeUnit(unit, period)
        return new Response(JSON.stringify({ ok: true, period, ...result }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      // Multi-month one-time charge
      const customer = unit.customers as { stripe_customer_id: string | null; stripe_payment_method_id: string | null } | null
      if (!customer?.stripe_payment_method_id || !customer?.stripe_customer_id) {
        return new Response(JSON.stringify({ status: 'skipped', reason: 'no_card' }), { headers: CORS })
      }

      // Find the next N unpaid periods starting from current period
      const [y, m] = period.split('-').map(Number)
      const candidatePeriods = Array.from({ length: months + 24 }, (_, i) => {
        return new Date(y, m - 1 + i, 1).toISOString().slice(0, 7)
      })

      const { data: existing } = await supabase
        .from('storage_payments')
        .select('period_label')
        .eq('unit_id', unit.id)
        .in('period_label', candidatePeriods)

      const paidSet = new Set((existing ?? []).map((p: any) => p.period_label))
      const unpaidPeriods = candidatePeriods.filter(p => !paidSet.has(p)).slice(0, months)

      if (unpaidPeriods.length === 0) {
        return new Response(JSON.stringify({ ok: true, status: 'skipped', reason: 'already_paid', periods }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      const extraAmount = typeof body.extra_amount === 'number' ? body.extra_amount : 0
      const pi = await stripe.paymentIntents.create({
        amount: Math.round((unit.monthly_rate * unpaidPeriods.length + extraAmount) * 100),
        currency: 'cad',
        customer: customer.stripe_customer_id,
        payment_method: customer.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: { unit_id: unit.id, period_label: unpaidPeriods.join(','), unit_number: unit.unit_number, months: String(unpaidPeriods.length) },
      })

      const inserts = unpaidPeriods.map(p => ({ unit_id: unit.id, period_label: p, paid_at: new Date().toISOString(), amount: pi.amount / 100 / unpaidPeriods.length }))
      await supabase.from('storage_payments').upsert(inserts, { onConflict: 'unit_id,period_label' })

      return new Response(JSON.stringify({ ok: true, status: 'charged', periods: unpaidPeriods }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── daily cron: charge all due units ─────────────────────────────────────
    const { data: billingSettings } = await supabase
      .from('billing_settings').select('auto_charge_enabled').eq('id', 1).single()

    if (!billingSettings?.auto_charge_enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'auto_charge_disabled' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const todayDay = new Date().getDate()
    const lastDay  = lastDayOfCurrentMonth()

    const { data: units, error } = await supabase
      .from('storage_units')
      .select('id, unit_number, monthly_rate, billing_day, customer_id, customers(stripe_customer_id, stripe_payment_method_id)')
      .eq('payment_frequency', 'monthly')
      .not('monthly_rate', 'is', null)
      .not('customer_id', 'is', null)

    if (error) throw error

    const due = (units ?? []).filter(u => Math.min(u.billing_day, lastDay) === todayDay)
    const results = { charged: 0, skipped: 0, failed: 0 }

    for (const unit of due) {
      try {
        const { status } = await chargeUnit(unit, period)
        if (status === 'charged') results.charged++
        else results.skipped++
      } catch (err) {
        console.error(`Failed to charge unit ${unit.unit_number}:`, err)
        results.failed++
      }
    }

    return new Response(JSON.stringify({ ok: true, period, due: due.length, ...results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
