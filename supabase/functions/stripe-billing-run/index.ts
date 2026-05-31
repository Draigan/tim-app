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

async function chargeUnit(tenancy: any, period: string) {
  const customer = tenancy.customers as { stripe_customer_id: string | null; stripe_payment_method_id: string | null } | null
  if (!customer?.stripe_payment_method_id || !customer?.stripe_customer_id) {
    return { status: 'skipped', reason: 'no_card' }
  }

  const { data: existing } = await supabase
    .from('storage_payments')
    .select('id')
    .eq('tenancy_id', tenancy.id)
    .eq('period_label', period)
    .maybeSingle()

  if (existing) return { status: 'skipped', reason: 'already_paid' }

  const pi = await stripe.paymentIntents.create({
    amount: Math.round(tenancy.monthly_rate * 100),
    currency: 'cad',
    customer: customer.stripe_customer_id,
    payment_method: customer.stripe_payment_method_id,
    off_session: true,
    confirm: true,
    metadata: {
      unit_id: tenancy.unit_id,
      tenancy_id: tenancy.id,
      period_label: period,
      unit_number: tenancy.unit_number ?? '',
    },
  })

  await supabase.from('storage_payments').upsert(
    { tenancy_id: tenancy.id, period_label: period, paid_at: new Date().toISOString(), amount: pi.amount / 100 },
    { onConflict: 'tenancy_id,period_label' }
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
      // Look up the active tenancy for this unit
      const { data: tenancy, error } = await supabase
        .from('storage_tenancies')
        .select('*, customers(stripe_customer_id, stripe_payment_method_id), storage_units(unit_number)')
        .eq('unit_id', body.unit_id)
        .is('end_date', null)
        .maybeSingle()

      if (error || !tenancy) return new Response(JSON.stringify({ error: 'no active tenancy for unit' }), { status: 404, headers: CORS })
      if (!tenancy.monthly_rate) return new Response(JSON.stringify({ error: 'no rate set' }), { status: 400, headers: CORS })

      // Flatten unit_number for metadata
      tenancy.unit_number = (tenancy.storage_units as any)?.unit_number ?? ''

      const months: number = body.months && body.months > 1 ? Math.min(body.months, 24) : 1

      if (months === 1) {
        const result = await chargeUnit(tenancy, period)
        return new Response(JSON.stringify({ ok: true, period, ...result }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      // Multi-month one-time charge
      const customer = tenancy.customers as { stripe_customer_id: string | null; stripe_payment_method_id: string | null } | null
      if (!customer?.stripe_payment_method_id || !customer?.stripe_customer_id) {
        return new Response(JSON.stringify({ status: 'skipped', reason: 'no_card' }), { headers: CORS })
      }

      const [y, m] = period.split('-').map(Number)
      const candidatePeriods = Array.from({ length: months + 24 }, (_, i) => {
        return new Date(y, m - 1 + i, 1).toISOString().slice(0, 7)
      })

      const { data: existing } = await supabase
        .from('storage_payments')
        .select('period_label')
        .eq('tenancy_id', tenancy.id)
        .in('period_label', candidatePeriods)

      const paidSet = new Set((existing ?? []).map((p: any) => p.period_label))
      const unpaidPeriods = candidatePeriods.filter(p => !paidSet.has(p)).slice(0, months)

      if (unpaidPeriods.length === 0) {
        return new Response(JSON.stringify({ ok: true, status: 'skipped', reason: 'already_paid', periods: [] }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      const extraAmount = typeof body.extra_amount === 'number' ? body.extra_amount : 0
      const pi = await stripe.paymentIntents.create({
        amount: Math.round((tenancy.monthly_rate * unpaidPeriods.length + extraAmount) * 100),
        currency: 'cad',
        customer: customer.stripe_customer_id,
        payment_method: customer.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          unit_id: tenancy.unit_id,
          tenancy_id: tenancy.id,
          period_label: unpaidPeriods.join(','),
          unit_number: tenancy.unit_number ?? '',
          months: String(unpaidPeriods.length),
        },
      })

      const inserts = unpaidPeriods.map(p => ({
        tenancy_id: tenancy.id,
        period_label: p,
        paid_at: new Date().toISOString(),
        amount: pi.amount / 100 / unpaidPeriods.length,
      }))
      await supabase.from('storage_payments').upsert(inserts, { onConflict: 'tenancy_id,period_label' })

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

    const { data: tenancies, error } = await supabase
      .from('storage_tenancies')
      .select('*, customers(stripe_customer_id, stripe_payment_method_id), storage_units(unit_number)')
      .eq('payment_frequency', 'monthly')
      .not('monthly_rate', 'is', null)
      .not('customer_id', 'is', null)
      .is('end_date', null)

    if (error) throw error

    const due = (tenancies ?? []).filter(t => Math.min(t.billing_day, lastDay) === todayDay)
    const results = { charged: 0, skipped: 0, failed: 0 }

    for (const tenancy of due) {
      tenancy.unit_number = (tenancy.storage_units as any)?.unit_number ?? ''
      try {
        const { status } = await chargeUnit(tenancy, period)
        if (status === 'charged') results.charged++
        else results.skipped++
      } catch (err) {
        console.error(`Failed to charge tenancy ${tenancy.id}:`, err)
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
