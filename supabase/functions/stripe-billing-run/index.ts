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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-billing-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ADMIN_EMAILS = (Deno.env.get('BILLING_ADMIN_EMAILS') ?? 'tim@timberfell.ca')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean)
const BILLING_ROLES = new Set(['admin', 'billing', 'billing_admin'])
const BUSINESS_TIME_ZONE = 'America/Toronto'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }

  return diff === 0
}

function billingPinFromBody(body: Record<string, unknown>): string {
  const value = body.billing_pin ?? body.pin
  return typeof value === 'string' ? value.trim() : ''
}

function validateBillingPin(body: Record<string, unknown>): Response | null {
  const expected = Deno.env.get('BILLING_APPROVAL_PIN')?.trim()
  if (!expected) return json({ error: 'Billing approval PIN is not configured.' }, 500)

  const supplied = billingPinFromBody(body)
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return json({ error: 'Invalid billing approval PIN.' }, 403)
  }

  return null
}

function userHasBillingRole(user: any): boolean {
  const appMetadata = user?.app_metadata ?? {}
  const role = appMetadata.role
  if (typeof role === 'string' && BILLING_ROLES.has(role)) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => BILLING_ROLES.has(String(role)))
  if (roles && typeof roles === 'object') {
    return [...BILLING_ROLES].some(role => Boolean(roles[role]))
  }

  return false
}

async function authorizeManualBilling(req: Request, body: Record<string, unknown>): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (!userHasBillingRole(user) && !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return json({ error: 'Forbidden' }, 403)
  }

  return validateBillingPin(body)
}

function authorizeCron(req: Request): Response | null {
  const expected = Deno.env.get('BILLING_CRON_SECRET')?.trim()
  if (!expected) return json({ error: 'Billing cron secret is not configured.' }, 500)

  const supplied = req.headers.get('x-billing-cron-secret')?.trim() ?? ''
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return json({ error: 'Forbidden' }, 403)
  }

  return null
}

function idempotencyPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9:._-]/g, '_')
    .slice(0, 80)
}

function makeIdempotencyKey(...parts: unknown[]): string {
  return parts.map(idempotencyPart).filter(Boolean).join(':').slice(0, 255)
}

function requestIdFromBody(body: Record<string, unknown>): string | null {
  return typeof body.request_id === 'string' && body.request_id.trim()
    ? idempotencyPart(body.request_id)
    : null
}

function createPaymentIntent(params: any, idempotencyKey?: string) {
  return idempotencyKey
    ? stripe.paymentIntents.create(params, { idempotencyKey })
    : stripe.paymentIntents.create(params)
}

function todayParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const value = (type: string) => Number(parts.find(p => p.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
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

function currentPeriodLabel(billingDay?: number | null): string {
  const now = todayParts()
  const effective = billingDay
    ? Math.min(billingDay, lastDayOf(now.year, now.month))
    : 0

  if (!billingDay || now.day >= effective) {
    return periodLabel(now.year, now.month)
  }

  const prev = addMonths(now.year, now.month, -1)
  return periodLabel(prev.year, prev.month)
}

function lastDayOfCurrentMonth(): number {
  const now = todayParts()
  return lastDayOf(now.year, now.month)
}

function todayLabel(): string {
  const today = todayParts()
  return dateLabel(today.year, today.month, today.day)
}

function paidThroughForPeriod(period: string, billingDay?: number | null): string | null {
  if (!billingDay || !/^\d{4}-\d{2}$/.test(period)) return null
  const [y, m] = period.split('-').map(Number)
  const next = addMonths(y, m, 1)
  const nextStartDay = Math.min(billingDay, lastDayOf(next.year, next.month))
  const paidThrough = new Date(Date.UTC(next.year, next.month - 1, nextStartDay) - 86400000)
  return dateLabel(paidThrough.getUTCFullYear(), paidThrough.getUTCMonth() + 1, paidThrough.getUTCDate())
}

function isPaidThroughToday(paidThroughDate?: string | null): boolean {
  return !!paidThroughDate && paidThroughDate >= todayLabel()
}

function periodCovered(period: string, tenancy: any): boolean {
  const paidThroughDate = tenancy.paid_through_date as string | null | undefined
  if (!paidThroughDate) return false
  const fullPeriodPaidThrough = paidThroughForPeriod(period, tenancy.billing_day)
  if (fullPeriodPaidThrough && paidThroughDate >= fullPeriodPaidThrough) return true
  return period === currentPeriodLabel(tenancy.billing_day) && isPaidThroughToday(paidThroughDate)
}

async function extendPaidThrough(tenancy: any, periods: string[]) {
  const candidates = periods
    .map(period => paidThroughForPeriod(period, tenancy.billing_day))
    .filter(Boolean) as string[]
  const paidThroughCandidates = [tenancy.paid_through_date, ...candidates]
    .filter(Boolean)
    .sort()
  const paidThroughDate = paidThroughCandidates[paidThroughCandidates.length - 1] as string | undefined

  if (paidThroughDate && paidThroughDate !== tenancy.paid_through_date) {
    await supabase.from('storage_tenancies')
      .update({ paid_through_date: paidThroughDate })
      .eq('id', tenancy.id)
    tenancy.paid_through_date = paidThroughDate
  }
}

async function chargeUnit(tenancy: any, period: string, idempotencyKey?: string) {
  const customer = tenancy.customers as { stripe_customer_id: string | null; stripe_payment_method_id: string | null } | null
  if (!customer?.stripe_payment_method_id || !customer?.stripe_customer_id) {
    return { status: 'skipped', reason: 'no_card' }
  }

  if (periodCovered(period, tenancy)) {
    return { status: 'skipped', reason: 'already_paid' }
  }

  const { data: existing } = await supabase
    .from('storage_payments')
    .select('id')
    .eq('tenancy_id', tenancy.id)
    .eq('period_label', period)
    .maybeSingle()

  if (existing) {
    await extendPaidThrough(tenancy, [period])
    return { status: 'skipped', reason: 'already_paid' }
  }

  const pi = await createPaymentIntent(
    {
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
    },
    idempotencyKey,
  )

  await supabase.from('storage_payments').upsert(
    { tenancy_id: tenancy.id, period_label: period, paid_at: new Date().toISOString(), amount: pi.amount / 100 },
    { onConflict: 'tenancy_id,period_label' }
  )
  await extendPaidThrough(tenancy, [period])

  return { status: 'charged' }
}

function normalizeExtraAmount(value: unknown): number {
  const amount = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function normalizeMonths(value: unknown): number {
  if (value === undefined || value === null) return 1
  const months = Number(value)
  if (!Number.isFinite(months)) return 1
  return Math.max(0, Math.min(Math.floor(months), 24))
}

function normalizePeriods(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  for (const period of value) {
    if (typeof period === 'string' && /^\d{4}-\d{2}$/.test(period)) seen.add(period)
  }
  return [...seen].slice(0, 24)
}

async function chargePeriods(tenancy: any, periods: string[], extraAmount: number, idempotencyKey?: string) {
  const customer = tenancy.customers as { stripe_customer_id: string | null; stripe_payment_method_id: string | null } | null
  if (!customer?.stripe_payment_method_id || !customer?.stripe_customer_id) {
    return { status: 'skipped', reason: 'no_card', periods: [] }
  }

  let unpaidPeriods = periods
  if (periods.length > 0) {
    const { data: existing } = await supabase
      .from('storage_payments')
      .select('period_label')
      .eq('tenancy_id', tenancy.id)
      .in('period_label', periods)

    const paidSet = new Set((existing ?? []).map((p: any) => p.period_label))
    unpaidPeriods = periods.filter(p => !paidSet.has(p) && !periodCovered(p, tenancy))
  } else {
    unpaidPeriods = unpaidPeriods.filter(p => !periodCovered(p, tenancy))
  }

  const monthlyRate = Number(tenancy.monthly_rate ?? 0)
  if (unpaidPeriods.length > 0 && monthlyRate <= 0) {
    return { status: 'skipped', reason: 'no_rate', periods: [] }
  }

  const amount = monthlyRate * unpaidPeriods.length + extraAmount
  if (amount <= 0) {
    return { status: 'skipped', reason: periods.length ? 'already_paid' : 'no_amount', periods: [] }
  }

  const metadata: Record<string, string> = {
    unit_id: tenancy.unit_id,
    tenancy_id: tenancy.id,
    unit_number: tenancy.unit_number ?? '',
    months: String(unpaidPeriods.length),
    monthly_rate: String(monthlyRate),
    extra_amount: String(extraAmount),
  }
  if (unpaidPeriods.length > 0) metadata.period_label = unpaidPeriods.join(',')

  const pi = await createPaymentIntent(
    {
      amount: Math.round(amount * 100),
      currency: 'cad',
      customer: customer.stripe_customer_id,
      payment_method: customer.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata,
    },
    idempotencyKey,
  )

  if (unpaidPeriods.length > 0) {
    const inserts = unpaidPeriods.map(p => ({
      tenancy_id: tenancy.id,
      period_label: p,
      paid_at: new Date().toISOString(),
      amount: monthlyRate,
    }))
    await supabase.from('storage_payments').upsert(inserts, { onConflict: 'tenancy_id,period_label' })
    await extendPaidThrough(tenancy, unpaidPeriods)
  }

  return { status: 'charged', periods: unpaidPeriods, amount: pi.amount / 100 }
}

async function markCreditRefunded(body: Record<string, unknown>) {
  const creditId = typeof body.credit_id === 'string' ? body.credit_id : ''
  if (!creditId) return json({ error: 'credit_id required' }, 400)

  const { data, error } = await supabase
    .from('customer_credits')
    .update({ status: 'refunded', resolved_at: new Date().toISOString() })
    .eq('id', creditId)
    .eq('status', 'open')
    .select('*, storage_units(unit_number)')
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!data) return json({ error: 'credit not found or already resolved' }, 404)

  return json({ ok: true, credit: data })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    if (body.action === 'mark_credit_refunded') {
      const authError = await authorizeManualBilling(req, body)
      if (authError) return authError
      return await markCreditRefunded(body)
    }

    // ── single unit charge (manual "Charge now" or one-time) ─────────────────
    if (body.unit_id) {
      const authError = await authorizeManualBilling(req, body)
      if (authError) return authError

      // Look up the active tenancy for this unit
      const { data: tenancy, error } = await supabase
        .from('storage_tenancies')
        .select('*, customers(stripe_customer_id, stripe_payment_method_id), storage_units(unit_number)')
        .eq('unit_id', body.unit_id)
        .is('end_date', null)
        .maybeSingle()

      if (error || !tenancy) return new Response(JSON.stringify({ error: 'no active tenancy for unit' }), { status: 404, headers: CORS })

      // Flatten unit_number for metadata
      tenancy.unit_number = (tenancy.storage_units as any)?.unit_number ?? ''

      const extraAmount = normalizeExtraAmount(body.extra_amount)
      const requestedPeriods = normalizePeriods(body.periods)
      const requestId = requestIdFromBody(body)
      if (requestedPeriods) {
        const fallback = [
          requestedPeriods.join('_') || 'extra',
          Math.round(extraAmount * 100),
        ]
        const idempotencyKey = makeIdempotencyKey('manual', tenancy.id, requestId ?? fallback.join(':'))
        const result = await chargePeriods(tenancy, requestedPeriods, extraAmount, idempotencyKey)
        return json({ ok: true, ...result })
      }

      const months = normalizeMonths(body.months)

      if (months === 1 && extraAmount === 0) {
        if (!tenancy.monthly_rate) return new Response(JSON.stringify({ error: 'no rate set' }), { status: 400, headers: CORS })
        const billingPeriod = currentPeriodLabel(tenancy.billing_day)
        const idempotencyKey = makeIdempotencyKey('manual', tenancy.id, requestId ?? billingPeriod)
        const result = await chargeUnit(tenancy, billingPeriod, idempotencyKey)
        return json({ ok: true, period: billingPeriod, ...result })
      }

      // Multi-month one-time charge, or an extra-only charge.
      const billingPeriod = currentPeriodLabel(tenancy.billing_day)
      const [y, m] = billingPeriod.split('-').map(Number)
      const candidatePeriods = Array.from({ length: months + 24 }, (_, i) => {
        const d = addMonths(y, m, i)
        return periodLabel(d.year, d.month)
      })

      const { data: existing } = await supabase
        .from('storage_payments')
        .select('period_label')
        .eq('tenancy_id', tenancy.id)
        .in('period_label', candidatePeriods)

      const paidSet = new Set((existing ?? []).map((p: any) => p.period_label))
      const unpaidPeriods = candidatePeriods.filter(p => !paidSet.has(p) && !periodCovered(p, tenancy)).slice(0, months)

      if (unpaidPeriods.length === 0 && extraAmount === 0) {
        return json({ ok: true, status: 'skipped', reason: 'already_paid', periods: [] })
      }

      const fallback = [
        unpaidPeriods.join('_') || 'extra',
        Math.round(extraAmount * 100),
      ]
      const idempotencyKey = makeIdempotencyKey('manual', tenancy.id, requestId ?? fallback.join(':'))
      const result = await chargePeriods(tenancy, unpaidPeriods, extraAmount, idempotencyKey)
      return json({ ok: true, ...result })
    }

    // ── daily cron: charge all due units ─────────────────────────────────────
    const cronError = authorizeCron(req)
    if (cronError) return cronError

    const { data: billingSettings } = await supabase
      .from('billing_settings').select('auto_charge_enabled').eq('id', 1).single()

    if (!billingSettings?.auto_charge_enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'auto_charge_disabled' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const todayDay = todayParts().day
    const lastDay  = lastDayOfCurrentMonth()

    const { data: tenancies, error } = await supabase
      .from('storage_tenancies')
      .select('*, customers(stripe_customer_id, stripe_payment_method_id), storage_units(unit_number)')
      .eq('payment_frequency', 'monthly')
      .not('monthly_rate', 'is', null)
      .not('customer_id', 'is', null)
      .is('end_date', null)

    if (error) throw error

    const due = (tenancies ?? []).filter(t => Math.min(t.billing_day, lastDay) === todayDay && !isPaidThroughToday(t.paid_through_date))
    const results = { charged: 0, skipped: 0, failed: 0 }

    for (const tenancy of due) {
      tenancy.unit_number = (tenancy.storage_units as any)?.unit_number ?? ''
      try {
        const billingPeriod = currentPeriodLabel(tenancy.billing_day)
        const idempotencyKey = makeIdempotencyKey('cron', tenancy.id, billingPeriod)
        const { status } = await chargeUnit(tenancy, billingPeriod, idempotencyKey)
        if (status === 'charged') results.charged++
        else results.skipped++
      } catch (err) {
        console.error(`Failed to charge tenancy ${tenancy.id}:`, err)
        results.failed++
      }
    }

    return new Response(JSON.stringify({ ok: true, period: currentPeriodLabel(), due: due.length, ...results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
