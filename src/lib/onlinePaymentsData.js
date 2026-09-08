import { supabase } from '@/lib/supabase'

// Online Payments data + CSV export logic, extracted verbatim from
// src/pages/OnlinePayments.jsx so the accountant portal produces a byte-for-byte
// identical export. Keep this in sync with OnlinePayments.jsx if that page's
// loading/CSV logic changes. Row fields may be added (customerId is used by the
// Invoices page) as long as the CSV/Xero column builders stay untouched. "Online payments" means tax-collected records
// (tax_amount > 0) — collecting tax is the defining line, which naturally
// includes every taxed record and excludes untaxed cash.

const EXPORTED_PAYMENT_METHODS = ['stripe', 'etransfer']

const PAGE_SIZE = 1000
export const SALES_TAX_RATE = 0.13
export const SALES_TAX_LABEL = 'HST'
const FIXED_PAYMENT_COLUMNS = '*'
const PORTABLE_PAYMENT_COLUMNS = '*'

const CUSTOMER_STORAGE_TYPE_LABELS = {
  boat: 'Boat',
  trailer: 'Trailer',
  rv: 'RV',
  custom: 'Custom',
}

function customerStorageTypeLabel(tenancy) {
  if (tenancy?.item_type === 'custom') return tenancy.custom_item_type || 'Custom'
  return CUSTOMER_STORAGE_TYPE_LABELS[tenancy?.item_type] ?? 'Storage'
}

function tenancyStorageLabel(tenancy, unit) {
  if (tenancy?.storage_kind === 'customer_item') {
    const type = customerStorageTypeLabel(tenancy)
    return tenancy.item_label ? `${type} ${tenancy.item_label}` : type
  }
  return unit?.unit_number ? `Unit ${unit.unit_number}` : 'Fixed storage'
}

// The customer-facing name for a pod. `assets.label` is our internal tag ("P9",
// "p#unknown2") and means nothing on an invoice, so bill by what the pod is —
// its asset type and size — and keep the tag for internal views only.
function portableInvoiceLabel(asset) {
  const type = asset?.asset_types?.name?.trim() || 'Portable storage'
  const size = String(asset?.size ?? '').trim()
  return size ? `${type} - ${size}` : type
}

export function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = String(value).split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  return new Date(year, month - 1, day)
}

export function monthLabel(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateFilterStart(value) {
  const date = parseLocalDate(value)
  return date ? date.toISOString() : null
}

function dateFilterEnd(value) {
  const date = parseLocalDate(value)
  if (!date) return null
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}

export function isoDatePart(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA')
}

export function fmtDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtPeriod(label) {
  if (!label || !/^\d{4}-\d{2}$/.test(label)) return label || ''
  const [year, month] = label.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
}

export function money(value, digits = 2) {
  const amount = Number(value) || 0
  return amount.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function cents(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

export function dollars(value) {
  return Number((value / 100).toFixed(2))
}

export function numberValue(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function paymentSubtotal(payment) {
  const subtotal = Number(payment.subtotal_amount)
  if (Number.isFinite(subtotal)) return subtotal
  const total = Number(payment.amount)
  if (Number.isFinite(total)) return Math.max(0, total - numberValue(payment.tax_amount))
  return 0
}

function paymentTotal(payment) {
  const total = Number(payment.amount)
  if (Number.isFinite(total)) return total
  return paymentSubtotal(payment) + numberValue(payment.tax_amount)
}

export function isUnknownCustomer(row) {
  return String(row.customerName ?? '').trim().toLowerCase() === 'unknown customer'
}

export function isTestBookingRow(row) {
  return String(row.customerName ?? '').trim().toLowerCase() === 'fixed booking'
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function downloadCsvFile(filename, rows) {
  const csv = `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function fetchTaxedPayments(table, columns, dateFrom, dateTo) {
  const rows = []
  const start = dateFilterStart(dateFrom)
  const end = dateFilterEnd(dateTo)

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(columns)
      // Which payments reach the books is a property of how the money arrived,
      // not of whether HST happened to be recorded. Stripe and e-transfer are
      // banked; cash is reconciled outside this app.
      .in('payment_method', EXPORTED_PAYMENT_METHODS)
      .order('paid_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (start) query = query.gte('paid_at', start)
    if (end) query = query.lt('paid_at', end)

    const { data, error } = await query
    if (error) throw error

    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

export function makeCsvRows(rows) {
  return [
    [
      'Paid date',
      'Payment type',
      'Item',
      'Customer',
      'Phone',
      'Email',
      'Period',
      'Subtotal CAD',
      'Tax CAD',
      'Tax label',
      'Tax rate',
      'Total CAD',
      'Payment ID',
    ],
    ...rows.map(row => [
      isoDatePart(row.paidAt),
      row.typeLabel,
      row.itemLabel,
      row.customerName,
      row.phone,
      row.email,
      row.periodLabel,
      row.subtotal.toFixed(2),
      row.tax.toFixed(2),
      row.taxLabel,
      row.taxRate ? `${(row.taxRate * 100).toFixed(2)}%` : '',
      row.total.toFixed(2),
      row.id,
    ]),
  ]
}

// Xero sales-invoice import format. Column order matches Xero's template
// exactly. Required Xero columns are marked with a leading asterisk in the
// header. accountCode and taxType are specific to the accountant's Xero chart of
// accounts, so they are passed in (entered once in the portal) rather than
// guessed here.
export const XERO_INVOICE_HEADER = [
  '*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3',
  'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber',
  'Reference', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', '*Description',
  '*Quantity', '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TaxAmount',
  'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency',
  'BrandingTheme',
]

// A stable, unique invoice number per payment so re-exporting the same payment
// (e.g. a weekly run) does not create duplicate invoices in Xero.
export function xeroInvoiceNumber(row) {
  const prefix = row.kind === 'portable' ? 'P' : 'F'
  const shortId = String(row.id || '').replace(/-/g, '').slice(0, 10).toUpperCase()
  return `TF-${prefix}-${shortId}`
}

function xeroDescription(row) {
  const period = row.periodDisplay || fmtPeriod(row.periodLabel)
  const parts = [row.itemLabel, period ? `${period} storage` : 'storage'].filter(Boolean)
  return parts.join(' - ')
}

// Pull a Canadian postal code (A1A 1A1) out of a free-text address line, if one
// is present. Addresses we store almost always include it already.
export function extractPostalCode(text) {
  if (!text) return ''
  const match = String(text).match(/([A-Za-z]\d[A-Za-z])[ -]?(\d[A-Za-z]\d)/)
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : ''
}

export function makeXeroInvoiceRows(rows, { accountCode = '', taxType = '' } = {}) {
  return [
    XERO_INVOICE_HEADER,
    ...rows.map(row => {
      const invoiceDate = isoDatePart(row.paidAt)
      return [
        row.customerName,          // *ContactName
        row.email || '',           // EmailAddress
        row.address || '',         // POAddressLine1 (single unstructured line)
        '',                        // POAddressLine2
        '',                        // POAddressLine3
        '',                        // POAddressLine4
        '',                        // POCity
        '',                        // PORegion
        extractPostalCode(row.address), // POPostalCode (parsed from the address)
        'Canada',                  // POCountry
        xeroInvoiceNumber(row),    // *InvoiceNumber
        row.paymentReference || row.itemLabel, // Reference (bank-matchable when we have one)
        invoiceDate,               // *InvoiceDate
        invoiceDate,               // *DueDate (already paid)
        row.total.toFixed(2),      // Total
        '',                        // InventoryItemCode
        xeroDescription(row),      // *Description
        '1',                       // *Quantity
        row.subtotal.toFixed(2),   // *UnitAmount (ex-HST)
        '',                        // Discount
        accountCode,               // *AccountCode
        taxType,                   // *TaxType
        row.tax.toFixed(2),        // TaxAmount
        '',                        // TrackingName1
        '',                        // TrackingOption1
        '',                        // TrackingName2
        '',                        // TrackingOption2
        'CAD',                     // Currency
        '',                        // BrandingTheme
      ]
    }),
  ]
}

// Loads the enriched, sorted set of tax-collected online payment rows for the
// given paid-date range. Shared by the Online Payments page and the accountant
// portal.
export async function loadOnlinePaymentRows({ dateFrom = '', dateTo = '' } = {}) {
  const [fixedPaymentsRaw, portablePaymentsRaw, hiddenResult] = await Promise.all([
    fetchTaxedPayments('storage_payments', FIXED_PAYMENT_COLUMNS, dateFrom, dateTo),
    fetchTaxedPayments('portable_storage_payments', PORTABLE_PAYMENT_COLUMNS, dateFrom, dateTo),
    supabase.from('admin_payment_hidden').select('payment_type, payment_id'),
  ])
  if (hiddenResult.error) throw hiddenResult.error

  // A payment hidden on the revenue page is not real revenue — a test charge, a
  // duplicate, a correction. It must not reach the accountant export either.
  const hidden = new Set((hiddenResult.data ?? []).map(row => `${row.payment_type}:${row.payment_id}`))
  const fixedPayments = fixedPaymentsRaw.filter(payment => !hidden.has(`fixed:${payment.id}`))
  const portablePayments = portablePaymentsRaw.filter(payment => !hidden.has(`portable:${payment.id}`))

  const tenancyIds = [...new Set(fixedPayments.map(payment => payment.tenancy_id).filter(Boolean))]
  const unitIds = [...new Set(fixedPayments.map(payment => payment.unit_id).filter(Boolean))]
  const assetIds = [...new Set(portablePayments.map(payment => payment.asset_id).filter(Boolean))]
  // Attribute by rental, not by pod: a pod outlives its renters.
  const rentalIds = [...new Set(portablePayments.map(payment => payment.rental_id).filter(Boolean))]

  const [
    tenanciesResult,
    unitsResult,
    assetsResult,
    rentalsResult,
  ] = await Promise.all([
    tenancyIds.length
      ? supabase
        .from('storage_tenancies')
        .select('id, unit_id, storage_kind, item_type, custom_item_type, item_label, customer_id, tenant_name, tenant_phone, storage_units(unit_number), customers(name, phone, email, address)')
        .in('id', tenancyIds)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length
      ? supabase.from('storage_units').select('id, unit_number').in('id', unitIds)
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase.from('assets').select('id, label, size, asset_types(name)').in('id', assetIds)
      : Promise.resolve({ data: [], error: null }),
    rentalIds.length
      ? supabase
        .from('portable_storage_rentals')
        .select('id, asset_id, customer_id, tenant_name, tenant_phone, customers(name, phone, email, address)')
        .in('id', rentalIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const loadError = [tenanciesResult.error, unitsResult.error, assetsResult.error, rentalsResult.error].find(Boolean)
  if (loadError) throw loadError

  const tenancyById = new Map((tenanciesResult.data ?? []).map(tenancy => [tenancy.id, tenancy]))
  const unitById = new Map((unitsResult.data ?? []).map(unit => [unit.id, unit]))
  const assetById = new Map((assetsResult.data ?? []).map(asset => [asset.id, asset]))
  const rentalById = new Map((rentalsResult.data ?? []).map(rental => [rental.id, rental]))

  const fixedRows = fixedPayments.map(payment => {
    const tenancy = tenancyById.get(payment.tenancy_id)
    const unit = tenancy?.storage_units ?? unitById.get(tenancy?.unit_id ?? payment.unit_id)
    const subtotal = paymentSubtotal(payment)
    const tax = numberValue(payment.tax_amount)

    return {
      id: payment.id,
      kind: 'fixed',
      targetKey: `fixed:${tenancy?.id || payment.tenancy_id || ''}`,
      tenancyId: tenancy?.id || payment.tenancy_id || '',
      unitId: tenancy?.unit_id || payment.unit_id || '',
      assetId: '',
      typeLabel: tenancy?.storage_kind === 'customer_item' ? 'Customer storage' : 'Fixed storage',
      itemLabel: tenancyStorageLabel(tenancy, unit),
      invoiceLabel: tenancyStorageLabel(tenancy, unit),
      customerId: tenancy?.customer_id || '',
      customerName: tenancy?.customers?.name || tenancy?.tenant_name || 'Unknown customer',
      phone: tenancy?.customers?.phone || tenancy?.tenant_phone || '',
      email: tenancy?.customers?.email || '',
      address: tenancy?.customers?.address || '',
      periodLabel: payment.period_label || '',
      periodDisplay: fmtPeriod(payment.period_label),
      paidAt: payment.paid_at,
      subtotal,
      tax,
      taxLabel: payment.tax_label || (tax > 0 ? 'HST' : ''),
      taxRate: numberValue(payment.tax_rate),
      total: paymentTotal(payment),
      paymentMethod: payment.payment_method || null,
      paymentReference: payment.payment_reference || '',
    }
  })

  const portableRows = portablePayments.map(payment => {
    const asset = assetById.get(payment.asset_id)
    // No rental_id means the payer was never recorded. Leave it unattributed
    // rather than crediting the pod's current renter.
    const rental = payment.rental_id ? rentalById.get(payment.rental_id) : null
    const subtotal = paymentSubtotal(payment)
    const tax = numberValue(payment.tax_amount)

    return {
      id: payment.id,
      kind: 'portable',
      targetKey: `portable:${payment.asset_id || ''}`,
      tenancyId: '',
      unitId: '',
      assetId: payment.asset_id || '',
      typeLabel: 'Portable storage',
      itemLabel: asset ? asset.label + (asset.size ? ` - ${asset.size}` : '') : 'Portable storage',
      invoiceLabel: portableInvoiceLabel(asset),
      customerId: rental?.customer_id || '',
      customerName: rental?.customers?.name || rental?.tenant_name || 'Unknown customer',
      phone: rental?.customers?.phone || rental?.tenant_phone || '',
      email: rental?.customers?.email || '',
      address: rental?.customers?.address || '',
      periodLabel: payment.period_label || '',
      periodDisplay: fmtPeriod(payment.period_label),
      paidAt: payment.paid_at,
      subtotal,
      tax,
      taxLabel: payment.tax_label || (tax > 0 ? 'HST' : ''),
      taxRate: numberValue(payment.tax_rate),
      total: paymentTotal(payment),
      paymentMethod: payment.payment_method || null,
      paymentReference: payment.payment_reference || '',
    }
  })

  return [...fixedRows, ...portableRows]
    .filter(row => !isTestBookingRow(row))
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
}
