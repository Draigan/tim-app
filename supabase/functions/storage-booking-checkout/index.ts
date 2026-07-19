import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-04-22.dahlia' as any,
})

function supabaseUrl(): string {
  const url = Deno.env.get('APP_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('Supabase URL is not configured.')
  return url
}

function serviceRoleKey(): string {
  const appKey = Deno.env.get('APP_SUPABASE_SERVICE_ROLE_KEY')
  if (appKey) return appKey

  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!secretKeys) throw new Error('Supabase service key is not configured.')

  const parsed = JSON.parse(secretKeys) as Record<string, string>
  const firstKey = parsed.default ?? Object.values(parsed)[0]
  if (!firstKey) throw new Error('Supabase service key is not configured.')
  return firstKey
}

const supabase = createClient(supabaseUrl(), serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } })

const BUSINESS_TIME_ZONE = 'America/Toronto'
const SESSION_HOLD_SECONDS = 31 * 60
const DEFAULT_STORAGE_RETURN_ORIGIN = 'https://timberfellstorage.ca'

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function dollarsToCents(value: number): number {
  return Math.round(value * 100)
}

const SALES_TAX_RATE = numberFromEnv('STORAGE_BOOKING_TAX_RATE', 0.13)
const SALES_TAX_LABEL = Deno.env.get('STORAGE_BOOKING_TAX_LABEL')?.trim() || 'HST'
const FIXED_MONTHLY_RATE_CENTS = dollarsToCents(numberFromEnv('STORAGE_BOOKING_FIXED_MONTHLY_RATE', 150))
const PORTABLE_MONTHLY_RATE_CENTS = dollarsToCents(numberFromEnv('STORAGE_BOOKING_PORTABLE_MONTHLY_RATE', 200))
const DELIVERY_FEE_CENTS = dollarsToCents(numberFromEnv('STORAGE_BOOKING_DELIVERY_FEE', 100))
const PICKUP_FEE_CENTS = dollarsToCents(numberFromEnv('STORAGE_BOOKING_PICKUP_FEE', 100))

type UnitType = 'fixed' | 'portable'

type ResolvedUnit = {
  unitType: UnitType
  unitNumber: string
  unitLabel: string
  unitSize: string | null
  unitId?: string
  assetId?: string
}

type BookingLine = {
  kind: 'rent' | 'delivery' | 'pickup' | 'tax'
  label: string
  amount_cents: number
}

function allowedOrigins(): string[] {
  const raw = Deno.env.get('STORAGE_BOOKING_ALLOWED_ORIGINS')?.trim()
  if (!raw) {
    return ['https://timberfellstorage.ca', 'https://www.timberfellstorage.ca']
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function corsHeaders(req: Request): HeadersInit {
  const origins = allowedOrigins()
  const origin = req.headers.get('origin')
  const allowOrigin = origins.includes('*') ? '*' : origin && origins.includes(origin) ? origin : (origins[0] ?? 'null')

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function originAllowed(req: Request): boolean {
  const origins = allowedOrigins()
  if (origins.includes('*')) return true

  const origin = req.headers.get('origin')
  if (!origin) return true
  return origins.includes(origin)
}

const json = (req: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | null {
  const cleaned = cleanText(value)
  return cleaned || null
}

function normalizeEmail(value: unknown): string {
  return cleanText(value).toLowerCase()
}

function normalizePhone(value: unknown): string | null {
  const cleaned = cleanText(value)
  return cleaned || null
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

function returnOrigin(req: Request, body: Record<string, unknown>): string {
  const configured = normalizeOrigin(Deno.env.get('STORAGE_BOOKING_ORIGIN'))
  if (configured) return configured

  const requested = normalizeOrigin(body.return_origin) ?? normalizeOrigin(req.headers.get('origin'))
  const allowed = allowedOrigins()
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean) as string[]

  if (requested && (allowed.length === 0 || allowed.includes('*') || allowed.includes(requested))) return requested
  return allowed.find((origin) => origin !== '*') ?? DEFAULT_STORAGE_RETURN_ORIGIN
}

function checkoutPath(name: string, fallback: string): string {
  const value = Deno.env.get(name)?.trim()
  return value?.startsWith('/') ? value : fallback
}

function dollarsFromCents(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

function taxCentsForSubtotal(subtotalCents: number): number {
  return Math.round(subtotalCents * SALES_TAX_RATE)
}

function todayParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function dateLabel(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function todayLabel(): string {
  const today = todayParts()
  return dateLabel(today.year, today.month, today.day)
}

function fullName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

async function expireStaleBookings() {
  const { error } = await supabase
    .from('storage_booking_sessions')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())

  if (error) throw error
}

async function pendingBookingExists(field: 'unit_id' | 'asset_id', id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('storage_booking_sessions')
    .select('id')
    .eq(field, id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

async function resolveFixedUnit(unitNumber: string): Promise<ResolvedUnit> {
  if (!/^COM\d+$/i.test(unitNumber)) {
    throw new ResponseError('That on-site unit is not available for online booking.', 400)
  }

  const { data: unit, error: unitError } = await supabase
    .from('storage_units')
    .select('id, unit_number, size')
    .eq('unit_number', unitNumber)
    .limit(1)
    .maybeSingle()

  if (unitError) throw unitError
  if (!unit) {
    throw new ResponseError('That storage unit is no longer available.', 404)
  }

  const { data: activeTenancy, error: tenancyError } = await supabase
    .from('storage_tenancies')
    .select('id')
    .eq('unit_id', unit.id)
    .eq('storage_kind', 'fixed_unit')
    .is('end_date', null)
    .limit(1)
    .maybeSingle()

  if (tenancyError) throw tenancyError
  if (activeTenancy || (await pendingBookingExists('unit_id', unit.id))) {
    throw new ResponseError('That storage unit was just booked. Please choose another unit.', 409)
  }

  const displayNumber = String(unit.unit_number ?? unitNumber)
  return {
    unitType: 'fixed',
    unitNumber: displayNumber,
    unitLabel: `On-site storage ${displayNumber}`,
    unitSize: unit.size,
    unitId: unit.id,
  }
}

async function resolvePortableUnit(unitNumber: string): Promise<ResolvedUnit> {
  const { data: types, error: typeError } = await supabase.from('asset_types').select('id').eq('is_storage', true)

  if (typeError) throw typeError
  const storageTypeIds = (types ?? []).map((type: any) => type.id).filter(Boolean)
  if (!storageTypeIds.length) {
    throw new ResponseError('No portable storage units are available right now.', 404)
  }

  const { data: assets, error: assetError } = await supabase
    .from('assets')
    .select('id, label, size, asset_type_id')
    .eq('archived', false)
    .eq('label', unitNumber)
    .in('asset_type_id', storageTypeIds)
    .limit(1)

  if (assetError) throw assetError
  const asset = assets?.[0]
  if (!asset) {
    throw new ResponseError('That portable storage unit is no longer available.', 404)
  }

  const [{ data: deployment, error: deploymentError }, { data: rental, error: rentalError }] = await Promise.all([
    supabase.from('deployments').select('id').eq('asset_id', asset.id).is('picked_up_at', null).limit(1).maybeSingle(),
    supabase.from('portable_storage_rentals').select('id').eq('asset_id', asset.id).limit(1).maybeSingle(),
  ])

  if (deploymentError) throw deploymentError
  if (rentalError) throw rentalError
  if (deployment || rental || (await pendingBookingExists('asset_id', asset.id))) {
    throw new ResponseError('That portable storage unit was just booked. Please choose another unit.', 409)
  }

  const displayNumber = String(asset.label ?? unitNumber)
  return {
    unitType: 'portable',
    unitNumber: displayNumber,
    unitLabel: `Portable storage ${displayNumber}`,
    unitSize: asset.size,
    assetId: asset.id,
  }
}

function bookingLines(unit: ResolvedUnit): {
  lines: BookingLine[]
  subtotalCents: number
  taxCents: number
  totalCents: number
} {
  const rentCents = unit.unitType === 'fixed' ? FIXED_MONTHLY_RATE_CENTS : PORTABLE_MONTHLY_RATE_CENTS
  const deliveryCents = unit.unitType === 'portable' ? DELIVERY_FEE_CENTS : 0
  const pickupCents = unit.unitType === 'portable' ? PICKUP_FEE_CENTS : 0
  const subtotalCents = rentCents + deliveryCents + pickupCents
  const taxCents = taxCentsForSubtotal(subtotalCents)
  const lines: BookingLine[] = [
    {
      kind: 'rent',
      label: `${unit.unitLabel} - first month`,
      amount_cents: rentCents,
    },
  ]

  if (deliveryCents > 0) {
    lines.push({
      kind: 'delivery',
      label: 'Delivery',
      amount_cents: deliveryCents,
    })
  }
  if (pickupCents > 0) {
    lines.push({ kind: 'pickup', label: 'Pickup', amount_cents: pickupCents })
  }
  if (taxCents > 0) {
    lines.push({ kind: 'tax', label: SALES_TAX_LABEL, amount_cents: taxCents })
  }

  return {
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  }
}

class ResponseError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405)
  }
  if (!originAllowed(req)) return json(req, { error: 'Forbidden' }, 403)

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const unitType = cleanText(body.unit_type) as UnitType
    const unitNumber = cleanText(body.unit_id)
    const firstName = cleanText(body.first_name)
    const lastName = cleanText(body.last_name)
    const customerName = fullName(firstName, lastName)
    const email = normalizeEmail(body.email)
    const phone = normalizePhone(body.phone)
    const serviceAddress = optionalText(body.address)
    const city = optionalText(body.city)
    const province = optionalText(body.province)
    const country = optionalText(body.country) ?? 'Canada'
    const postalCode = optionalText(body.postal_code)

    if (unitType !== 'fixed' && unitType !== 'portable') {
      return json(req, { error: 'Choose on-site or portable storage.' }, 400)
    }
    if (!unitNumber) return json(req, { error: 'Choose a storage unit.' }, 400)
    if (!customerName) return json(req, { error: 'Name is required.' }, 400)
    if (!email || !email.includes('@')) {
      return json(req, { error: 'A valid email is required.' }, 400)
    }
    if (!phone) return json(req, { error: 'Phone number is required.' }, 400)
    if (unitType === 'portable' && !serviceAddress) {
      return json(req, { error: 'Delivery address is required.' }, 400)
    }

    await expireStaleBookings()

    const resolved = unitType === 'fixed' ? await resolveFixedUnit(unitNumber) : await resolvePortableUnit(unitNumber)
    const isPortableBooking = resolved.unitType === 'portable'
    const startDate = todayLabel()
    const billingDay = Number(startDate.slice(-2))
    const rentCents = resolved.unitType === 'fixed' ? FIXED_MONTHLY_RATE_CENTS : PORTABLE_MONTHLY_RATE_CENTS
    const deliveryCents = resolved.unitType === 'portable' ? DELIVERY_FEE_CENTS : 0
    const pickupCents = resolved.unitType === 'portable' ? PICKUP_FEE_CENTS : 0
    const { lines, subtotalCents, taxCents, totalCents } = bookingLines(resolved)
    const expiresAt = new Date(Date.now() + SESSION_HOLD_SECONDS * 1000)

    const { data: booking, error: insertError } = await supabase
      .from('storage_booking_sessions')
      .insert({
        unit_type: resolved.unitType,
        unit_number: resolved.unitNumber,
        unit_label: resolved.unitLabel,
        unit_size: resolved.unitSize,
        unit_id: resolved.unitId ?? null,
        asset_id: resolved.assetId ?? null,
        first_name: firstName,
        last_name: lastName || null,
        customer_name: customerName,
        phone,
        email,
        service_address: isPortableBooking ? serviceAddress : null,
        city: isPortableBooking ? city : null,
        province: isPortableBooking ? province : null,
        country: isPortableBooking ? country : null,
        postal_code: isPortableBooking ? postalCode : null,
        start_date: startDate,
        billing_day: billingDay,
        monthly_rate: dollarsFromCents(rentCents),
        rent_amount: dollarsFromCents(rentCents),
        delivery_fee_amount: dollarsFromCents(deliveryCents),
        pickup_fee_amount: dollarsFromCents(pickupCents),
        subtotal_amount: dollarsFromCents(subtotalCents),
        tax_amount: dollarsFromCents(taxCents),
        amount: dollarsFromCents(totalCents),
        tax_rate: SALES_TAX_RATE,
        tax_label: taxCents > 0 ? SALES_TAX_LABEL : null,
        items: lines,
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single()

    if (insertError?.code === '23505') {
      return json(
        req,
        {
          error: 'That storage unit was just booked. Please choose another unit.',
        },
        409,
      )
    }
    if (insertError) throw insertError

    const origin = returnOrigin(req, body)
    const successPath = checkoutPath('STORAGE_BOOKING_SUCCESS_PATH', '/payment-success')
    const cancelPath = checkoutPath('STORAGE_BOOKING_CANCEL_PATH', '/payment-cancelled')
    const metadata = {
      source: 'storage_booking',
      booking_session_id: booking.id,
      unit_type: resolved.unitType,
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_creation: 'always',
        customer_email: email,
        client_reference_id: booking.id,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        line_items: lines.map((line) => ({
          quantity: 1,
          price_data: {
            currency: 'cad',
            unit_amount: line.amount_cents,
            product_data: { name: line.label },
          },
        })),
        metadata,
        payment_intent_data: {
          receipt_email: email,
          setup_future_usage: 'off_session',
          metadata,
        },
        success_url: `${origin}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${cancelPath}`,
      })

      const { error: updateError } = await supabase
        .from('storage_booking_sessions')
        .update({
          stripe_checkout_session_id: session.id,
          expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : expiresAt.toISOString(),
        })
        .eq('id', booking.id)

      if (updateError) throw updateError
      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL.')
      }

      return json(req, {
        ok: true,
        checkout_url: session.url,
        booking_session_id: booking.id,
        session_id: session.id,
        expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : expiresAt.toISOString(),
      })
    } catch (err) {
      await supabase
        .from('storage_booking_sessions')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', booking.id)
      throw err
    }
  } catch (err) {
    if (err instanceof ResponseError) {
      return json(req, { error: err.message }, err.status)
    }
    console.error(err)
    return json(req, { error: 'Could not start storage checkout.' }, 500)
  }
})
