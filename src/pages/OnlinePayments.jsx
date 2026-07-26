import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Pencil, Plus, ReceiptText, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import PinModal from '@/components/PinModal'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 1000
const SALES_TAX_RATE = 0.13
const SALES_TAX_LABEL = 'HST'
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

function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = String(value).split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  return new Date(year, month - 1, day)
}

function monthLabel(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function localDateStr(date = new Date()) {
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

function isoDatePart(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA')
}

function paidAtFromLocalDate(value) {
  return new Date(`${value}T12:00:00`).toISOString()
}

function fmtDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtPeriod(label) {
  if (!label || !/^\d{4}-\d{2}$/.test(label)) return label || ''
  const [year, month] = label.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
}

function money(value, digits = 2) {
  const amount = Number(value) || 0
  return amount.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function cents(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

function dollars(value) {
  return Number((value / 100).toFixed(2))
}

function paymentBreakdownFromSubtotal(subtotal) {
  const subtotalCents = cents(subtotal)
  const taxCents = Math.round(subtotalCents * SALES_TAX_RATE)
  return {
    subtotal: dollars(subtotalCents),
    tax: dollars(taxCents),
    amount: dollars(subtotalCents + taxCents),
    tax_rate: taxCents > 0 ? SALES_TAX_RATE : 0,
    tax_label: taxCents > 0 ? SALES_TAX_LABEL : null,
  }
}

function numberValue(value) {
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

function isUnknownCustomer(row) {
  return String(row.customerName ?? '').trim().toLowerCase() === 'unknown customer'
}

function isTestBookingRow(row) {
  return String(row.customerName ?? '').trim().toLowerCase() === 'fixed booking'
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadCsvFile(filename, rows) {
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

function showDatePicker(event) {
  try {
    event.target.showPicker()
  } catch {
    // Some browsers do not expose showPicker.
  }
}

async function fetchTaxedPayments(table, columns, dateFrom, dateTo) {
  const rows = []
  const start = dateFilterStart(dateFrom)
  const end = dateFilterEnd(dateTo)

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(columns)
      .gt('tax_amount', 0)
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

async function fetchManualPaymentTargets() {
  const [tenanciesResult, rentalsResult] = await Promise.all([
    supabase
      .from('storage_tenancies')
      .select('id, unit_id, storage_kind, item_type, custom_item_type, item_label, customer_id, tenant_name, tenant_phone, monthly_rate, end_date, storage_units(unit_number), customers(name, phone, email)')
      .is('end_date', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('portable_storage_rentals')
      .select('id, asset_id, customer_id, tenant_name, tenant_phone, monthly_rate, assets(label, size), customers(name, phone, email)')
      .order('created_at', { ascending: false }),
  ])

  const error = tenanciesResult.error || rentalsResult.error
  if (error) throw error

  const fixedTargets = (tenanciesResult.data ?? []).map(tenancy => ({
    key: `fixed:${tenancy.id}`,
    type: 'fixed',
    id: tenancy.id,
    unitId: tenancy.unit_id,
    label: tenancyStorageLabel(tenancy, tenancy.storage_units),
    customerName: tenancy.customers?.name || tenancy.tenant_name || 'Unknown customer',
    phone: tenancy.customers?.phone || tenancy.tenant_phone || '',
    email: tenancy.customers?.email || '',
    defaultSubtotal: numberValue(tenancy.monthly_rate),
  }))

  const portableTargets = (rentalsResult.data ?? []).map(rental => ({
    key: `portable:${rental.asset_id}`,
    type: 'portable',
    id: rental.id,
    assetId: rental.asset_id,
    label: rental.assets ? rental.assets.label + (rental.assets.size ? ` - ${rental.assets.size}` : '') : 'Portable storage',
    customerName: rental.customers?.name || rental.tenant_name || 'Unknown customer',
    phone: rental.customers?.phone || rental.tenant_phone || '',
    email: rental.customers?.email || '',
    defaultSubtotal: numberValue(rental.monthly_rate),
  }))

  return [...fixedTargets, ...portableTargets].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'fixed' ? -1 : 1
    return `${a.label} ${a.customerName}`.localeCompare(`${b.label} ${b.customerName}`)
  })
}

function targetFromPaymentRow(row) {
  return {
    key: row.targetKey,
    type: row.kind,
    id: row.tenancyId,
    unitId: row.unitId,
    assetId: row.assetId,
    label: row.itemLabel,
    customerName: row.customerName,
    phone: row.phone,
    email: row.email,
    defaultSubtotal: row.subtotal,
  }
}

async function verifyAdminPin(pin) {
  if (pin !== '4321') return { error: 'Incorrect PIN' }
  return { ok: true }
}

function makeCsvRows(rows) {
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

function SummaryBox({ label, value, detail, tone = 'default' }) {
  const toneClass = {
    default: 'border-primary/20 bg-primary/10 text-primary',
    green: 'border-green-500/20 bg-green-500/10 text-green-600',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
  }[tone]

  return (
    <div className={cn('rounded-lg border px-3 py-3', toneClass)}>
      <p className="text-base font-semibold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  )
}

export default function OnlinePayments() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTargets, setManualTargets] = useState([])
  const [manualTargetsLoading, setManualTargetsLoading] = useState(false)
  const [manualType, setManualType] = useState('fixed')
  const [manualTargetId, setManualTargetId] = useState('')
  const [manualPeriod, setManualPeriod] = useState(() => monthLabel())
  const [manualPaidDate, setManualPaidDate] = useState(() => localDateStr())
  const [manualSubtotal, setManualSubtotal] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [manualError, setManualError] = useState('')
  const [editingPayment, setEditingPayment] = useState(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [pendingPaymentPayload, setPendingPaymentPayload] = useState(null)
  const [sectionUnlocked, setSectionUnlocked] = useState(() => sessionStorage.getItem('onlinePaymentsUnlocked') === '1')

  const load = useCallback(async () => {
    if (!sectionUnlocked) {
      setRows([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [fixedPayments, portablePayments] = await Promise.all([
        fetchTaxedPayments('storage_payments', FIXED_PAYMENT_COLUMNS, dateFrom, dateTo),
        fetchTaxedPayments('portable_storage_payments', PORTABLE_PAYMENT_COLUMNS, dateFrom, dateTo),
      ])

      const tenancyIds = [...new Set(fixedPayments.map(payment => payment.tenancy_id).filter(Boolean))]
      const unitIds = [...new Set(fixedPayments.map(payment => payment.unit_id).filter(Boolean))]
      const assetIds = [...new Set(portablePayments.map(payment => payment.asset_id).filter(Boolean))]

      const [
        tenanciesResult,
        unitsResult,
        assetsResult,
        rentalsResult,
      ] = await Promise.all([
        tenancyIds.length
          ? supabase
            .from('storage_tenancies')
            .select('id, unit_id, storage_kind, item_type, custom_item_type, item_label, customer_id, tenant_name, tenant_phone, storage_units(unit_number), customers(name, phone, email)')
            .in('id', tenancyIds)
          : Promise.resolve({ data: [], error: null }),
        unitIds.length
          ? supabase.from('storage_units').select('id, unit_number').in('id', unitIds)
          : Promise.resolve({ data: [], error: null }),
        assetIds.length
          ? supabase.from('assets').select('id, label, size').in('id', assetIds)
          : Promise.resolve({ data: [], error: null }),
        assetIds.length
          ? supabase
            .from('portable_storage_rentals')
            .select('asset_id, customer_id, tenant_name, tenant_phone, customers(name, phone, email)')
            .in('asset_id', assetIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      const loadError = [tenanciesResult.error, unitsResult.error, assetsResult.error, rentalsResult.error].find(Boolean)
      if (loadError) throw loadError

      const tenancyById = new Map((tenanciesResult.data ?? []).map(tenancy => [tenancy.id, tenancy]))
      const unitById = new Map((unitsResult.data ?? []).map(unit => [unit.id, unit]))
      const assetById = new Map((assetsResult.data ?? []).map(asset => [asset.id, asset]))
      const rentalByAssetId = new Map((rentalsResult.data ?? []).map(rental => [rental.asset_id, rental]))

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
          customerName: tenancy?.customers?.name || tenancy?.tenant_name || 'Unknown customer',
          phone: tenancy?.customers?.phone || tenancy?.tenant_phone || '',
          email: tenancy?.customers?.email || '',
          periodLabel: payment.period_label || '',
          periodDisplay: fmtPeriod(payment.period_label),
          paidAt: payment.paid_at,
          subtotal,
          tax,
          taxLabel: payment.tax_label || (tax > 0 ? 'HST' : ''),
          taxRate: numberValue(payment.tax_rate),
          total: paymentTotal(payment),
          paymentMethod: payment.payment_method || null,
        }
      })

      const portableRows = portablePayments.map(payment => {
        const asset = assetById.get(payment.asset_id)
        const rental = rentalByAssetId.get(payment.asset_id)
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
          customerName: rental?.customers?.name || rental?.tenant_name || 'Unknown customer',
          phone: rental?.customers?.phone || rental?.tenant_phone || '',
          email: rental?.customers?.email || '',
          periodLabel: payment.period_label || '',
          periodDisplay: fmtPeriod(payment.period_label),
          paidAt: payment.paid_at,
          subtotal,
          tax,
          taxLabel: payment.tax_label || (tax > 0 ? 'HST' : ''),
          taxRate: numberValue(payment.tax_rate),
          total: paymentTotal(payment),
          paymentMethod: payment.payment_method || null,
        }
      })

      setRows([...fixedRows, ...portableRows]
        .filter(row => !isTestBookingRow(row))
        .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)))
    } catch (err) {
      console.error('online payments load failed', err)
      setRows([])
      setError(err?.message || 'Could not load online payments.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, sectionUnlocked])

  useEffect(() => {
    const timeout = window.setTimeout(load, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  useRealtime(['storage_payments', 'portable_storage_payments', 'storage_tenancies', 'portable_storage_rentals', 'storage_units', 'assets', 'customers'], load)

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows

    return rows.filter(row => [
      row.typeLabel,
      row.itemLabel,
      row.customerName,
      row.phone,
      row.email,
      row.periodLabel,
      row.periodDisplay,
      row.taxLabel,
      row.id,
    ].some(value => String(value || '').toLowerCase().includes(needle)))
  }, [query, rows])

  const totals = useMemo(() => filteredRows.reduce((sum, row) => ({
    subtotal: sum.subtotal + row.subtotal,
    tax: sum.tax + row.tax,
    total: sum.total + row.total,
  }), { subtotal: 0, tax: 0, total: 0 }), [filteredRows])

  const hasFilters = !!(dateFrom || dateTo || query.trim())
  const manualTypeTargets = manualTargets.filter(target => target.type === manualType)
  const selectedManualTarget = manualTargets.find(target => target.key === manualTargetId) ?? null
  const manualSubtotalValue = Number(manualSubtotal)
  const manualBreakdown = paymentBreakdownFromSubtotal(Number.isFinite(manualSubtotalValue) && manualSubtotalValue > 0 ? manualSubtotalValue : 0)

  function clearFilters() {
    setQuery('')
    setDateFrom('')
    setDateTo('')
  }

  function downloadCsv() {
    const rangeLabel = dateFrom || dateTo ? `${dateFrom || 'start'}-to-${dateTo || 'today'}` : 'all'
    const exportRows = filteredRows.filter(row => !isUnknownCustomer(row))
    downloadCsvFile(`online-payments-${rangeLabel}.csv`, makeCsvRows(exportRows))
  }

  function applyManualTargetDefaults(target) {
    setManualTargetId(target?.key || '')
    setManualSubtotal(target?.defaultSubtotal ? target.defaultSubtotal.toFixed(2) : '')
  }

  async function loadManualTargets(preferredType = manualType, options = {}) {
    setManualTargetsLoading(true)
    setManualError('')

    try {
      let targets = await fetchManualPaymentTargets()
      if (options.extraTarget && !targets.some(target => target.key === options.extraTarget.key)) {
        targets = [options.extraTarget, ...targets]
      }
      const preferredTargets = targets.filter(target => target.type === preferredType)
      const explicitTarget = options.selectedKey ? targets.find(target => target.key === options.selectedKey) : null
      const fallbackTarget = explicitTarget ?? preferredTargets[0] ?? targets[0] ?? null
      setManualTargets(targets)
      setManualType(fallbackTarget?.type || preferredType)
      if (options.keepValues) {
        setManualTargetId(fallbackTarget?.key || '')
      } else {
        applyManualTargetDefaults(fallbackTarget)
      }
    } catch (err) {
      console.error('manual payment targets failed', err)
      setManualTargets([])
      setManualTargetId('')
      setManualError(err?.message || 'Could not load storage accounts.')
    } finally {
      setManualTargetsLoading(false)
    }
  }

  async function openManualPayment() {
    setEditingPayment(null)
    setManualOpen(true)
    setManualError('')
    setManualPeriod(monthLabel())
    setManualPaidDate(localDateStr())
    setManualSubtotal('')
    await loadManualTargets()
  }

  async function openEditPayment(row) {
    const target = targetFromPaymentRow(row)
    setEditingPayment(row)
    setManualOpen(true)
    setManualError('')
    setManualType(row.kind)
    setManualTargetId(target.key)
    setManualPeriod(row.periodLabel)
    setManualPaidDate(isoDatePart(row.paidAt) || localDateStr())
    setManualSubtotal(row.subtotal.toFixed(2))
    await loadManualTargets(row.kind, {
      extraTarget: target,
      selectedKey: target.key,
      keepValues: true,
    })
  }

  function changeManualType(nextType) {
    setManualType(nextType)
    const nextTarget = manualTargets.find(target => target.type === nextType)
    applyManualTargetDefaults(nextTarget)
  }

  function changeManualTarget(targetId) {
    const target = manualTargets.find(item => item.key === targetId)
    applyManualTargetDefaults(target)
  }

  function validatePaymentForm() {
    if (!selectedManualTarget) {
      setManualError('Choose a storage account.')
      return false
    }
    if (selectedManualTarget.type === 'fixed' && !selectedManualTarget.id) {
      setManualError('Choose a fixed storage account with a tenancy.')
      return false
    }
    if (selectedManualTarget.type === 'portable' && !selectedManualTarget.assetId) {
      setManualError('Choose a portable storage account.')
      return false
    }
    if (!/^\d{4}-\d{2}$/.test(manualPeriod)) {
      setManualError('Choose a billing period.')
      return false
    }
    if (!parseLocalDate(manualPaidDate)) {
      setManualError('Choose a paid date.')
      return false
    }
    if (!Number.isFinite(manualSubtotalValue) || manualSubtotalValue <= 0) {
      setManualError('Enter a subtotal greater than zero.')
      return false
    }
    return true
  }

  function buildPaymentPayload() {
    return {
      period_label: manualPeriod,
      paid_at: paidAtFromLocalDate(manualPaidDate),
      amount: manualBreakdown.amount,
      subtotal_amount: manualBreakdown.subtotal,
      tax_amount: manualBreakdown.tax,
      tax_rate: manualBreakdown.tax_rate,
      tax_label: manualBreakdown.tax_label,
      payment_method: editingPayment ? editingPayment.paymentMethod || 'stripe' : 'stripe',
    }
  }

  async function savePaymentPayload() {
    const pending = pendingPaymentPayload
    if (!pending?.target) return { error: 'No payment is ready to save.' }

    setManualSaving(true)
    setManualError('')

    try {
      const payload = pending.payment
      const target = pending.target
      const editing = pending.editing

      const { error: saveError } = target.type === 'fixed'
        ? await supabase
          .from('storage_payments')
          .upsert(
            {
              ...payload,
              tenancy_id: target.id,
              unit_id: target.unitId,
            },
            { onConflict: 'tenancy_id,period_label' },
          )
        : await supabase
          .from('portable_storage_payments')
          .upsert(
            {
              ...payload,
              asset_id: target.assetId,
            },
            { onConflict: 'asset_id,period_label' },
          )

      if (saveError) throw saveError

      if (editing && (editing.kind !== target.type || editing.targetKey !== target.key || editing.periodLabel !== payload.period_label)) {
        const { error: deleteError } = editing.kind === 'fixed'
          ? await supabase.from('storage_payments').delete().eq('id', editing.id)
          : await supabase.from('portable_storage_payments').delete().eq('id', editing.id)
        if (deleteError) throw deleteError
      }

      setManualOpen(false)
      setPinOpen(false)
      setPendingPaymentPayload(null)
      setEditingPayment(null)
      await load()
    } catch (err) {
      console.error('payment save failed', err)
      setManualError(err?.message || 'Could not save payment.')
      return { error: err?.message || 'Could not save payment.' }
    } finally {
      setManualSaving(false)
    }

    return { ok: true }
  }

  function requestSavePayment() {
    if (!validatePaymentForm()) return
    setPendingPaymentPayload({
      payment: buildPaymentPayload(),
      target: selectedManualTarget,
      editing: editingPayment,
    })
    setPinOpen(true)
  }

  async function confirmSaveWithPin(pin) {
    const pinResult = await verifyAdminPin(pin)
    if (pinResult?.error) return pinResult
    return savePaymentPayload()
  }

  function closePaymentSheet(open) {
    setManualOpen(open)
    if (!open) {
      setEditingPayment(null)
      setManualError('')
      setPendingPaymentPayload(null)
    }
  }

  async function unlockOnlinePayments(pin) {
    if (pin !== '4321') return { error: 'Incorrect PIN' }
    sessionStorage.setItem('onlinePaymentsUnlocked', '1')
    setSectionUnlocked(true)
    return { ok: true }
  }

  if (!sectionUnlocked) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
          <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Online Payments</h1>
            <p className="text-xs text-muted-foreground">Tax collected payments</p>
          </div>
        </div>
        <div className="flex-1" />
        <PinModal
          open
          onClose={() => navigate('/settings')}
          onConfirm={unlockOnlinePayments}
          title="Online Payments"
          subtitle="Enter PIN to access tax payments"
          icon={ReceiptText}
          pinLabel="Enter admin PIN"
          confirmLabel="Enter"
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
        <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Online Payments</h1>
          <p className="text-xs text-muted-foreground">Tax collected payments</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openManualPayment}>
            <Plus size={14} />
            Add
          </Button>
          <Button size="sm" className="gap-1.5" onClick={downloadCsv} disabled={loading || filteredRows.length === 0}>
            <Download size={14} />
            CSV
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <SummaryBox label="Payments" value={loading ? '-' : filteredRows.length.toLocaleString('en-CA')} />
          <SummaryBox label="Tax" value={loading ? '-' : money(totals.tax)} tone="amber" />
          <SummaryBox label="Subtotal" value={loading ? '-' : money(totals.subtotal)} />
          <SummaryBox label="Total" value={loading ? '-' : money(totals.total)} tone="green" />
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search payments"
              className="pl-8 pr-8"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">From</p>
              <Input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                onClick={showDatePicker}
                className="cursor-pointer"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">To</p>
              <Input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                onClick={showDatePicker}
                className="cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-12 space-y-1">
            <ReceiptText size={24} className="mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No online payments found</p>
            <p className="text-xs text-muted-foreground">Adjust the filters to check another range.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRows.map(row => (
              <div key={`${row.kind}:${row.id}`} className="rounded-lg border bg-card px-4 py-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{row.customerName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.itemLabel}{row.periodDisplay ? ` - ${row.periodDisplay}` : ''}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold">{money(row.total)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(row.paidAt)}</p>
                    </div>
                    <button
                      type="button"
                      title="Edit payment"
                      aria-label="Edit payment"
                      onClick={() => openEditPayment(row)}
                      className="h-8 w-8 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-center"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-muted px-2 py-2">
                    <p className="text-muted-foreground">Subtotal</p>
                    <p className="font-medium">{money(row.subtotal)}</p>
                  </div>
                  <div className="rounded-md bg-muted px-2 py-2">
                    <p className="text-muted-foreground">{row.taxLabel || 'Tax'}</p>
                    <p className="font-medium">{money(row.tax)}</p>
                  </div>
                  <div className="rounded-md bg-muted px-2 py-2">
                    <p className="text-muted-foreground">Type</p>
                    <p className="font-medium truncate">{row.typeLabel}</p>
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={manualOpen} onOpenChange={closePaymentSheet}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editingPayment ? 'Edit Online Payment' : 'Add Online Payment'}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['fixed', 'Fixed'],
                ['portable', 'Portable'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeManualType(value)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                    manualType === value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="manual-payment-target">Storage account</label>
              <select
                id="manual-payment-target"
                value={manualTargetId}
                onChange={event => changeManualTarget(event.target.value)}
                disabled={manualTargetsLoading || manualTypeTargets.length === 0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {manualTargetsLoading ? (
                  <option value="">Loading...</option>
                ) : manualTypeTargets.length === 0 ? (
                  <option value="">No active accounts</option>
                ) : (
                  manualTypeTargets.map(target => (
                    <option key={target.key} value={target.key}>
                      {target.label} - {target.customerName}
                    </option>
                  ))
                )}
              </select>
            </div>

            {selectedManualTarget && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{selectedManualTarget.customerName}</p>
                <p>{selectedManualTarget.label}</p>
                {(selectedManualTarget.phone || selectedManualTarget.email) && (
                  <p>{[selectedManualTarget.phone, selectedManualTarget.email].filter(Boolean).join(' - ')}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="manual-payment-period">Period</label>
                <Input
                  id="manual-payment-period"
                  type="month"
                  value={manualPeriod}
                  onChange={event => setManualPeriod(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="manual-payment-paid-date">Paid date</label>
                <Input
                  id="manual-payment-paid-date"
                  type="date"
                  value={manualPaidDate}
                  onChange={event => setManualPaidDate(event.target.value)}
                  onClick={showDatePicker}
                  className="cursor-pointer"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="manual-payment-subtotal">Subtotal before HST</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="manual-payment-subtotal"
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualSubtotal}
                  onChange={event => setManualSubtotal(event.target.value)}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>

            <div className="rounded-lg border divide-y text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{money(manualBreakdown.subtotal)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">HST 13%</span>
                <span className="font-medium">{money(manualBreakdown.tax)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 font-semibold">
                <span>Total</span>
                <span>{money(manualBreakdown.amount)}</span>
              </div>
            </div>

            {manualError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {manualError}
              </div>
            )}

            <Button
              className="w-full gap-2"
              disabled={manualSaving || manualTargetsLoading || !selectedManualTarget}
              onClick={requestSavePayment}
            >
              {editingPayment ? <Pencil size={14} /> : <Plus size={14} />}
              {manualSaving ? 'Saving...' : editingPayment ? 'Save changes' : 'Save payment'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <PinModal
        open={pinOpen}
        onClose={() => !manualSaving && setPinOpen(false)}
        onConfirm={confirmSaveWithPin}
        loading={manualSaving}
        title={editingPayment ? 'Save payment changes' : 'Save online payment'}
        subtitle="Enter admin PIN to confirm"
        icon={editingPayment ? Pencil : ReceiptText}
        confirmLabel={editingPayment ? 'Save' : 'Add'}
        pinLabel="Enter admin PIN"
      >
        {pendingPaymentPayload && (
          <div className="rounded-xl border divide-y text-sm bg-muted/40">
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-medium text-right">{pendingPaymentPayload.target.customerName}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Storage</span>
              <span className="font-medium text-right">{pendingPaymentPayload.target.label}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Period</span>
              <span>{fmtPeriod(pendingPaymentPayload.payment.period_label)}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{money(pendingPaymentPayload.payment.subtotal_amount)}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">HST 13%</span>
              <span>{money(pendingPaymentPayload.payment.tax_amount)}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5 font-semibold">
              <span>Total</span>
              <span>{money(pendingPaymentPayload.payment.amount)}</span>
            </div>
          </div>
        )}
      </PinModal>
    </div>
  )
}
