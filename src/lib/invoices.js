import { supabase } from '@/lib/supabase'
import { fmtPeriod, numberValue } from '@/lib/onlinePaymentsData'

// Our own invoice identity. Stripe can't produce a usable tax invoice for us:
// we compute HST ourselves before charging, so every Stripe charge is a single
// tax-inclusive amount with no HST line. Amounts and tax therefore come from
// storage_payments / portable_storage_payments; only the "Bill to" identity is
// worth pulling from Stripe, because that is where the cardholder's real name
// and billing address live.

export const SELLER = {
  name: 'Timberfell',
  addressLines: [
    '128 County Road 8',
    'Fenelon Falls Ontario K0M 1N0',
    'Canada',
  ],
  phone: '+1 437-241-9818',
  email: '',
}

// CRA requires the GST/HST registration number on an invoice over $30 before
// the customer may claim an input tax credit for the HST we charged. The
// invoice shows an unmissable warning if this is ever blanked out.
export const HST_REGISTRATION_NUMBER = '751085739 RT0001'

export const TERMS_NOTE = 'Paid in full. No payment is due.'

const COUNTRY_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()

export function countryName(code) {
  if (!code) return ''
  const value = String(code).trim()
  if (value.length !== 2) return value
  try {
    return COUNTRY_NAMES?.of(value.toUpperCase()) ?? value
  } catch {
    return value
  }
}

// Stripe hands back a structured address; our own customers table stores one
// free-text blob. Both end up as printable lines.
export function addressLines(address) {
  if (!address) return []
  if (typeof address === 'string') {
    return address.split(/\r?\n|,\s*/).map(line => line.trim()).filter(Boolean)
  }

  const cityLine = [address.city, address.state, address.postal_code]
    .map(part => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')

  return [address.line1, address.line2, cityLine, countryName(address.country)]
    .map(line => String(line ?? '').trim())
    .filter(Boolean)
}

// FNV-1a. Same customer + same selected payments always yields the same invoice
// number, so reprinting an invoice never mints a second number for one sale.
function stableHash(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).toUpperCase().padStart(7, '0').slice(-7)
}

export function invoiceNumberFor(customerKey, paymentIds) {
  const year = new Date().getFullYear()
  const seed = `${customerKey}|${[...paymentIds].sort().join(',')}`
  return `TF-${year}-${stableHash(seed)}`
}

// invoiceLabel is the customer-facing name for what was rented; itemLabel is the
// internal asset tag and must not reach an invoice.
function lineDescription(row) {
  const period = row.periodDisplay || fmtPeriod(row.periodLabel)
  const item = row.invoiceLabel || row.typeLabel || row.itemLabel
  return [item, period ? `${period} storage` : ''].filter(Boolean).join(' - ')
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

// One line per payment, with tax grouped by label + rate so a set of payments
// taxed at different rates still totals correctly.
export function buildInvoice(rows) {
  const lines = rows.map(row => ({
    id: row.id,
    description: lineDescription(row),
    quantity: 1,
    unitPrice: numberValue(row.subtotal),
    amount: numberValue(row.subtotal),
    paidAt: row.paidAt,
  }))

  const taxByRate = new Map()
  for (const row of rows) {
    const tax = numberValue(row.tax)
    if (tax <= 0) continue
    const rate = numberValue(row.taxRate)
    const label = row.taxLabel || 'Tax'
    const key = `${label}|${rate}`
    const existing = taxByRate.get(key)
    if (existing) existing.amount += tax
    else taxByRate.set(key, { label, rate, amount: tax })
  }

  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0))
  const taxLines = [...taxByRate.values()].map(entry => ({ ...entry, amount: round2(entry.amount) }))
  const taxTotal = round2(taxLines.reduce((sum, entry) => sum + entry.amount, 0))

  const paidDates = rows
    .map(row => row.paidAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))

  return {
    lines,
    subtotal,
    taxLines,
    taxTotal,
    total: round2(subtotal + taxTotal),
    lastPaidAt: paidDates[0] ?? null,
  }
}

// Grouped by customer id where we have one, falling back to the name so
// tenancies recorded without a linked customer still produce an invoice.
export function groupRowsByCustomer(rows) {
  const groups = new Map()

  for (const row of rows) {
    const key = row.customerId || `name:${row.customerName}`
    const existing = groups.get(key)
    if (existing) {
      existing.rows.push(row)
      continue
    }
    groups.set(key, {
      key,
      customerId: row.customerId || '',
      name: row.customerName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      rows: [row],
    })
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchStripeBillingDetails(customerId) {
  const { data, error } = await supabase.functions.invoke('stripe-billing-details', {
    body: { customer_id: customerId },
  })
  if (error) {
    // The function returns a readable reason (no Stripe record, deleted, ...)
    // in the body; supabase-js only surfaces a generic message.
    let message = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch { /* keep the generic message */ }
    throw new Error(message || 'Could not reach Stripe')
  }
  return data
}

// Which identity to print. Stripe's card billing details are the strongest
// signal of who actually paid, then the Stripe customer record, then our file.
export function billToFromSources({ stripe, fallback }) {
  const card = stripe?.card
  const customer = stripe?.customer
  const stripeAddress = addressLines(card?.address || customer?.address)

  return {
    name: card?.name || customer?.name || fallback?.name || '',
    email: customer?.email || card?.email || fallback?.email || '',
    phone: customer?.phone || card?.phone || fallback?.phone || '',
    addressLines: stripeAddress.length ? stripeAddress : addressLines(fallback?.address),
  }
}
