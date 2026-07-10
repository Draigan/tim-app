import Stripe from 'https://esm.sh/stripe@16?target=deno'
import webpush from 'npm:web-push'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const ADMIN_EMAIL = (Deno.env.get('SUPERUSER_EMAIL') ?? Deno.env.get('ADMIN_EMAIL') ?? 'd@d.d').trim().toLowerCase()
const NOTIFICATION_INBOX_URL = '/notifications'

let webPushConfigured = false

function supabaseUrl(): string {
  const url = Deno.env.get('APP_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('Supabase URL is not configured.')
  return url
}

function serviceRoleKey(): string {
  const key = Deno.env.get('APP_SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key) throw new Error('Supabase service key is not configured.')
  return key
}

const supabase = createClient(
  supabaseUrl(),
  serviceRoleKey(),
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

function formatCad(value: number): string {
  const amount = Number.isFinite(value) ? value : 0
  return `$${amount.toFixed(2)}`
}

function plural(count: number, single: string, many = `${single}s`): string {
  return count === 1 ? single : many
}

function configureWebPush(): boolean {
  if (webPushConfigured) return true

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) {
    console.warn('Portal payment notification skipped: VAPID keys are not configured.')
    return false
  }

  webpush.setVapidDetails(`mailto:${ADMIN_EMAIL}`, publicKey, privateKey)
  webPushConfigured = true
  return true
}

async function pushToAdmin(title: string, body: string, url: string) {
  if (!configureWebPush()) return

  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 100 })
  const adminUser = users.find(u => u.email?.toLowerCase() === ADMIN_EMAIL)
  if (!adminUser) return

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', adminUser.id)

  if (error) throw error
  if (!subs?.length) return

  const payload = JSON.stringify({ title, body, url: NOTIFICATION_INBOX_URL })
  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  )

  const stale = subs.filter((_, i) => {
    const result = results[i]
    const code = result.status === 'rejected' ? (result.reason as any)?.statusCode : null
    return code === 410 || code === 404
  })

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale.map(s => s.endpoint))
  }
}

async function createAppNotification({
  title,
  body,
  url,
  type,
  severity = 'info',
  metadata = {},
}: {
  title: string
  body: string
  url: string
  type: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabase.from('app_notifications').insert({
    audience: 'billing',
    title,
    body,
    url,
    type,
    severity,
    metadata,
  })

  if (error) throw error
}

async function notifyAdminEvent({
  title,
  body,
  url,
  type,
  severity = 'info',
  metadata = {},
}: {
  title: string
  body: string
  url: string
  type: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}) {
  const results = await Promise.allSettled([
    createAppNotification({ title, body, url, type, severity, metadata }),
    pushToAdmin(title, body, url),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Admin notification failed.', result.reason)
    }
  }
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

function paymentRecordAmountsFromCents(subtotalCents: number, taxCents: number) {
  return {
    amount: dollarsFromCents(subtotalCents + taxCents),
    subtotal_amount: dollarsFromCents(subtotalCents),
    tax_amount: dollarsFromCents(taxCents),
    tax_rate: taxCents > 0 ? 0.13 : 0,
    tax_label: taxCents > 0 ? 'HST' : null,
  }
}

function centsFromAmount(value: unknown): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

function groupPeriodsBy(items: any[], idKey: string): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const item of items) {
    const id = typeof item[idKey] === 'string' ? item[idKey] : ''
    const period = typeof item.period_label === 'string' ? item.period_label : ''
    if (!id || !isPeriodLabel(period)) continue
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id)!.push(period)
  }
  return grouped
}

async function markStorageLateFeesPaid(idKey: 'tenancy_id' | 'portable_rental_id', items: any[]) {
  for (const [id, periods] of groupPeriodsBy(items, idKey)) {
    const { error } = await supabase
      .from('storage_late_fees')
      .update({ status: 'paid', resolved_at: new Date().toISOString() })
      .eq(idKey, id)
      .eq('status', 'open')
      .in('period_label', periods)

    if (error) throw error
  }
}

function uniqueLabels(items: any[]): string[] {
  return Array.from(new Set(
    items
      .map((item: any) => typeof item.unit_label === 'string' ? item.unit_label.trim() : '')
      .filter(Boolean)
  ))
}

async function portalCustomerName(customerId: unknown): Promise<string | null> {
  if (typeof customerId !== 'string' || !customerId) return null

  const { data, error } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    console.error('Could not load portal payment customer for notification.', error)
    return null
  }

  return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null
}

async function notifyPortalPayment(portalPayment: any, items: any[], amount: number) {
  const customer = await portalCustomerName(portalPayment.customer_id)
  const labels = uniqueLabels(items)
  const displayedLabels = labels.slice(0, 3).join(', ')
  const extraLabelCount = labels.length > 3 ? ` +${labels.length - 3} more` : ''
  const labelText = displayedLabels ? ` for ${displayedLabels}${extraLabelCount}` : ''
  const periods = new Set(items.map((item: any) => item.period_label).filter(isPeriodLabel))
  const periodText = periods.size
    ? `${periods.size} ${plural(periods.size, 'billing month')}`
    : `${items.length} ${plural(items.length, 'charge')}`
  const who = customer ?? 'A customer'

  await notifyAdminEvent({
    title: 'Online Payment Received',
    body: `${who} paid ${formatCad(amount)} online${labelText} (${periodText}).`,
    url: '/admin-revenue',
    type: 'online_payment',
    severity: 'success',
    metadata: {
      portal_payment_id: portalPayment.id,
      customer_id: portalPayment.customer_id ?? null,
      amount,
      item_count: items.length,
    },
  })
}

async function recordPortalPayment(session: Stripe.Checkout.Session) {
  const portalPaymentId = session.metadata?.portal_payment_id
  if (!portalPaymentId) return

  const { data: portalPayment, error: portalError } = await supabase
    .from('storage_portal_payment_sessions')
    .select('*')
    .eq('id', portalPaymentId)
    .maybeSingle()

  if (portalError) throw portalError
  if (!portalPayment || portalPayment.status === 'paid') return

  const expectedCents = centsFromAmount(portalPayment.amount)
  if (typeof session.amount_total === 'number' && session.amount_total !== expectedCents) {
    throw new Error(`Portal payment ${portalPaymentId} amount mismatch.`)
  }

  const items = Array.isArray(portalPayment.items) ? portalPayment.items : []
  const fixedItems = items.filter((item: any) => item.source === 'fixed' && item.tenancy_id)
  const portableItems = items.filter((item: any) => item.source === 'portable' && item.asset_id)
  const paidAt = new Date().toISOString()

  if (fixedItems.length) {
    const { error } = await supabase.from('storage_payments').upsert(
      fixedItems.map((item: any) => ({
        unit_id: item.unit_id ?? null,
        tenancy_id: item.tenancy_id,
        period_label: item.period_label,
        paid_at: paidAt,
        ...paymentRecordAmountsFromCents(Number(item.subtotal_cents ?? 0), Number(item.tax_cents ?? 0)),
      })),
      { onConflict: 'tenancy_id,period_label' },
    )
    if (error) throw error

    for (const [tenancyId, periods] of groupPeriodsBy(fixedItems, 'tenancy_id')) {
      await extendPaidThroughByLabels(tenancyId, periods)
    }
    await markStorageLateFeesPaid('tenancy_id', fixedItems)
  }

  if (portableItems.length) {
    const { error } = await supabase.from('portable_storage_payments').upsert(
      portableItems.map((item: any) => ({
        asset_id: item.asset_id,
        period_label: item.period_label,
        paid_at: paidAt,
        ...paymentRecordAmountsFromCents(Number(item.subtotal_cents ?? 0), Number(item.tax_cents ?? 0)),
      })),
      { onConflict: 'asset_id,period_label' },
    )
    if (error) throw error

    for (const [assetId, periods] of groupPeriodsBy(portableItems, 'asset_id')) {
      await extendPortablePaidThroughByLabels(assetId, periods)
    }
    await markStorageLateFeesPaid('portable_rental_id', portableItems)
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null

  const { error: updateError } = await supabase
    .from('storage_portal_payment_sessions')
    .update({
      status: 'paid',
      paid_at: paidAt,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq('id', portalPaymentId)

  if (updateError) throw updateError

  const paidAmount = typeof session.amount_total === 'number'
    ? dollarsFromCents(session.amount_total)
    : Number(portalPayment.amount ?? 0)

  await notifyPortalPayment(portalPayment, items, paidAmount).catch(err => {
    console.error('Portal payment notification failed.', err)
  })
}

function periodLabelFromDate(value: string | null | undefined): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7)
  const now = new Date()
  return periodLabel(now.getUTCFullYear(), now.getUTCMonth() + 1)
}

function bookingAddress(booking: any): string | null {
  const address = [
    booking.service_address,
    booking.city,
    booking.province,
    booking.postal_code,
    booking.country,
  ].map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean).join(', ')

  return address || null
}

function bookingPaymentAmounts(booking: any) {
  const amount = Number(booking.amount ?? 0)
  const subtotal = Number(booking.subtotal_amount ?? amount)
  const tax = Number(booking.tax_amount ?? 0)
  const taxRate = Number(booking.tax_rate ?? 0)
  const taxLabel = typeof booking.tax_label === 'string' && booking.tax_label.trim() ? booking.tax_label.trim() : null

  return {
    amount,
    subtotal_amount: subtotal,
    tax_amount: tax,
    tax_rate: Number.isFinite(taxRate) && tax > 0 ? taxRate : 0,
    tax_label: tax > 0 ? taxLabel : null,
  }
}

async function paymentMethodFromIntent(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  const paymentMethod = paymentIntent.payment_method
  return typeof paymentMethod === 'string' ? paymentMethod : paymentMethod?.id ?? null
}

async function ensureBookingCustomer(booking: any, stripeCustomerId: string | null, paymentMethodId: string | null): Promise<string> {
  if (booking.customer_id) return booking.customer_id

  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      name: booking.customer_name,
      phone: booking.phone ?? null,
      email: booking.email ?? null,
      address: bookingAddress(booking),
      stripe_customer_id: stripeCustomerId,
      stripe_payment_method_id: paymentMethodId,
      has_payment_method: Boolean(paymentMethodId),
    })
    .select('id')
    .single()

  if (error) throw error

  await supabase
    .from('storage_booking_sessions')
    .update({
      customer_id: customer.id,
      stripe_customer_id: stripeCustomerId,
      stripe_payment_method_id: paymentMethodId,
    })
    .eq('id', booking.id)

  if (stripeCustomerId) {
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: paymentMethodId ? { default_payment_method: paymentMethodId } : undefined,
      metadata: {
        customer_id: customer.id,
        source: 'storage_booking',
      },
    })
  }

  return customer.id
}

async function ensurePortableRentalFromBooking(booking: any, customerId: string, paidThroughDate: string | null): Promise<string> {
  if (booking.portable_rental_id) return booking.portable_rental_id

  const { data: existingRental, error: existingError } = await supabase
    .from('portable_storage_rentals')
    .select('id, customer_id')
    .eq('asset_id', booking.asset_id)
    .maybeSingle()

  if (existingError) throw existingError
  if (existingRental) {
    if (existingRental.customer_id !== customerId) throw new Error(`Portable storage asset ${booking.asset_id} is already rented.`)
    await supabase
      .from('storage_booking_sessions')
      .update({ portable_rental_id: existingRental.id })
      .eq('id', booking.id)
    return existingRental.id
  }

  const { data: rental, error } = await supabase
    .from('portable_storage_rentals')
    .insert({
      asset_id: booking.asset_id,
      customer_id: customerId,
      tenant_name: booking.customer_name,
      tenant_phone: booking.phone ?? null,
      monthly_rate: Number(booking.monthly_rate ?? 0),
      billing_day: booking.billing_day,
      payment_frequency: 'monthly',
      move_in_date: booking.start_date,
      paid_through_date: paidThroughDate,
      notes: 'Booked online. Delivery and pickup were collected on the first payment.',
    })
    .select('id')
    .single()

  if (error) throw error

  await supabase
    .from('storage_booking_sessions')
    .update({ portable_rental_id: rental.id })
    .eq('id', booking.id)

  return rental.id
}

async function ensureFixedTenancyFromBooking(booking: any, customerId: string, paidThroughDate: string | null): Promise<string> {
  if (booking.tenancy_id) return booking.tenancy_id

  const { data: existingTenancy, error: existingError } = await supabase
    .from('storage_tenancies')
    .select('id, customer_id')
    .eq('unit_id', booking.unit_id)
    .eq('storage_kind', 'fixed_unit')
    .is('end_date', null)
    .maybeSingle()

  if (existingError) throw existingError
  if (existingTenancy) {
    if (existingTenancy.customer_id !== customerId) throw new Error(`Storage unit ${booking.unit_id} is already rented.`)
    await supabase
      .from('storage_booking_sessions')
      .update({ tenancy_id: existingTenancy.id })
      .eq('id', booking.id)
    return existingTenancy.id
  }

  const { data: tenancy, error } = await supabase
    .from('storage_tenancies')
    .insert({
      unit_id: booking.unit_id,
      customer_id: customerId,
      tenant_name: booking.customer_name,
      tenant_phone: booking.phone ?? null,
      monthly_rate: Number(booking.monthly_rate ?? 0),
      billing_day: booking.billing_day,
      payment_frequency: 'monthly',
      move_in_date: booking.start_date,
      paid_through_date: paidThroughDate,
      notes: 'Booked online.',
    })
    .select('id')
    .single()

  if (error) throw error

  await supabase
    .from('storage_booking_sessions')
    .update({ tenancy_id: tenancy.id })
    .eq('id', booking.id)

  return tenancy.id
}

async function notifyStorageBooking(booking: any, amount: number) {
  const unitLabel = typeof booking.unit_label === 'string' && booking.unit_label.trim()
    ? booking.unit_label.trim()
    : 'storage'
  const customer = typeof booking.customer_name === 'string' && booking.customer_name.trim()
    ? booking.customer_name.trim()
    : 'A customer'

  await notifyAdminEvent({
    title: 'Storage Booking Paid',
    body: `${customer} booked ${unitLabel} online for ${formatCad(amount)}.`,
    url: '/storage',
    type: 'storage_booking',
    severity: 'success',
    metadata: {
      booking_id: booking.id,
      unit_type: booking.unit_type,
      unit_number: booking.unit_number,
      unit_id: booking.unit_id ?? null,
      asset_id: booking.asset_id ?? null,
      amount,
    },
  })
}

async function recordBookingPayment(session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.booking_session_id
  if (!bookingId) return

  const { data: booking, error: bookingError } = await supabase
    .from('storage_booking_sessions')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingError) throw bookingError
  if (!booking || booking.status === 'paid') return

  const expectedCents = centsFromAmount(booking.amount)
  if (typeof session.amount_total === 'number' && session.amount_total !== expectedCents) {
    throw new Error(`Storage booking ${bookingId} amount mismatch.`)
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null
  const stripeCustomerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id ?? null
  const paymentMethodId = await paymentMethodFromIntent(paymentIntentId)
  const customerId = await ensureBookingCustomer(booking, stripeCustomerId, paymentMethodId)
  const period = periodLabelFromDate(booking.start_date)
  const paidThroughDate = paidThroughForPeriod(period, booking.billing_day)
  const paidAt = new Date().toISOString()
  const paymentAmounts = bookingPaymentAmounts(booking)

  if (booking.unit_type === 'portable') {
    const rentalId = await ensurePortableRentalFromBooking(booking, customerId, paidThroughDate)
    const { error: paymentError } = await supabase.from('portable_storage_payments').upsert({
      asset_id: booking.asset_id,
      period_label: period,
      paid_at: paidAt,
      ...paymentAmounts,
    }, { onConflict: 'asset_id,period_label' })

    if (paymentError) throw paymentError

    await supabase
      .from('storage_booking_sessions')
      .update({ portable_rental_id: rentalId })
      .eq('id', booking.id)
  } else {
    const tenancyId = await ensureFixedTenancyFromBooking(booking, customerId, paidThroughDate)
    const { error: paymentError } = await supabase.from('storage_payments').upsert({
      unit_id: booking.unit_id,
      tenancy_id: tenancyId,
      period_label: period,
      paid_at: paidAt,
      ...paymentAmounts,
    }, { onConflict: 'tenancy_id,period_label' })

    if (paymentError) throw paymentError

    await supabase
      .from('storage_booking_sessions')
      .update({ tenancy_id: tenancyId })
      .eq('id', booking.id)
  }

  const { error: updateError } = await supabase
    .from('storage_booking_sessions')
    .update({
      status: 'paid',
      customer_id: customerId,
      paid_at: paidAt,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: stripeCustomerId,
      stripe_payment_method_id: paymentMethodId,
    })
    .eq('id', booking.id)

  if (updateError) throw updateError

  const paidAmount = typeof session.amount_total === 'number'
    ? dollarsFromCents(session.amount_total)
    : Number(booking.amount ?? 0)

  await notifyStorageBooking(booking, paidAmount).catch(err => {
    console.error('Storage booking notification failed.', err)
  })
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
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session

      if (session.mode === 'payment' && session.metadata?.source === 'storage_booking' && session.payment_status === 'paid') {
        await recordBookingPayment(session)
        return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (session.mode === 'payment' && session.metadata?.source === 'storage_payment_portal' && session.payment_status === 'paid') {
        await recordPortalPayment(session)
        return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (event.type !== 'checkout.session.completed' || session.mode !== 'setup') return new Response('ok')

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

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session
      const portalPaymentId = session.metadata?.portal_payment_id
      const bookingSessionId = session.metadata?.booking_session_id
      if (session.metadata?.source === 'storage_booking' && bookingSessionId) {
        await supabase
          .from('storage_booking_sessions')
          .update({ status: 'expired' })
          .eq('id', bookingSessionId)
          .eq('status', 'pending')
      }
      if (session.metadata?.source === 'storage_payment_portal' && portalPaymentId) {
        await supabase
          .from('storage_portal_payment_sessions')
          .update({ status: 'expired' })
          .eq('id', portalPaymentId)
          .eq('status', 'pending')
      }
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
