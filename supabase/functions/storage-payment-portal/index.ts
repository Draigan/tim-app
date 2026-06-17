import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const BUSINESS_TIME_ZONE = 'America/Toronto'
const SALES_TAX_RATE = 0.13
const SALES_TAX_LABEL = 'HST'
const MAX_PORTAL_PERIODS = 24
const MAX_PREPAY_MONTHS = 12

function cors(req: Request) {
  return {
    'Access-Control-Allow-Origin': req.headers.get('origin') ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const json = (req: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  })

function dollarsFromCents(value: number): number {
  return Number((value / 100).toFixed(2))
}

function taxCentsForSubtotal(subtotalCents: number): number {
  return Math.round(subtotalCents * SALES_TAX_RATE)
}

function normalizePaymentPin(value: unknown): string {
  return typeof value === 'string' && /^\d{5}$/.test(value.trim()) ? value.trim() : ''
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

async function slowInvalid(req: Request) {
  await new Promise(resolve => setTimeout(resolve, 250))
  return json(req, { error: 'No payment account found for those details.' }, 404)
}

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'Customer'
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
  const effective = billingDay ? Math.min(billingDay, lastDayOf(now.year, now.month)) : 0
  if (!billingDay || now.day >= effective) return periodLabel(now.year, now.month)
  const prev = addMonths(now.year, now.month, -1)
  return periodLabel(prev.year, prev.month)
}

function periodStartForPeriod(period: string, billingDay?: number | null): string | null {
  if (!billingDay || !/^\d{4}-\d{2}$/.test(period)) return null
  const [year, month] = period.split('-').map(Number)
  return dateLabel(year, month, Math.min(billingDay, lastDayOf(year, month)))
}

function paidThroughForPeriod(period: string, billingDay?: number | null): string | null {
  if (!billingDay || !/^\d{4}-\d{2}$/.test(period)) return null
  const [year, month] = period.split('-').map(Number)
  const next = addMonths(year, month, 1)
  const nextStartDay = Math.min(billingDay, lastDayOf(next.year, next.month))
  const paidThrough = new Date(Date.UTC(next.year, next.month - 1, nextStartDay) - 86400000)
  return dateLabel(paidThrough.getUTCFullYear(), paidThrough.getUTCMonth() + 1, paidThrough.getUTCDate())
}

function periodLabelForDate(value: string | null | undefined, billingDay?: number | null): string | null {
  if (!value || !billingDay) return null
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const effective = Math.min(billingDay, lastDayOf(year, month))
  if (day >= effective) return periodLabel(year, month)
  const prev = addMonths(year, month, -1)
  return periodLabel(prev.year, prev.month)
}

function dateMs(label: string): number | null {
  const [year, month, day] = label.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  return Date.UTC(year, month - 1, day)
}

function daysInclusive(start: string, end: string): number {
  const startMs = dateMs(start)
  const endMs = dateMs(end)
  if (startMs === null || endMs === null || endMs < startMs) return 0
  return Math.floor((endMs - startMs) / 86400000) + 1
}

function amountCentsForPeriod(period: string, rental: any): number {
  const monthlyRate = Number(rental.monthly_rate ?? 0)
  const monthlyRateCents = Number.isFinite(monthlyRate) ? Math.round(monthlyRate * 100) : 0
  if (monthlyRateCents <= 0) return 0

  const start = periodStartForPeriod(period, rental.billing_day)
  const end = paidThroughForPeriod(period, rental.billing_day)
  if (!start || !end) return monthlyRateCents

  const moveInDate = typeof rental.move_in_date === 'string' ? rental.move_in_date : null
  if (moveInDate && moveInDate > end) return 0

  const chargeStart = moveInDate && moveInDate > start ? moveInDate : start
  const totalDays = daysInclusive(start, end)
  const billableDays = daysInclusive(chargeStart, end)
  if (totalDays <= 0 || billableDays <= 0) return 0
  if (billableDays >= totalDays) return monthlyRateCents
  return Math.round(monthlyRateCents * billableDays / totalDays)
}

function periodCovered(period: string, rental: any, paidSet: Set<string>): boolean {
  if (paidSet.has(period)) return true
  const paidThroughDate = rental.paid_through_date as string | null | undefined
  if (!paidThroughDate) return false
  const fullPeriodPaidThrough = paidThroughForPeriod(period, rental.billing_day)
  if (fullPeriodPaidThrough && paidThroughDate >= fullPeriodPaidThrough) return true
  return period === currentPeriodLabel(rental.billing_day) && paidThroughDate >= todayLabel()
}

function todayLabel(): string {
  const today = todayParts()
  return dateLabel(today.year, today.month, today.day)
}

function generatePeriods(rental: any, monthsAhead = 0): string[] {
  if (!rental.billing_day) return []
  const current = currentPeriodLabel(rental.billing_day)
  const [currentYear, currentMonth] = current.split('-').map(Number)
  const lastAllowed = addMonths(currentYear, currentMonth, Math.max(0, monthsAhead))
  const limit = periodLabel(lastAllowed.year, lastAllowed.month)
  const first = periodLabelForDate(rental.move_in_date, rental.billing_day) ?? current
  if (first > limit) return []

  const [startYear, startMonth] = first.split('-').map(Number)
  const periods: string[] = []
  for (let offset = 0; offset < 48 + monthsAhead; offset++) {
    const next = addMonths(startYear, startMonth, offset)
    const label = periodLabel(next.year, next.month)
    if (label > limit) break
    periods.push(label)
  }
  return periods
}

function formatPeriod(label: string): string {
  const [year, month] = label.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function amountToCents(value: unknown): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

function chargeResponse(charge: PortalCharge) {
  return {
    kind: charge.kind,
    unit_key: charge.unit_key,
    month_index: charge.month_index,
    period_label: charge.period_label,
    period: formatPeriod(charge.period_label),
    unit_label: charge.unit_label,
    subtotal: dollarsFromCents(charge.subtotal_cents),
    late_fee: dollarsFromCents(charge.late_fee_cents),
    tax: dollarsFromCents(charge.tax_cents),
    total: dollarsFromCents(charge.total_cents),
  }
}

type PortalCharge = {
  source: 'fixed' | 'portable'
  kind: 'due' | 'prepay'
  unit_key: string
  month_index: number
  tenancy_id?: string
  unit_id?: string
  portable_rental_id?: string
  asset_id?: string
  unit_label: string
  period_label: string
  billing_day: number | null
  base_cents: number
  late_fee_cents: number
  subtotal_cents: number
  tax_cents: number
  total_cents: number
}

function summarize(charges: PortalCharge[]) {
  const subtotalCents = charges.reduce((sum, charge) => sum + charge.subtotal_cents, 0)
  const taxCents = charges.reduce((sum, charge) => sum + charge.tax_cents, 0)
  const totalCents = charges.reduce((sum, charge) => sum + charge.total_cents, 0)
  return {
    subtotal: dollarsFromCents(subtotalCents),
    tax: dollarsFromCents(taxCents),
    total: dollarsFromCents(totalCents),
    subtotal_cents: subtotalCents,
    tax_cents: taxCents,
    total_cents: totalCents,
  }
}

async function verifyCustomer(req: Request, body: Record<string, unknown>) {
  const paymentPin = normalizePaymentPin(body.payment_pin ?? body.pin)
  const phone = normalizePhone(body.phone)
  if (!paymentPin || !phone) return { response: await slowInvalid(req) }

  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone, email, stripe_customer_id, payment_pin')
    .eq('payment_pin', paymentPin)
    .is('archived_at', null)

  if (error) throw error

  const customer = (data ?? []).find((row: any) => normalizePhone(row.phone) === phone)
  if (!customer) return { response: await slowInvalid(req) }
  return { customer }
}

async function collectOutstandingCharges(customerId: string): Promise<PortalCharge[]> {
  const [{ data: tenancies, error: tenancyError }, { data: rentals, error: rentalError }] = await Promise.all([
    supabase
      .from('storage_tenancies')
      .select('id, unit_id, monthly_rate, billing_day, payment_frequency, move_in_date, paid_through_date, storage_units(unit_number)')
      .eq('customer_id', customerId)
      .eq('payment_frequency', 'monthly')
      .is('end_date', null),
    supabase
      .from('portable_storage_rentals')
      .select('id, asset_id, monthly_rate, billing_day, payment_frequency, move_in_date, paid_through_date, assets(label)')
      .eq('customer_id', customerId)
      .eq('payment_frequency', 'monthly'),
  ])

  if (tenancyError) throw tenancyError
  if (rentalError) throw rentalError

  const tenancyIds = (tenancies ?? []).map((row: any) => row.id)
  const rentalIds = (rentals ?? []).map((row: any) => row.id)
  const assetIds = (rentals ?? []).map((row: any) => row.asset_id)

  const [
    { data: storagePayments, error: storagePaymentError },
    { data: portablePayments, error: portablePaymentError },
    { data: storageFees, error: storageFeeError },
    { data: portableFees, error: portableFeeError },
  ] = await Promise.all([
    tenancyIds.length
      ? supabase.from('storage_payments').select('tenancy_id, period_label').in('tenancy_id', tenancyIds)
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase.from('portable_storage_payments').select('asset_id, period_label').in('asset_id', assetIds)
      : Promise.resolve({ data: [], error: null }),
    tenancyIds.length
      ? supabase.from('storage_late_fees').select('tenancy_id, period_label, amount').eq('status', 'open').in('tenancy_id', tenancyIds)
      : Promise.resolve({ data: [], error: null }),
    rentalIds.length
      ? supabase.from('storage_late_fees').select('portable_rental_id, period_label, amount').eq('status', 'open').in('portable_rental_id', rentalIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (storagePaymentError) throw storagePaymentError
  if (portablePaymentError) throw portablePaymentError
  if (storageFeeError) throw storageFeeError
  if (portableFeeError) throw portableFeeError

  const storagePaid = new Map<string, Set<string>>()
  for (const payment of storagePayments ?? []) {
    if (!storagePaid.has(payment.tenancy_id)) storagePaid.set(payment.tenancy_id, new Set())
    storagePaid.get(payment.tenancy_id)!.add(payment.period_label)
  }

  const portablePaid = new Map<string, Set<string>>()
  for (const payment of portablePayments ?? []) {
    if (!portablePaid.has(payment.asset_id)) portablePaid.set(payment.asset_id, new Set())
    portablePaid.get(payment.asset_id)!.add(payment.period_label)
  }

  const storageLateFees = new Map<string, number>()
  for (const fee of storageFees ?? []) {
    storageLateFees.set(`${fee.tenancy_id}:${fee.period_label}`, amountToCents(fee.amount))
  }

  const portableLateFees = new Map<string, number>()
  for (const fee of portableFees ?? []) {
    portableLateFees.set(`${fee.portable_rental_id}:${fee.period_label}`, amountToCents(fee.amount))
  }

  const charges: PortalCharge[] = []

  for (const tenancy of tenancies ?? []) {
    if (!tenancy.billing_day || Number(tenancy.monthly_rate ?? 0) <= 0) continue
    const paidSet = storagePaid.get(tenancy.id) ?? new Set<string>()
    const unitNumber = (tenancy.storage_units as any)?.unit_number
    const unitLabel = unitNumber ? `Unit ${unitNumber}` : 'Storage unit'
    const current = currentPeriodLabel(tenancy.billing_day)
    let prepayIndex = 0

    for (const period of generatePeriods(tenancy, MAX_PREPAY_MONTHS)) {
      if (periodCovered(period, tenancy, paidSet)) continue
      const isPrepay = period > current
      // Future months are billed in full: no proration, no late fees.
      const baseCents = amountCentsForPeriod(period, tenancy)
      const lateFeeCents = isPrepay ? 0 : (storageLateFees.get(`${tenancy.id}:${period}`) ?? 0)
      const subtotalCents = baseCents + lateFeeCents
      if (subtotalCents <= 0) continue
      const taxCents = taxCentsForSubtotal(subtotalCents)
      charges.push({
        source: 'fixed',
        kind: isPrepay ? 'prepay' : 'due',
        unit_key: `fixed:${tenancy.id}`,
        month_index: isPrepay ? prepayIndex++ : 0,
        tenancy_id: tenancy.id,
        unit_id: tenancy.unit_id,
        unit_label: unitLabel,
        period_label: period,
        billing_day: tenancy.billing_day,
        base_cents: baseCents,
        late_fee_cents: lateFeeCents,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: subtotalCents + taxCents,
      })
    }
  }

  for (const rental of rentals ?? []) {
    if (!rental.billing_day || Number(rental.monthly_rate ?? 0) <= 0) continue
    const paidSet = portablePaid.get(rental.asset_id) ?? new Set<string>()
    const unitLabel = (rental.assets as any)?.label ?? 'Portable storage'
    const current = currentPeriodLabel(rental.billing_day)
    let prepayIndex = 0

    for (const period of generatePeriods(rental, MAX_PREPAY_MONTHS)) {
      if (periodCovered(period, rental, paidSet)) continue
      const isPrepay = period > current
      const baseCents = amountCentsForPeriod(period, rental)
      const lateFeeCents = isPrepay ? 0 : (portableLateFees.get(`${rental.id}:${period}`) ?? 0)
      const subtotalCents = baseCents + lateFeeCents
      if (subtotalCents <= 0) continue
      const taxCents = taxCentsForSubtotal(subtotalCents)
      charges.push({
        source: 'portable',
        kind: isPrepay ? 'prepay' : 'due',
        unit_key: `portable:${rental.id}`,
        month_index: isPrepay ? prepayIndex++ : 0,
        portable_rental_id: rental.id,
        asset_id: rental.asset_id,
        unit_label: unitLabel,
        period_label: period,
        billing_day: rental.billing_day,
        base_cents: baseCents,
        late_fee_cents: lateFeeCents,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: subtotalCents + taxCents,
      })
    }
  }

  return charges.sort((a, b) => (
    a.period_label.localeCompare(b.period_label)
    || a.unit_label.localeCompare(b.unit_label, undefined, { numeric: true })
  ))
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

function allowedReturnOrigin(req: Request, body: Record<string, unknown>): string {
  const configured = normalizeOrigin(Deno.env.get('PAYMENT_PORTAL_ORIGIN'))
  if (configured) return configured

  const requested = normalizeOrigin(body.return_origin) ?? normalizeOrigin(req.headers.get('origin'))
  const allowed = (Deno.env.get('PAYMENT_PORTAL_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map(origin => normalizeOrigin(origin))
    .filter(Boolean) as string[]

  if (requested && (!allowed.length || allowed.includes(requested))) return requested
  return normalizeOrigin(Deno.env.get('APP_PUBLIC_ORIGIN')) ?? 'https://fenelonless.ca'
}

function checkoutPath(name: string, fallback: string): string {
  const value = Deno.env.get(name)?.trim()
  return value?.startsWith('/') ? value : fallback
}

function normalizePrepayMonths(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(Math.floor(parsed), MAX_PREPAY_MONTHS))
}

async function ensureStripeCustomer(customer: any): Promise<string> {
  if (customer.stripe_customer_id) return customer.stripe_customer_id

  const stripeCustomer = await stripe.customers.create({
    name: customer.name ?? undefined,
    email: customer.email ?? undefined,
    metadata: { customer_id: customer.id },
  })

  await supabase
    .from('customers')
    .update({ stripe_customer_id: stripeCustomer.id })
    .eq('id', customer.id)

  return stripeCustomer.id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : 'lookup'
    if (action !== 'lookup' && action !== 'checkout') {
      return json(req, { error: 'Unknown payment portal action.' }, 400)
    }

    const verified = await verifyCustomer(req, body)
    if (verified.response) return verified.response
    const customer = verified.customer

    const outstanding = await collectOutstandingCharges(customer.id)
    const dueAll = outstanding.filter(charge => charge.kind === 'due')
    const due = dueAll.slice(0, MAX_PORTAL_PERIODS)
    const prepay = outstanding.filter(charge => charge.kind === 'prepay')
    const dueSummary = summarize(due)

    if (action === 'lookup') {
      const dueMonths = new Set(due.map(charge => charge.period_label)).size
      const unitCount = new Set(outstanding.map(charge => charge.unit_key)).size
      const prepayAvailable = prepay.reduce((max, charge) => Math.max(max, charge.month_index + 1), 0)
      return json(req, {
        ok: true,
        customer: { name: firstName(customer.name) },
        summary: {
          due_subtotal: dueSummary.subtotal,
          due_tax: dueSummary.tax,
          due_total: dueSummary.total,
          due_charge_count: due.length,
          due_month_count: dueMonths,
          due_truncated: dueAll.length > due.length,
          unit_count: unitCount,
          prepay_available_months: Math.min(prepayAvailable, MAX_PREPAY_MONTHS),
          tax_label: SALES_TAX_LABEL,
          tax_rate: SALES_TAX_RATE,
        },
        due: due.map(chargeResponse),
        prepay: prepay.map(chargeResponse),
      })
    }

    const prepayMonths = normalizePrepayMonths(body.prepay_months)
    const prepaySelected = prepay.filter(charge => charge.month_index < prepayMonths)
    const selected = [...due, ...prepaySelected]
    const selectedSummary = summarize(selected)
    if (selectedSummary.total_cents <= 0) {
      return json(req, { error: 'No payable balance selected.' }, 400)
    }

    const { data: portalPayment, error: insertError } = await supabase
      .from('storage_portal_payment_sessions')
      .insert({
        customer_id: customer.id,
        selected_count: selected.length,
        items: selected,
        subtotal_amount: selectedSummary.subtotal,
        tax_amount: selectedSummary.tax,
        amount: selectedSummary.total,
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    const stripeCustomerId = await ensureStripeCustomer(customer)
    const returnOrigin = allowedReturnOrigin(req, body)
    const successPath = checkoutPath('PAYMENT_PORTAL_SUCCESS_PATH', '/payment/success')
    const cancelPath = checkoutPath('PAYMENT_PORTAL_CANCEL_PATH', '/payment/cancelled')

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      client_reference_id: customer.id,
      line_items: selected.map(charge => ({
        quantity: 1,
        price_data: {
          currency: 'cad',
          unit_amount: charge.total_cents,
          product_data: {
            name: `${charge.unit_label} - ${formatPeriod(charge.period_label)}`,
            description: charge.late_fee_cents > 0
              ? `Includes ${SALES_TAX_LABEL} and a late fee`
              : `Includes ${SALES_TAX_LABEL}`,
          },
        },
      })),
      metadata: {
        source: 'storage_payment_portal',
        portal_payment_id: portalPayment.id,
        customer_id: customer.id,
      },
      payment_intent_data: {
        receipt_email: customer.email ?? undefined,
        metadata: {
          source: 'storage_payment_portal',
          portal_payment_id: portalPayment.id,
          customer_id: customer.id,
        },
      },
      success_url: `${returnOrigin}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnOrigin}${cancelPath}`,
    })

    const { error: updateError } = await supabase
      .from('storage_portal_payment_sessions')
      .update({
        stripe_checkout_session_id: session.id,
        expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      })
      .eq('id', portalPayment.id)

    if (updateError) throw updateError
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.')

    return json(req, {
      ok: true,
      checkout_url: session.url,
      session_id: session.id,
      expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    })
  } catch (err) {
    console.error(err)
    return json(req, { error: 'Could not start payment checkout.' }, 500)
  }
})
