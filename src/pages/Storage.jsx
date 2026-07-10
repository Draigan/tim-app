import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Phone, ChevronRight, CheckCircle2, Send, Pencil, ArrowUpDown, Plus, Eye, EyeOff, CreditCard } from 'lucide-react'
import PinModal from '@/components/PinModal'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import StorageViewMenu from '@/components/StorageViewMenu'
import { supabase } from '@/lib/supabase'
import CustomerPicker from '@/components/CustomerPicker'
import { cn, formatPhone, formatPhoneInput, newClientId, retryTransient, throwSupabaseError } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'
import { newBillingRequestId, promptBillingPin } from '@/lib/billingApproval'
import { CUSTOMER_ASSIGN_COLUMNS } from '@/lib/customerFields'

const todayDay = () => new Date().getDate()
const localDateStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const DAY_MS = 86400000
const cents = value => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const dollars = value => Number((value / 100).toFixed(2))
const SALES_TAX_RATE = 0.13
const SALES_TAX_LABEL = 'HST'

function taxCentsForSubtotal(subtotalCents) {
  return Math.round(subtotalCents * SALES_TAX_RATE)
}

function paymentAmountsFromSubtotal(subtotal, collectTax = false) {
  const subtotalCents = cents(subtotal)
  const taxCents = collectTax ? taxCentsForSubtotal(subtotalCents) : 0
  return {
    amount: dollars(subtotalCents + taxCents),
    subtotal_amount: dollars(subtotalCents),
    tax_amount: dollars(taxCents),
    tax_rate: collectTax && taxCents > 0 ? SALES_TAX_RATE : 0,
    tax_label: collectTax && taxCents > 0 ? SALES_TAX_LABEL : null,
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function lastDayOf(year, month0) {
  return new Date(year, month0 + 1, 0).getDate()
}

function currentPeriodLabel(billingDay) {
  const today = new Date()
  const effective = billingDay ? Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth())) : 0
  if (!billingDay || today.getDate() >= effective) {
    return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
  }
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`
}

function isPeriodLabel(label) {
  return typeof label === 'string' && /^\d{4}-\d{2}$/.test(label)
}

function parseLocalDate(value) {
  if (!value) return null
  const [y, m, d] = String(value).split('-').map(Number)
  if (![y, m, d].every(Number.isFinite)) return null
  return new Date(y, m - 1, d)
}

function formatLocalDate(value, options) {
  const date = parseLocalDate(value)
  return date ? date.toLocaleDateString('en-CA', options) : value
}

function dateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function daysInclusive(start, end) {
  return Math.floor((end - start) / DAY_MS) + 1
}

function periodDueDate(label, billingDay) {
  if (!billingDay || !isPeriodLabel(label)) return null
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, Math.min(billingDay, lastDayOf(y, m - 1)))
}

function nextPeriodLabel(label) {
  if (!isPeriodLabel(label)) return null
  const [y, m] = label.split('-').map(Number)
  const date = new Date(y, m, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function paidThroughForPeriod(label, billingDay) {
  const nextLabel = nextPeriodLabel(label)
  const nextStart = nextLabel ? periodDueDate(nextLabel, billingDay) : null
  return nextStart ? addDays(nextStart, -1) : null
}

function paidThroughFromPayments(payments, billingDay, existingPaidThroughDate = null) {
  let paidThrough = parseLocalDate(existingPaidThroughDate)
  payments.forEach(payment => {
    const periodPaidThrough = paidThroughForPeriod(payment.period_label, billingDay)
    if (periodPaidThrough && (!paidThrough || periodPaidThrough > paidThrough)) {
      paidThrough = periodPaidThrough
    }
  })
  return paidThrough ? dateStr(paidThrough) : null
}

function isPaidThroughToday(paidThroughDate) {
  const paidThrough = parseLocalDate(paidThroughDate)
  if (!paidThrough) return false
  return paidThrough >= parseLocalDate(localDateStr())
}

function periodCovered(period, billingDay, paidSet, paidThroughDate) {
  if (paidSet.has(period)) return true
  const paidThrough = parseLocalDate(paidThroughDate)
  if (!paidThrough) return false
  const periodPaidThrough = paidThroughForPeriod(period, billingDay)
  if (periodPaidThrough && paidThrough >= periodPaidThrough) return true
  return period === currentPeriodLabel(billingDay) && isPaidThroughToday(paidThroughDate)
}

function periodChargeCents(label, billingDay, moveInDate, monthlyRate) {
  const monthlyRateCents = cents(monthlyRate)
  if (monthlyRateCents <= 0) return 0

  const start = periodDueDate(label, billingDay)
  const end = paidThroughForPeriod(label, billingDay)
  if (!start || !end) return monthlyRateCents

  const moveIn = parseLocalDate(moveInDate)
  if (moveIn && moveIn > end) return 0

  const chargeStart = moveIn && moveIn > start ? moveIn : start
  const totalDays = daysInclusive(start, end)
  const billableDays = daysInclusive(chargeStart, end)
  if (totalDays <= 0 || billableDays <= 0) return 0
  if (billableDays >= totalDays) return monthlyRateCents
  return Math.round(monthlyRateCents * billableDays / totalDays)
}

function periodChargeAmount(label, billingDay, moveInDate, monthlyRate) {
  return dollars(periodChargeCents(label, billingDay, moveInDate, monthlyRate))
}

function periodLabelForDate(date, billingDay) {
  if (!billingDay) return null
  const effective = Math.min(billingDay, lastDayOf(date.getFullYear(), date.getMonth()))
  if (date.getDate() >= effective) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
  }
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`
}

function billingCycleForDate(date, billingDay) {
  const label = periodLabelForDate(date, billingDay)
  const start = periodDueDate(label, billingDay)
  const end = paidThroughForPeriod(label, billingDay)
  if (!label || !start || !end) return null
  return { label, start, end, days: daysInclusive(start, end) }
}

function creditCentsForPaidThrough({ startDate, paidThroughDate, monthlyRate, billingDay }) {
  const monthlyRateCents = cents(monthlyRate)
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(paidThroughDate)
  if (!start || !end || end < start || monthlyRateCents <= 0 || !billingDay) return 0

  let total = 0
  let cursor = start
  for (let guard = 0; cursor <= end && guard < 240; guard++) {
    const cycle = billingCycleForDate(cursor, billingDay)
    if (!cycle) break
    const segmentEnd = cycle.end < end ? cycle.end : end
    const coveredDays = daysInclusive(cursor, segmentEnd)
    total += Math.round(monthlyRateCents * coveredDays / cycle.days)
    cursor = addDays(segmentEnd, 1)
  }
  return total
}

function creditCoverageFromCents({ startDate, creditCents, monthlyRate, billingDay }) {
  const monthlyRateCents = cents(monthlyRate)
  let remainingCents = Math.max(0, creditCents)
  let cursor = parseLocalDate(startDate)
  let paidThrough = null
  const fullPeriods = []

  if (!cursor || !billingDay || monthlyRateCents <= 0 || remainingCents <= 0) {
    return { paidThroughDate: null, fullPeriods, appliedCents: 0, remainingCents }
  }

  for (let guard = 0; remainingCents > 0 && guard < 240; guard++) {
    const cycle = billingCycleForDate(cursor, billingDay)
    if (!cycle) break
    const daysLeft = daysInclusive(cursor, cycle.end)
    const remainderCost = Math.round(monthlyRateCents * daysLeft / cycle.days)

    if (remainingCents >= remainderCost) {
      paidThrough = cycle.end
      remainingCents -= remainderCost
      if (dateStr(cursor) === dateStr(cycle.start)) fullPeriods.push(cycle.label)
      cursor = addDays(cycle.end, 1)
      continue
    }

    const coveredDays = Math.floor(remainingCents * cycle.days / monthlyRateCents)
    if (coveredDays <= 0) break
    paidThrough = addDays(cursor, coveredDays - 1)
    remainingCents -= Math.round(monthlyRateCents * coveredDays / cycle.days)
    break
  }

  return {
    paidThroughDate: paidThrough ? dateStr(paidThrough) : null,
    fullPeriods,
    appliedCents: creditCents - remainingCents,
    remainingCents,
  }
}

function sortPaymentsByPeriod(payments) {
  return [...payments].sort((a, b) => {
    const aKey = isPeriodLabel(a.period_label) ? a.period_label : '0000-00'
    const bKey = isPeriodLabel(b.period_label) ? b.period_label : '0000-00'
    const periodOrder = bKey.localeCompare(aKey)
    if (periodOrder !== 0) return periodOrder
    return new Date(b.paid_at ?? 0) - new Date(a.paid_at ?? 0)
  })
}

function paymentStatus(billingDay, frequency, isPaid, moveInDate, paidThroughDate) {
  if (!billingDay || !frequency || frequency === 'one_time' || frequency === 'other') {
    return isPaid || isPaidThroughToday(paidThroughDate) ? 'paid' : 'unpaid'
  }
  if (isPaid || isPaidThroughToday(paidThroughDate)) return 'paid'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const paidThrough = parseLocalDate(paidThroughDate)
  if (paidThrough && paidThrough < today) return 'overdue'
  const currentPeriod = currentPeriodLabel(billingDay)
  let dueDate = periodDueDate(currentPeriod, billingDay)
  if (!dueDate) return 'unpaid'
  const moveIn = parseLocalDate(moveInDate)
  const periodEnd = paidThroughForPeriod(currentPeriod, billingDay)
  if (moveIn && periodEnd && periodEnd < moveIn) return 'upcoming'
  if (moveIn && dueDate < moveIn && (!periodEnd || moveIn <= periodEnd)) dueDate = moveIn
  const daysUntilDue = Math.round((dueDate - today) / DAY_MS)
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue <= 3) return 'due_soon'
  return 'upcoming'
}

function dueDateForCurrentPeriod(billingDay, moveInDate) {
  if (!billingDay) return null
  const currentPeriod = currentPeriodLabel(billingDay)
  const dueDate = periodDueDate(currentPeriod, billingDay)
  if (!dueDate) return null
  const moveIn = parseLocalDate(moveInDate)
  const periodEnd = paidThroughForPeriod(currentPeriod, billingDay)
  if (moveIn && periodEnd && periodEnd < moveIn) return null
  if (moveIn && dueDate < moveIn && (!periodEnd || moveIn <= periodEnd)) return moveIn
  return dueDate
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function paymentRowsForPeriods({ tenancyId, periods, amount }) {
  return periods.map(period => {
    const row = { tenancy_id: tenancyId, period_label: period }
    if (amount !== undefined && amount !== null) Object.assign(row, paymentAmountsFromSubtotal(amount))
    return row
  })
}

async function updateTenancyPaidThrough(tenancyId, paidThroughDate) {
  await supabase.from('storage_tenancies')
    .update({ paid_through_date: paidThroughDate })
    .eq('id', tenancyId)
}

async function extendTenancyPaidThrough({ tenancyId, billingDay, periods, currentPaidThroughDate }) {
  const paidThroughDate = paidThroughFromPayments(
    periods.map(period_label => ({ period_label })),
    billingDay,
    currentPaidThroughDate
  )
  if (paidThroughDate) await updateTenancyPaidThrough(tenancyId, paidThroughDate)
  return paidThroughDate
}

const STATUS_ORDER = { overdue: 0, due_soon: 1, upcoming: 2, unpaid: 2, paid: 3 }

function nextPaymentDate(billingDay) {
  if (!billingDay) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thisDay = Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth()))
  const candidate = new Date(today.getFullYear(), today.getMonth(), thisDay)
  if (candidate < today) {
    const nm0 = (today.getMonth() + 1) % 12
    const ny = today.getFullYear() + (today.getMonth() === 11 ? 1 : 0)
    return new Date(ny, nm0, Math.min(billingDay, lastDayOf(ny, nm0)))
  }
  return candidate
}

function tenureSummary(moveInDate) {
  if (!moveInDate) return null
  const start = parseLocalDate(moveInDate)
  if (!start) return null
  const today = new Date()
  const months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth())
  if (months < 1) {
    const days = Math.floor((today - start) / 86400000)
    return `${days} day${days !== 1 ? 's' : ''}`
  }
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years} year${years !== 1 ? 's' : ''}`
}

function formatPeriod(label) {
  if (!isPeriodLabel(label)) return label || 'Unknown period'
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
}

function generatePeriods(billingDay, moveInDate) {
  if (!billingDay) return []
  const current = currentPeriodLabel(billingDay)
  const moveIn = parseLocalDate(moveInDate)
  const first = moveIn ? periodLabelForDate(moveIn, billingDay) : current
  if (!first) return [current]

  let [y, m] = current.split('-').map(Number)
  m -= 1
  const periods = []
  while (periods.length < 24) {
    const label = `${y}-${String(m + 1).padStart(2, '0')}`
    if (label < first) break
    periods.push(label)
    if (--m < 0) { m = 11; y-- }
  }
  return periods
}

// ─── shared small pieces ──────────────────────────────────────────────────────

function StatusBadge({ status, billingDay, moveInDate }) {
  const dueDate = dueDateForCurrentPeriod(billingDay, moveInDate)
  const effectiveDay = dueDate?.getDate() ?? (billingDay ? Math.min(billingDay, lastDayOf(new Date().getFullYear(), new Date().getMonth())) : billingDay)
  if (status === 'paid')     return <span className="text-xs font-medium text-green-500">Paid</span>
  if (status === 'overdue')  return <span className="text-xs font-medium text-destructive">Overdue</span>
  if (status === 'due_soon') return <span className="text-xs font-medium text-amber-500">{effectiveDay === todayDay() ? 'Due today' : `Due ${ordinal(effectiveDay)}`}</span>
  if (status === 'upcoming') return <span className="text-xs text-muted-foreground">Due {ordinal(effectiveDay)}</span>
  return <span className="text-xs text-muted-foreground">Unpaid</span>
}

function cardBorder(status) {
  if (status === 'overdue')  return 'border-red-500/60'
  if (status === 'due_soon') return 'border-amber-500/50'
  return ''
}

const tenantName = (item) => item?.customers?.name || item?.tenant_name || null

const FREQ_LABELS = { monthly: 'Monthly', one_time: 'One-time' }
const CUSTOMER_STORAGE_TYPES = [
  { value: 'boat', label: 'Boat' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'rv', label: 'RV' },
  { value: 'custom', label: 'Custom' },
]
const MONTH_OPTIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const EMPTY_ASSIGN = { monthly_rate: '150', billing_day: '1', payment_frequency: 'monthly', move_in_date: localDateStr(), notes: '' }
const EMPTY_CUSTOMER_STORAGE = {
  item_type: 'boat',
  custom_item_type: '',
  item_label: '',
  monthly_rate: '150',
  billing_day: '1',
  payment_frequency: 'monthly',
  move_in_date: localDateStr(),
  notes: '',
}

function customerStorageTypeLabel(item) {
  if (item?.item_type === 'custom') return item.custom_item_type || 'Custom'
  return CUSTOMER_STORAGE_TYPES.find(type => type.value === item?.item_type)?.label ?? 'Storage'
}

function customerStorageLabel(item) {
  const type = customerStorageTypeLabel(item)
  return item?.item_label ? `${type} · ${item.item_label}` : type
}

function storageItemLabel(item) {
  return item?.storage_kind === 'customer_item' ? customerStorageLabel(item) : `Unit ${item?.unit_number ?? ''}`
}

function datePartsFromValue(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > lastDayOf(year, month - 1)) return null
  return { year, month, day }
}

function formatDateParts({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function yearOptionsFor(value) {
  const currentYear = new Date().getFullYear()
  const selectedYear = datePartsFromValue(value)?.year
  const start = Math.min(currentYear - 15, selectedYear ?? currentYear)
  const end = Math.max(currentYear + 5, selectedYear ?? currentYear)
  return Array.from({ length: end - start + 1 }, (_, i) => end - i)
}

function StorageDateSelect({ value, onChange }) {
  const selected = datePartsFromValue(value)
  const today = datePartsFromValue(localDateStr())
  const base = selected ?? today
  const maxDay = lastDayOf(base.year, base.month - 1)
  const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'

  function updatePart(part, rawValue) {
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue)) return
    const next = { ...base, [part]: numericValue }
    next.day = Math.min(next.day, lastDayOf(next.year, next.month - 1))
    onChange(formatDateParts(next))
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,0.95fr)] gap-2">
        <select
          aria-label="Move-in month"
          value={selected ? String(selected.month) : ''}
          onChange={e => updatePart('month', e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>Month</option>
          {MONTH_OPTIONS.map((label, index) => (
            <option key={label} value={index + 1}>{label}</option>
          ))}
        </select>
        <select
          aria-label="Move-in day"
          value={selected ? String(selected.day) : ''}
          onChange={e => updatePart('day', e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>Day</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map(day => (
            <option key={day} value={day}>{day}</option>
          ))}
        </select>
        <select
          aria-label="Move-in year"
          value={selected ? String(selected.year) : ''}
          onChange={e => updatePart('year', e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>Year</option>
          {yearOptionsFor(value).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-3 px-0.5 text-xs">
        <button type="button" onClick={() => onChange(localDateStr())} className="text-primary hover:text-primary/80">
          Today
        </button>
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ─── fixed unit card ──────────────────────────────────────────────────────────

function FixedUnitCard({ unit, isPaid, onTap }) {
  const vacant = !tenantName(unit)
  const status = vacant ? null : paymentStatus(unit.billing_day, unit.payment_frequency, isPaid, unit.move_in_date, unit.paid_through_date)

  return (
    <button
      className={cn('w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors', status && cardBorder(status))}
      onClick={() => onTap(unit)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{unit.unit_number}</span>
          {vacant
            ? <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Vacant</span>
            : <span className="text-sm text-muted-foreground truncate">{tenantName(unit)}</span>
          }
        </div>
        {!vacant && (
          <div className="flex items-center gap-3 mt-0.5">
            {unit.monthly_rate && <span className="text-xs text-muted-foreground">${unit.monthly_rate}/mo</span>}
            {unit.tenant_phone && <span className="text-xs text-muted-foreground">{formatPhone(unit.tenant_phone)}</span>}
            {unit.customers?.has_payment_method ? (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CreditCard size={12} /> Card on file
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CreditCard size={12} /> No card
              </span>
            )}
          </div>
        )}
        {unit.unit_notes && <p className="text-xs text-muted-foreground mt-1 truncate">{unit.unit_notes}</p>}
      </div>
      {status && <StatusBadge status={status} billingDay={unit.billing_day} moveInDate={unit.move_in_date} />}
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

function CustomerStorageCard({ item, isPaid, onTap }) {
  const status = paymentStatus(item.billing_day, item.payment_frequency, isPaid, item.move_in_date, item.paid_through_date)

  return (
    <button
      className={cn('w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors', status && cardBorder(status))}
      onClick={() => onTap(item)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{customerStorageLabel(item)}</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full flex-shrink-0">
            {customerStorageTypeLabel(item)}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {tenantName(item) && <span className="text-sm text-muted-foreground truncate">{tenantName(item)}</span>}
          {item.monthly_rate && <span className="text-xs text-muted-foreground">${item.monthly_rate}/mo</span>}
          {item.tenant_phone && <span className="text-xs text-muted-foreground">{formatPhone(item.tenant_phone)}</span>}
        </div>
        {item.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{item.notes}</p>}
      </div>
      {status && <StatusBadge status={status} billingDay={item.billing_day} moveInDate={item.move_in_date} />}
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

function AddCustomerStorageSheet({ open, onOpenChange, onSaved }) {
  const [customer, setCustomer] = useState(null)
  const [form, setForm] = useState(EMPTY_CUSTOMER_STORAGE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setCustomer(null)
    setForm(EMPTY_CUSTOMER_STORAGE)
    setSaving(false)
    setError('')
  }, [open])

  function set(field, value) {
    setForm(current => ({ ...current, [field]: value }))
  }

  async function handleSave() {
    if (!customer || !form.item_label.trim() || !form.billing_day) return
    if (form.item_type === 'custom' && !form.custom_item_type.trim()) return
    setSaving(true)
    setError('')
    const { error: insertError } = await supabase.from('storage_tenancies').insert({
      unit_id: null,
      storage_kind: 'customer_item',
      item_type: form.item_type,
      custom_item_type: form.item_type === 'custom' ? form.custom_item_type.trim() : null,
      item_label: form.item_label.trim(),
      customer_id: customer.id,
      tenant_name: customer.name || null,
      tenant_phone: customer.phone || null,
      monthly_rate: form.monthly_rate ? Number(form.monthly_rate) : null,
      billing_day: form.billing_day ? Number(form.billing_day) : null,
      payment_frequency: form.payment_frequency || null,
      move_in_date: form.move_in_date || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  const canSave = customer
    && form.item_label.trim()
    && form.billing_day
    && (form.item_type !== 'custom' || form.custom_item_type.trim())

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle>Add Customer Storage</SheetTitle>
        </SheetHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Customer</p>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item</p>
            <div className="grid grid-cols-4 gap-1.5">
              {CUSTOMER_STORAGE_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => set('item_type', type.value)}
                  className={`text-xs py-2 rounded-lg border transition-colors ${form.item_type === type.value ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {type.label}
                </button>
              ))}
            </div>
            {form.item_type === 'custom' && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Custom Type</p>
                <Input value={form.custom_item_type} onChange={e => set('custom_item_type', e.target.value)} placeholder="Skid steer, equipment, etc." />
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Description</p>
              <Input value={form.item_label} onChange={e => set('item_label', e.target.value)} placeholder="Blue Bayliner, white enclosed trailer, RV plate…" />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billing</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Monthly Rate ($)</p>
                <Input value={form.monthly_rate} onChange={e => set('monthly_rate', e.target.value)} placeholder="150" type="number" min="0" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Billing Day</p>
                <Input value={form.billing_day} onChange={e => set('billing_day', e.target.value)} placeholder="1" type="number" min="1" max="31" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
              <StorageDateSelect value={form.move_in_date} onChange={value => set('move_in_date', value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
              <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Parking spot, keys, access info…" />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1" disabled={!canSave || saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Start Storage'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── storage sheet ────────────────────────────────────────────────────────────

export function StorageSheet({ item, isPaid, onClose, onTogglePaid, onAssigned }) {
  const navigate = useNavigate()
  const [history, setHistory]         = useState([])
  const [smsLog, setSmsLog]           = useState([])
  const [assign, setAssign]           = useState(EMPTY_ASSIGN)
  const [customer, setCustomer]       = useState(null)
  const [allCustomers, setAllCustomers] = useState([])
  const [search, setSearch]           = useState('')
  const [isNewCustomer, setIsNewCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' })
  const [newCustomerId, setNewCustomerId] = useState(() => newClientId())
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSent, setInviteSent]   = useState(false)
  const [confirmSendInvite, setConfirmSendInvite] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [confirmVacate, setConfirmVacate] = useState(false)
  const [vacateInput, setVacateInput] = useState('')
  const [vacateStep, setVacateStep]   = useState('confirm') // 'confirm' | 'transfer'
  const [vacantUnits, setVacantUnits] = useState([])
  const [transferUnitId, setTransferUnitId] = useState(null)
  const [remindState, setRemindState] = useState('idle')
  const [editing, setEditing]         = useState(false)
  const [editForm, setEditForm]       = useState({})
  const [payingAll, setPayingAll]     = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasCard, setHasCard]         = useState(false)
  const [charging, setCharging]       = useState(false)
  const [freqTab, setFreqTab]         = useState(item?.payment_frequency === 'one_time' ? 'one_time' : 'monthly')
  const [oneTimeMonths, setOneTimeMonths] = useState(1)
  const [showPin, setShowPin]         = useState(false)
  const [assignCreditStep, setAssignCreditStep] = useState(false)

  useEffect(() => {
    if (!item) return
    if (!tenantName(item)) {
      supabase.from('customers').select(CUSTOMER_ASSIGN_COLUMNS).order('name')
        .then(({ data }) => { if (data) setAllCustomers(data) })
    }
  }, [item?.id])

  useEffect(() => {
    if (!item) return
    setCustomer(null)
    setSearch('')
    setIsNewCustomer(false)
    setNewCustomer({ name: '', phone: '', email: '' })
    setNewCustomerId(newClientId())
    setAssign(EMPTY_ASSIGN)
    setAssignCreditStep(false)
  }, [item?.id])

  useEffect(() => {
    if (!item) return
    if (tenantName(item)) {
      setHistoryLoading(true)
      Promise.all([
        supabase.from('storage_payments').select('*').eq('tenancy_id', item.tenancy_id).order('period_label', { ascending: false }),
        supabase.from('sms_reminder_log').select('*').eq('ref_id', item.id).order('sent_date', { ascending: false }).limit(10),
        item.customer_id
          ? supabase.from('customers').select('has_payment_method').eq('id', item.customer_id).single()
          : Promise.resolve({ data: null }),
      ]).then(([{ data: payments }, { data: logs }, { data: cust }]) => {
        if (payments) setHistory(sortPaymentsByPeriod(payments))
        if (logs) setSmsLog(logs)
        setHasCard(!!cust?.has_payment_method)
        setHistoryLoading(false)
      })
    } else {
      setHistory([])
      setAssign(EMPTY_ASSIGN)
      setCustomer(null)
      setSmsLog([])
    }
    setConfirmVacate(false)
    setVacateInput('')
    setVacateStep('confirm')
    setTransferUnitId(null)
    setAssignCreditStep(false)
    setRemindState('idle')
    setEditing(false)
    setShowPin(false)
  }, [item?.id])

  function startEdit() {
    setEditForm({
      item_type:         item.item_type      ?? 'boat',
      custom_item_type:  item.custom_item_type ?? '',
      item_label:        item.item_label     ?? '',
      monthly_rate:      item.monthly_rate  ?? '',
      billing_day:       item.billing_day   ?? '',
      payment_frequency: item.payment_frequency ?? 'monthly',
      move_in_date:      item.move_in_date  ?? '',
      notes:             item.notes         ?? '',
    })
    setEditing(true)
  }

  async function handleSaveEdit() {
    setSaving(true)
    const payload = {
      monthly_rate:      editForm.monthly_rate ? Number(editForm.monthly_rate) : null,
      billing_day:       editForm.billing_day  ? Number(editForm.billing_day)  : null,
      payment_frequency: editForm.payment_frequency || null,
      move_in_date:      editForm.move_in_date  || null,
      notes:             editForm.notes.trim()  || null,
    }
    if (item.storage_kind === 'customer_item') {
      Object.assign(payload, {
        item_type: editForm.item_type || 'boat',
        custom_item_type: editForm.item_type === 'custom' ? editForm.custom_item_type.trim() || null : null,
        item_label: editForm.item_label.trim() || item.item_label,
      })
    }
    await supabase.from('storage_tenancies').update(payload).eq('id', item.tenancy_id)
    setSaving(false)
    setEditing(false)
    onAssigned()
  }

  async function handleMarkOnePaid(period) {
    const amount = periodChargeAmount(period, item.billing_day, item.move_in_date, item.monthly_rate)
    const { data } = await supabase
      .from('storage_payments')
      .upsert({ tenancy_id: item.tenancy_id, period_label: period, ...paymentAmountsFromSubtotal(amount) }, { onConflict: 'tenancy_id,period_label' })
      .select()
      .single()
    if (data) setHistory(prev => sortPaymentsByPeriod([data, ...prev]))
    await extendTenancyPaidThrough({
      tenancyId: item.tenancy_id,
      billingDay: item.billing_day,
      periods: [period],
      currentPaidThroughDate: item.paid_through_date,
    })
    onAssigned()
  }

  async function handlePayAll(unpaid) {
    setPayingAll(true)
    const inserts = unpaid.map(period => ({
      tenancy_id: item.tenancy_id,
      period_label: period,
      ...paymentAmountsFromSubtotal(periodChargeAmount(period, item.billing_day, item.move_in_date, item.monthly_rate)),
    }))
    const { data } = await supabase.from('storage_payments').upsert(inserts, { onConflict: 'tenancy_id,period_label' }).select()
    setHistory(prev => sortPaymentsByPeriod([...(data ?? []), ...prev]))
    await extendTenancyPaidThrough({
      tenancyId: item.tenancy_id,
      billingDay: item.billing_day,
      periods: unpaid,
      currentPaidThroughDate: item.paid_through_date,
    })
    setPayingAll(false)
    onAssigned()
  }

  async function handleChargeNow(period) {
    const billingPin = promptBillingPin()
    if (!billingPin) return

    setCharging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const chargeTarget = item.storage_kind === 'customer_item'
        ? { tenancy_id: item.tenancy_id }
        : { unit_id: item.id }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...chargeTarget, billing_pin: billingPin, request_id: newBillingRequestId() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        window.alert(data.error || 'Charge failed.')
        return
      }
      if (data.status === 'charged') {
        const { data: payment } = await supabase
          .from('storage_payments').select('*')
          .eq('tenancy_id', item.tenancy_id).eq('period_label', data.period).maybeSingle()
        if (payment) setHistory(prev => sortPaymentsByPeriod([payment, ...prev.filter(p => p.period_label !== data.period)]))
        if (data.period) {
          await extendTenancyPaidThrough({
            tenancyId: item.tenancy_id,
            billingDay: item.billing_day,
            periods: [data.period],
            currentPaidThroughDate: item.paid_through_date,
          })
        }
        onAssigned()
      } else if (data.status === 'skipped' && data.reason === 'already_paid') {
        onAssigned()
      }
    } finally {
      setCharging(false)
    }
  }

  function oneTimePeriods(months) {
    const paidSet = new Set(history.map(h => h.period_label))
    const start = currentPeriodLabel(item.billing_day)
    const [y, m] = start.split('-').map(Number)
    return Array.from({ length: months }, (_, i) => {
      const d = new Date(y, m - 1 + i, 1)
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { label, alreadyPaid: paidSet.has(label) }
    })
  }

  async function handleMarkPaidOneTime() {
    const unpaid = oneTimePeriods(oneTimeMonths).filter(p => !p.alreadyPaid).map(p => p.label)
    if (!unpaid.length) return
    const inserts = unpaid.map(period => ({
      tenancy_id: item.tenancy_id,
      period_label: period,
      ...paymentAmountsFromSubtotal(periodChargeAmount(period, item.billing_day, item.move_in_date, item.monthly_rate)),
    }))
    const { data } = await supabase.from('storage_payments').upsert(inserts, { onConflict: 'tenancy_id,period_label' }).select()
    setHistory(prev => sortPaymentsByPeriod([...(data ?? []), ...prev]))
    await extendTenancyPaidThrough({
      tenancyId: item.tenancy_id,
      billingDay: item.billing_day,
      periods: unpaid,
      currentPaidThroughDate: item.paid_through_date,
    })
    onAssigned()
  }

  async function handleChargeOneTime() {
    const billingPin = promptBillingPin()
    if (!billingPin) return

    setCharging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const chargeTarget = item.storage_kind === 'customer_item'
        ? { tenancy_id: item.tenancy_id }
        : { unit_id: item.id }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...chargeTarget,
          months: oneTimeMonths,
          billing_pin: billingPin,
          request_id: newBillingRequestId(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        window.alert(data.error || 'Charge failed.')
        return
      }
      if (data.status === 'charged') {
        const { data: payments } = await supabase
          .from('storage_payments').select('*')
          .eq('tenancy_id', item.tenancy_id).in('period_label', data.periods ?? [])
        if (payments?.length) setHistory(prev => sortPaymentsByPeriod([...payments, ...prev.filter(p => !data.periods?.includes(p.period_label))]))
        if (data.periods?.length) {
          await extendTenancyPaidThrough({
            tenancyId: item.tenancy_id,
            billingDay: item.billing_day,
            periods: data.periods,
            currentPaidThroughDate: item.paid_through_date,
          })
        }
        onAssigned()
      }
    } finally {
      setCharging(false)
    }
  }

  async function handleSendReminder(behindCount) {
    setRemindState('sending')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const behind = behindCount > 1 ? `${behindCount} months behind` : behindCount === 1 ? 'overdue' : 'outstanding'
      const label = storageItemLabel(item)
      const unitType = item.storage_kind === 'customer_item' ? 'customer_item' : 'fixed'
      const refId = item.storage_kind === 'customer_item' ? item.tenancy_id : item.id
      const body =
        `Hi ${tenantName(item)}, this is a reminder that your ${label} storage payment is ${behind}.` +
        ` Please arrange payment at your earliest convenience.`
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: item.tenant_phone, body, ref_id: refId, unit_type: unitType }),
      })
      setSmsLog(prev => [{
        id: crypto.randomUUID(), ref_id: refId, unit_type: unitType,
        phone: item.tenant_phone, sent_date: new Date().toISOString().slice(0, 10),
        days_overdue: null, message: body, created_at: new Date().toISOString(),
      }, ...prev])
      setRemindState('sent')
      setTimeout(() => setRemindState('idle'), 3000)
    } catch {
      setRemindState('idle')
    }
  }

  async function handleSendInvite(pin) {
    if (!customer?.id || !customer?.phone) return
    setSendingInvite(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before sending this invite.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-card-invite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const result = await res.json()
      if (!res.ok || result.error) return { error: result.error || 'Could not send card invite.' }

      setConfirmSendInvite(false)
      setInviteSent(true)
      setTimeout(() => setInviteSent(false), 3000)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not send card invite.' }
    } finally {
      setSendingInvite(false)
    }
  }

  async function applyOpenCreditsToTenancy({ customerId, tenancyId, monthlyRate, billingDay, moveInDate }) {
    const { data: credits } = await supabase.from('customer_credits')
      .select('*')
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .order('created_at')

    const openCredits = credits ?? []
    const monthlyRateCents = cents(monthlyRate)
    const totalCreditCents = openCredits.reduce((sum, c) => sum + cents(c.amount), 0)
    const coverage = creditCoverageFromCents({
      startDate: moveInDate || localDateStr(),
      creditCents: totalCreditCents,
      monthlyRate,
      billingDay,
    })

    if (coverage.appliedCents <= 0 || !coverage.paidThroughDate) return 0

    if (coverage.fullPeriods.length > 0) {
      const { error: paymentError } = await supabase.from('storage_payments').upsert(
        paymentRowsForPeriods({ tenancyId, periods: coverage.fullPeriods, amount: dollars(monthlyRateCents) }),
        { onConflict: 'tenancy_id,period_label' }
      )
      if (paymentError) {
        console.error('Failed to apply customer credit to paid months:', paymentError)
        return 0
      }
    }

    await updateTenancyPaidThrough(tenancyId, coverage.paidThroughDate)

    let amountToApplyCents = coverage.appliedCents
    const consumedIds = []
    let remainder = null

    for (const credit of openCredits) {
      if (amountToApplyCents <= 0) break
      const amountCents = cents(credit.amount)
      if (amountCents <= 0) continue

      consumedIds.push(credit.id)
      if (amountToApplyCents >= amountCents) {
        amountToApplyCents -= amountCents
      } else {
        remainder = {
          amount: dollars(amountCents - amountToApplyCents),
          period_labels: credit.period_labels ?? [],
          source_tenancy_id: credit.source_tenancy_id ?? null,
          source_unit_id: credit.source_unit_id ?? null,
        }
        amountToApplyCents = 0
      }
    }

    if (consumedIds.length > 0) {
      await supabase.from('customer_credits')
        .update({ status: 'applied', resolved_at: new Date().toISOString(), notes: `Applied to ${storageItemLabel(item)}` })
        .in('id', consumedIds)
    }

    if (remainder && remainder.amount > 0) {
      await supabase.from('customer_credits').insert({
        customer_id: customerId,
        source_tenancy_id: remainder.source_tenancy_id,
        source_unit_id: remainder.source_unit_id,
        amount: remainder.amount,
        reason: 'remaining_customer_credit',
        period_labels: remainder.period_labels,
        notes: `Remaining credit after applying paid time through ${coverage.paidThroughDate} to ${storageItemLabel(item)}`,
      })
    }

    return coverage
  }

  async function handleAssign({ applyCredits = false } = {}) {
    if (saving) return
    setSaving(true)
    try {
      let assignCustomer = customer
      if (isNewCustomer) {
        const { data } = await retryTransient(async () => {
          const result = await supabase.from('customers').insert({
            id:    newCustomerId,
            name:  newCustomer.name.trim()  || null,
            phone: newCustomer.phone.trim() || null,
            email: newCustomer.email.trim() || null,
          }).select(CUSTOMER_ASSIGN_COLUMNS).single()

          if (result.error?.code === '23505') {
            return throwSupabaseError(
              await supabase.from('customers').select(CUSTOMER_ASSIGN_COLUMNS).eq('id', newCustomerId).single()
            )
          }

          return throwSupabaseError(result)
        })
        if (!data) throw new Error('Could not create the customer.')
        assignCustomer = data
      }
      if (!assignCustomer) throw new Error('Choose a customer before assigning the unit.')

      const monthlyRate = assign.monthly_rate ? Number(assign.monthly_rate) : null
      const billingDay = assign.billing_day ? Number(assign.billing_day) : null

      const { data: tenancy, error } = await supabase.from('storage_tenancies').insert({
        unit_id:           item.id,
        customer_id:       assignCustomer.id,
        tenant_name:       assignCustomer.name  || null,
        tenant_phone:      assignCustomer.phone || null,
        monthly_rate:      monthlyRate,
        billing_day:       billingDay,
        payment_frequency: assign.payment_frequency || null,
        move_in_date:      assign.move_in_date  || null,
        notes:             assign.notes.trim()  || null,
      }).select('id').single()
      if (error) throw error
      if (!tenancy?.id) throw new Error('Could not assign the unit.')

      if (applyCredits && monthlyRate && billingDay) {
        await applyOpenCreditsToTenancy({
          customerId: assignCustomer.id,
          tenancyId: tenancy.id,
          monthlyRate,
          billingDay,
          moveInDate: assign.move_in_date,
        })
      }

      onAssigned()
      onClose()
      setNewCustomerId(newClientId())
    } catch (err) {
      console.error('Failed to assign storage unit:', err)
      window.alert(err instanceof Error ? err.message : 'Could not assign the unit.')
    } finally {
      setSaving(false)
    }
  }

  async function handleVacate(targetUnitId) {
    setSaving(true)
    const today = localDateStr()

    if (hasTransferablePaidValue) {
      if (targetUnitId) {
        // Find active tenancy on the target unit (if it exists already)
        const { data: existingTenancy } = await supabase
          .from('storage_tenancies')
          .select('id, paid_through_date')
          .eq('unit_id', targetUnitId)
          .is('end_date', null)
          .maybeSingle()

        let destTenancyId = existingTenancy?.id

        if (!destTenancyId) {
          const { data: newTenancy } = await supabase.from('storage_tenancies').insert({
            unit_id:           targetUnitId,
            customer_id:       item.customer_id,
            tenant_name:       item.tenant_name,
            tenant_phone:      item.tenant_phone,
            monthly_rate:      item.monthly_rate,
            billing_day:       item.billing_day,
            payment_frequency: item.payment_frequency,
            move_in_date:      today,
            paid_through_date: effectivePaidThroughDate,
            notes:             item.notes,
          }).select('id').single()
          destTenancyId = newTenancy?.id
        } else if (effectivePaidThroughDate) {
          const targetPaidThroughDates = [existingTenancy.paid_through_date, effectivePaidThroughDate].filter(Boolean).sort()
          const targetPaidThroughDate = targetPaidThroughDates[targetPaidThroughDates.length - 1]
          await supabase.from('storage_tenancies')
            .update({ paid_through_date: targetPaidThroughDate })
            .eq('id', destTenancyId)
        }

        if (destTenancyId) {
          await supabase.from('storage_payments')
            .update({ tenancy_id: destTenancyId })
            .eq('tenancy_id', item.tenancy_id)
            .in('period_label', futurePaidPeriods)
        }
      } else if (item.customer_id) {
        const creditCents = unusedPaidCreditCents

        if (creditCents > 0) {
          await supabase.from('customer_credits').insert({
            customer_id: item.customer_id,
            source_tenancy_id: item.tenancy_id,
            source_unit_id: item.storage_kind === 'customer_item' ? null : item.id,
            amount: dollars(creditCents),
            reason: 'vacate_prepaid_storage',
            period_labels: futurePaidPeriods,
            notes: effectivePaidThroughDate
              ? `${storageItemLabel(item)} paid-through balance skipped on vacate (${effectivePaidThroughDate})`
              : `${storageItemLabel(item)} prepaid months skipped on vacate`,
          })
        }
      }
    }

    await supabase.from('storage_tenancies')
      .update({ end_date: today })
      .eq('id', item.tenancy_id)

    setSaving(false)
    onAssigned()
    onClose()
  }

  function startVacateTransferStep() {
    supabase.from('storage_units').select('id, unit_number').order('unit_number')
      .then(async ({ data: allUnits }) => {
        if (!allUnits) return
        const { data: occupied } = await supabase
          .from('storage_tenancies').select('unit_id').eq('storage_kind', 'fixed_unit').is('end_date', null)
        const occupiedIds = new Set((occupied || []).map(t => t.unit_id))
        occupiedIds.add(item.id)
        setVacantUnits(allUnits.filter(u => !occupiedIds.has(u.id)))
        setVacateStep('transfer')
      })
  }

  if (!item) return null

  const isCustomerItem = item.storage_kind === 'customer_item'
  const itemLabel = storageItemLabel(item)
  const vacant = !tenantName(item)
  const status = vacant ? null : paymentStatus(item.billing_day, item.payment_frequency, isPaid, item.move_in_date, item.paid_through_date)
  const periods = generatePeriods(item.billing_day, item.move_in_date)
  const paidPeriodSet = new Set(history.map(p => p.period_label).filter(isPeriodLabel))
  const currentPeriod = item.billing_day ? currentPeriodLabel(item.billing_day) : null
  const futurePaidPeriods = currentPeriod
    ? history.filter(p => isPeriodLabel(p.period_label) && p.period_label > currentPeriod).map(p => p.period_label).sort()
    : []
  const effectivePaidThroughDate = paidThroughFromPayments(history, item.billing_day, item.paid_through_date)
  const unpaidPeriods = periods.filter(p => !periodCovered(p, item.billing_day, paidPeriodSet, effectivePaidThroughDate))
  const behindCount = unpaidPeriods.length
  const futurePaidCreditCents = futurePaidPeriods.reduce((sum, period) => {
    const payment = history.find(p => p.period_label === period)
    const paidCents = cents(payment?.amount)
    const monthlyRateCents = cents(item.monthly_rate)
    if (paidCents > 0) return sum + (monthlyRateCents > 0 ? Math.min(paidCents, monthlyRateCents) : paidCents)
    return sum + monthlyRateCents
  }, 0)
  const paidThroughCreditCents = creditCentsForPaidThrough({
    startDate: localDateStr(),
    paidThroughDate: effectivePaidThroughDate,
    monthlyRate: item.monthly_rate,
    billingDay: item.billing_day,
  })
  const unusedPaidCreditCents = Math.max(paidThroughCreditCents, futurePaidCreditCents)
  const hasTransferablePaidValue = futurePaidPeriods.length > 0 || unusedPaidCreditCents > 0
  const openCustomerCredits = (customer?.customer_credits ?? []).filter(c => c.status === 'open')
  const openCreditTotal = openCustomerCredits.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const assignMonthlyRate = Number(assign.monthly_rate || 0)
  const creditCoveragePreview = customer && assignMonthlyRate > 0
    ? creditCoverageFromCents({
        startDate: assign.move_in_date || localDateStr(),
        creditCents: cents(openCreditTotal),
        monthlyRate: assignMonthlyRate,
        billingDay: Number(assign.billing_day || 0),
      })
    : null
  const creditDaysAvailable = creditCoveragePreview?.paidThroughDate
    ? daysInclusive(parseLocalDate(assign.move_in_date || localDateStr()), parseLocalDate(creditCoveragePreview.paidThroughDate))
    : 0
  const creditAmountToApply = dollars(creditCoveragePreview?.appliedCents ?? 0)
  const canApplyCustomerCredit = (creditCoveragePreview?.appliedCents ?? 0) > 0

  function handleSheetOpenChange(open) {
    if (open) return
    if (confirmSendInvite) return
    onClose()
  }

  function handleSheetInteractOutside(event) {
    if (confirmSendInvite) event.preventDefault()
  }

  return (
    <Sheet open={!!item} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto"
        onPointerDownOutside={handleSheetInteractOutside}
        onInteractOutside={handleSheetInteractOutside}
      >
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>{itemLabel}</span>
            {status && <StatusBadge status={status} billingDay={item.billing_day} moveInDate={item.move_in_date} />}
          </SheetTitle>
        </SheetHeader>

        {vacant ? (
          <div className="space-y-4">

            {/* ── Customer ── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Customer</p>
              {customer ? (
                <div className="space-y-2">
                  <div className="bg-muted/50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{customer.name}</p>
                      {customer.phone && <p className="text-xs text-muted-foreground">{formatPhone(customer.phone)}</p>}
                      {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                      {openCreditTotal > 0 && (
                        <p className="text-xs text-amber-600">Credit owed ${openCreditTotal.toFixed(2)}</p>
                      )}
                    </div>
                    <button onClick={() => { setCustomer(null); setSearch(''); setIsNewCustomer(false); setAssignCreditStep(false) }} className="text-muted-foreground hover:text-foreground ml-2">
                      <X size={16} />
                    </button>
                  </div>
                  {customer.has_payment_method ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 px-1">
                      <CheckCircle2 size={13} />
                      Card on file
                    </div>
                  ) : customer.phone ? (
                    <button onClick={() => setConfirmSendInvite(true)} disabled={sendingInvite} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-1">
                      <Send size={13} />
                      {inviteSent ? 'Invite sent!' : 'Send card invite'}
                    </button>
                  ) : null}
                </div>
              ) : isNewCustomer ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">New customer</p>
                    <button onClick={() => setIsNewCustomer(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                  <Input value={newCustomer.name} onChange={e => setNewCustomer(c => ({ ...c, name: e.target.value }))} placeholder="Full name" autoFocus />
                  <Input value={newCustomer.phone} onChange={e => setNewCustomer(c => ({ ...c, phone: formatPhoneInput(e.target.value) }))} placeholder="(519) 555-0000" type="tel" />
                  <Input value={newCustomer.email} onChange={e => setNewCustomer(c => ({ ...c, email: e.target.value }))} placeholder="email@example.com" type="email" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search existing customers…" className="pl-8" autoFocus />
                  </div>
                  {search.trim().length > 0 && (
                    <div className="border rounded-xl overflow-hidden">
                      {allCustomers
                        .filter(c => [c.name, c.phone, c.email].some(f => f?.toLowerCase().includes(search.toLowerCase())))
                        .slice(0, 5)
                        .map(c => (
                          <button key={c.id} type="button" onClick={() => { setCustomer(c); setSearch(''); setAssignCreditStep(false) }}
                            className="w-full text-left px-4 py-3 text-sm hover:bg-accent flex items-center justify-between border-b last:border-0">
                            <span>
                              <span className="font-medium">{c.name}</span>
                              {(c.customer_credits ?? []).some(credit => credit.status === 'open') && (
                                <span className="block text-xs text-amber-600">
                                  Credit owed ${(c.customer_credits ?? []).filter(credit => credit.status === 'open').reduce((sum, credit) => sum + (Number(credit.amount) || 0), 0).toFixed(2)}
                                </span>
                              )}
                            </span>
                            {c.phone && <span className="text-xs text-muted-foreground">{formatPhone(c.phone)}</span>}
                          </button>
                        ))
                      }
                      {allCustomers.filter(c => [c.name, c.phone, c.email].some(f => f?.toLowerCase().includes(search.toLowerCase()))).length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted-foreground">No match for "{search}"</p>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => setIsNewCustomer(true)}
                    className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors pt-1">
                    <Plus size={14} />
                    New customer
                  </button>
                </div>
              )}
            </div>

            {/* ── Unit details ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unit Details</p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Monthly Rate ($)</p>
                  <Input value={assign.monthly_rate} onChange={e => setAssign(a => ({ ...a, monthly_rate: e.target.value }))} placeholder="150" type="number" min="0" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Billing Day</p>
                  <Input value={assign.billing_day} onChange={e => setAssign(a => ({ ...a, billing_day: e.target.value }))} placeholder="1" type="number" min="1" max="31" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
                <StorageDateSelect value={assign.move_in_date} onChange={value => setAssign(a => ({ ...a, move_in_date: value }))} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                <Input value={assign.notes} onChange={e => setAssign(a => ({ ...a, notes: e.target.value }))} placeholder="Extra lock, access info…" />
              </div>
            </div>

            {assignCreditStep ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium">Apply customer credit?</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {customer.name} has ${openCreditTotal.toFixed(2)} in open credit. At ${assignMonthlyRate.toFixed(2)}/mo, apply ${creditAmountToApply.toFixed(2)}
                    {creditCoveragePreview?.paidThroughDate
                      ? ` for ${creditDaysAvailable} paid day${creditDaysAvailable !== 1 ? 's' : ''}, through ${formatLocalDate(creditCoveragePreview.paidThroughDate, { month: 'short', day: 'numeric', year: 'numeric' })}?`
                      : '?'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled={saving} onClick={() => handleAssign({ applyCredits: false })}>
                    {saving ? 'Saving…' : 'Skip credit'}
                  </Button>
                  <Button className="flex-1" disabled={saving} onClick={() => handleAssign({ applyCredits: true })}>
                    {saving ? 'Applying…' : 'Apply credit'}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {openCreditTotal > 0 && customer && assignMonthlyRate > 0 && !canApplyCustomerCredit && (
                  <p className="text-xs text-amber-600">
                    Customer has ${openCreditTotal.toFixed(2)} credit, not enough for one paid day at this rate.
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                  <Button className="flex-1"
                    disabled={(!customer && (!isNewCustomer || !newCustomer.name.trim())) || !assign.billing_day || saving}
                    onClick={() => {
                      if (customer && canApplyCustomerCredit) {
                        setAssignCreditStep(true)
                      } else {
                        handleAssign()
                      }
                    }}>
                    {saving ? 'Saving…' : 'Assign Unit'}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {editing ? (
              <div className="space-y-3">
                {isCustomerItem && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Item Type</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {CUSTOMER_STORAGE_TYPES.map(type => (
                          <button key={type.value} type="button"
                            onClick={() => setEditForm(f => ({ ...f, item_type: type.value }))}
                            className={`text-xs py-2 rounded-lg border transition-colors ${editForm.item_type === type.value ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            {type.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {editForm.item_type === 'custom' && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">Custom Type</p>
                        <Input value={editForm.custom_item_type} onChange={e => setEditForm(f => ({ ...f, custom_item_type: e.target.value }))} placeholder="Equipment, vehicle, etc." />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Description</p>
                      <Input value={editForm.item_label} onChange={e => setEditForm(f => ({ ...f, item_label: e.target.value }))} placeholder="Blue Bayliner, RV plate, trailer colour…" />
                    </div>
                  </>
                )}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1.5">Monthly Rate ($)</p>
                    <Input value={editForm.monthly_rate} onChange={e => setEditForm(f => ({ ...f, monthly_rate: e.target.value }))} placeholder="120" type="number" min="0" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1.5">Billing Day</p>
                    <Input value={editForm.billing_day} onChange={e => setEditForm(f => ({ ...f, billing_day: e.target.value }))} placeholder="1" type="number" min="1" max="31" />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Payment Frequency</p>
                  <div className="flex gap-1.5">
                    {Object.entries(FREQ_LABELS).map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setEditForm(f => ({ ...f, payment_frequency: val }))}
                        className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${editForm.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
                  <StorageDateSelect value={editForm.move_in_date} onChange={value => setEditForm(f => ({ ...f, move_in_date: value }))} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                  <Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Extra lock, access info…" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button className="flex-1" disabled={saving} onClick={handleSaveEdit}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {tenantName(item) && <p className="font-medium">{tenantName(item)}</p>}
                    {item.tenant_phone && (
                      <a href={`tel:${item.tenant_phone}`} className="flex items-center gap-1.5 text-sm text-primary">
                        <Phone size={13} />
                        {formatPhone(item.tenant_phone)}
                      </a>
                    )}
                    {item.customers?.payment_pin && (
                      <button onClick={() => setShowPin(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Payment PIN <span className="font-mono font-semibold text-foreground tracking-widest">{showPin ? item.customers.payment_pin : '•••••'}</span>
                        {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    )}
                    {item.monthly_rate && (
                      <p className="text-sm text-muted-foreground">${item.monthly_rate}/mo · billed the {ordinal(item.billing_day)}</p>
                    )}
                    {item.move_in_date && (
                      <p className="text-xs text-muted-foreground">
                        Tenant for {tenureSummary(item.move_in_date)} · since {formatLocalDate(item.move_in_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                    {effectivePaidThroughDate && (
                      <p className="text-xs text-green-600">
                        Paid through {formatLocalDate(effectivePaidThroughDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                    {item.unit_notes && <p className="text-xs text-muted-foreground mt-1">Unit note: {item.unit_notes}</p>}
                    {item.notes && <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>}
                  </div>
                  <button onClick={startEdit} className="p-2 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                    <Pencil size={15} />
                  </button>
                </div>
              </div>
            )}

            {!editing && (
              <>
                <button
                  onClick={() => { onClose(); navigate(isCustomerItem ? `/storage/customer/${item.tenancy_id}/billing` : `/storage/${item.id}/billing`) }}
                  className="w-full flex items-center justify-between bg-card border rounded-xl px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-left">Billing</p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const recent = history.filter(p => isPeriodLabel(p.period_label)).slice(0, 3).map(p => {
                          const [y, m] = p.period_label.split('-').map(Number)
                          return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
                        })
                        if (recent.length > 0) return recent.join(' · ')
                        if (effectivePaidThroughDate) return `Paid through ${formatLocalDate(effectivePaidThroughDate, { month: 'short', day: 'numeric' })}`
                        return behindCount > 0 ? `${behindCount} month${behindCount !== 1 ? 's' : ''} behind` : 'No paid months yet'
                      })()}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>

                {item.tenant_phone && (
                  <Button variant="outline" className="w-full gap-2" disabled={remindState !== 'idle'} onClick={() => handleSendReminder(behindCount)}>
                    <Send size={14} />
                    {remindState === 'sending' ? 'Sending…' : remindState === 'sent' ? 'Sent!' : 'Send reminder'}
                  </Button>
                )}

                {!confirmVacate ? (
                  <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirmVacate(true)}>
                    {isCustomerItem ? 'End Storage' : 'Mark Vacant'}
                  </Button>
                ) : vacateStep === 'confirm' ? (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                    <p className="text-sm font-medium">{isCustomerItem ? `End storage for ${itemLabel}?` : `Mark unit ${item.unit_number} as vacant?`}</p>
                    <p className="text-xs text-muted-foreground">The customer's payment history is preserved. Their storage record is closed.</p>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Type <span className="font-mono font-semibold text-foreground">{isCustomerItem ? item.item_label : item.unit_number}</span> to confirm</p>
                      <Input value={vacateInput} onChange={e => setVacateInput(e.target.value)} placeholder={isCustomerItem ? item.item_label : item.unit_number} autoFocus />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => { setConfirmVacate(false); setVacateInput('') }}>Cancel</Button>
                      <Button variant="destructive" className="flex-1"
	                        disabled={saving || vacateInput !== (isCustomerItem ? item.item_label : item.unit_number)}
	                        onClick={() => {
	                          if (hasTransferablePaidValue && !isCustomerItem) {
	                            startVacateTransferStep()
	                          } else {
	                            handleVacate(null)
                          }
                        }}>
                        {saving ? 'Saving…' : 'Confirm'}
                      </Button>
                    </div>
                  </div>
                ) : (
	                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
	                    <p className="text-sm font-medium">Transfer paid balance?</p>
	                    <p className="text-xs text-muted-foreground">
	                      This tenant is paid through <span className="font-semibold text-foreground">{formatLocalDate(effectivePaidThroughDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
	                      {unusedPaidCreditCents > 0 ? ` (${dollars(unusedPaidCreditCents).toFixed(2)} remaining)` : ''}. Move that paid time to another unit?
	                    </p>
                    {vacantUnits.length > 0 ? (
                      <div className="border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                        {vacantUnits.map((u, i) => (
                          <button key={u.id} type="button"
                            onClick={() => setTransferUnitId(prev => prev === u.id ? null : u.id)}
                            className={cn('w-full text-left px-4 py-2.5 text-sm flex items-center justify-between', i < vacantUnits.length - 1 && 'border-b', transferUnitId === u.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent')}>
                            <span>Unit {u.unit_number}</span>
                            {transferUnitId === u.id && <CheckCircle2 size={14} className="text-primary" />}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No vacant units available.</p>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" disabled={saving} onClick={() => handleVacate(null)}>
                        {saving ? 'Saving…' : 'Skip transfer'}
                      </Button>
                      <Button className="flex-1" disabled={!transferUnitId || saving} onClick={() => handleVacate(transferUnitId)}>
                        {saving ? 'Moving…' : 'Transfer & vacate'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>

      <PinModal
        open={confirmSendInvite}
        onClose={() => !sendingInvite && setConfirmSendInvite(false)}
        onConfirm={handleSendInvite}
        loading={sendingInvite}
        title="Send card invite"
        subtitle="Enter billing PIN to send setup link"
        icon={Send}
        confirmLabel="Send invite"
      >
        <div className="rounded-xl border divide-y text-sm bg-muted/40">
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium text-right">{customer?.name}</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">SMS to</span>
            <span className="font-medium text-right">{formatPhone(customer?.phone)}</span>
          </div>
        </div>
      </PinModal>

    </Sheet>
  )
}

// ─── portable unit pieces (unchanged) ────────────────────────────────────────

function PortableUnitCard({ asset, rental, isPaid, isDeployed, onTap }) {
  const unassigned = !tenantName(rental)
  const status = unassigned ? null : paymentStatus(rental.billing_day, rental.payment_frequency, isPaid, rental.move_in_date, rental.paid_through_date)

  return (
    <button
      className={cn('w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors', status && cardBorder(status))}
      onClick={() => onTap(asset)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{asset.label}</span>
          {asset.size && <span className="text-xs text-muted-foreground">{asset.size}</span>}
          {unassigned
            ? <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Unassigned</span>
            : <span className="text-sm text-muted-foreground truncate">{tenantName(rental)}</span>
          }
        </div>
        {!unassigned && (
          <div className="flex items-center gap-3 mt-0.5">
            {rental.monthly_rate && <span className="text-xs text-muted-foreground">${rental.monthly_rate}/mo</span>}
            {rental.tenant_phone && <span className="text-xs text-muted-foreground">{formatPhone(rental.tenant_phone)}</span>}
            {isDeployed && <span className="text-xs text-primary">Deployed</span>}
          </div>
        )}
        {unassigned && isDeployed && <p className="text-xs text-primary mt-0.5">Deployed</p>}
      </div>
      {status && <StatusBadge status={status} billingDay={rental.billing_day} moveInDate={rental.move_in_date} />}
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

function PortableStorageSheet({ asset, rental, isPaid, onClose, onTogglePaid, onAssigned }) {
  const navigate = useNavigate()
  const [history, setHistory]       = useState([])
  const [smsLog, setSmsLog]         = useState([])
  const [assign, setAssign]         = useState(EMPTY_ASSIGN)
  const [customer, setCustomer]     = useState(null)
  const [saving, setSaving]         = useState(false)
  const [confirmVacate, setConfirmVacate] = useState(false)
  const [vacateInput, setVacateInput]     = useState('')
  const [remindState, setRemindState] = useState('idle')
  const [editing, setEditing]       = useState(false)
  const [editForm, setEditForm]     = useState({})
  const [payingAll, setPayingAll]   = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showPin, setShowPin]       = useState(false)
  const [confirmSendInvite, setConfirmSendInvite] = useState(false)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)
  const [confirmRemovePayment, setConfirmRemovePayment] = useState(false)
  const [removingPayment, setRemovingPayment] = useState(false)

  useEffect(() => {
    if (!asset) return
    if (tenantName(rental)) {
      setHistoryLoading(true)
      Promise.all([
        supabase.from('portable_storage_payments').select('*').eq('asset_id', asset.id).order('period_label', { ascending: false }),
        supabase.from('sms_reminder_log').select('*').eq('ref_id', asset.id).order('sent_date', { ascending: false }).limit(10),
      ]).then(([{ data: payments }, { data: logs }]) => {
        if (payments) setHistory(sortPaymentsByPeriod(payments))
        if (logs) setSmsLog(logs)
        setHistoryLoading(false)
      })
    } else {
      setAssign(EMPTY_ASSIGN)
      setCustomer(null)
      setSmsLog([])
    }
    setConfirmVacate(false)
    setVacateInput('')
    setRemindState('idle')
    setEditing(false)
    setShowPin(false)
    setConfirmSendInvite(false)
    setConfirmRemovePayment(false)
    setRemovingPayment(false)
    setInviteSent(false)
  }, [asset?.id, rental?.tenant_name])

  function startEdit() {
    setEditForm({
      monthly_rate:      rental.monthly_rate  ?? '',
      billing_day:       rental.billing_day   ?? '',
      payment_frequency: rental.payment_frequency ?? 'monthly',
      move_in_date:      rental.move_in_date  ?? '',
      notes:             rental.notes         ?? '',
    })
    setEditing(true)
  }

  async function handleSaveEdit() {
    setSaving(true)
    await supabase.from('portable_storage_rentals').update({
      monthly_rate:      editForm.monthly_rate ? Number(editForm.monthly_rate) : null,
      billing_day:       editForm.billing_day  ? Number(editForm.billing_day)  : null,
      payment_frequency: editForm.payment_frequency || null,
      move_in_date:      editForm.move_in_date  || null,
      notes:             editForm.notes.trim()  || null,
    }).eq('asset_id', asset.id)
    setSaving(false)
    setEditing(false)
    onAssigned()
  }

  async function handleMarkOnePaid(period) {
    const amount = periodChargeAmount(period, rental.billing_day, rental.move_in_date, rental.monthly_rate)
    const { data } = await supabase
      .from('portable_storage_payments')
      .upsert({ asset_id: asset.id, period_label: period, ...paymentAmountsFromSubtotal(amount) }, { onConflict: 'asset_id,period_label' })
      .select().single()
    if (data) setHistory(prev => sortPaymentsByPeriod([data, ...prev]))
    await extendPortablePaidThrough([period])
    onAssigned()
  }

  async function handleRemoveLatestPayment(pin) {
    if (!latestPayment) return { error: 'No paid months to remove.' }

    setRemovingPayment(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before removing this payment.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_latest_payment',
          portable_asset_id: asset.id,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { error: data.error || 'Could not remove payment.' }
      if (data.status === 'skipped') {
        return { error: data.reason === 'no_payments' ? 'No paid months to remove.' : `Payment skipped: ${data.reason || 'unknown reason'}.` }
      }

      const removed = data.removed_payment ?? latestPayment
      setHistory(prev => sortPaymentsByPeriod(prev.filter(payment => (
        payment.id !== removed.id && payment.period_label !== removed.period_label
      ))))
      setConfirmRemovePayment(false)
      onAssigned()
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not remove payment.' }
    } finally {
      setRemovingPayment(false)
    }
  }

  async function handlePayAll(unpaid) {
    setPayingAll(true)
    const inserts = unpaid.map(period => ({
      asset_id: asset.id,
      period_label: period,
      ...paymentAmountsFromSubtotal(periodChargeAmount(period, rental.billing_day, rental.move_in_date, rental.monthly_rate)),
    }))
    const { data } = await supabase.from('portable_storage_payments').upsert(inserts, { onConflict: 'asset_id,period_label' }).select()
    setHistory(prev => sortPaymentsByPeriod([...(data ?? []), ...prev]))
    await extendPortablePaidThrough(unpaid)
    setPayingAll(false)
    onAssigned()
  }

  async function updatePortablePaidThrough(paidThroughDate) {
    await supabase.from('portable_storage_rentals')
      .update({ paid_through_date: paidThroughDate })
      .eq('asset_id', asset.id)
  }

  async function extendPortablePaidThrough(periods) {
    const paidThroughDate = paidThroughFromPayments(
      periods.map(period_label => ({ period_label })),
      rental.billing_day,
      rental.paid_through_date
    )
    if (paidThroughDate) await updatePortablePaidThrough(paidThroughDate)
    return paidThroughDate
  }

  async function handleSendReminder(behindCount) {
    setRemindState('sending')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const behind = behindCount > 1 ? `${behindCount} months behind` : behindCount === 1 ? 'overdue' : 'outstanding'
      const body =
        `Hi ${tenantName(rental)}, this is a reminder that your ${asset.label} storage payment is ${behind}.` +
        ` Please arrange payment at your earliest convenience.`
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: rental.tenant_phone, body, ref_id: asset.id, unit_type: 'portable' }),
      })
      setSmsLog(prev => [{
        id: crypto.randomUUID(), ref_id: asset.id, unit_type: 'portable',
        phone: rental.tenant_phone, sent_date: new Date().toISOString().slice(0, 10),
        days_overdue: null, message: body, created_at: new Date().toISOString(),
      }, ...prev])
      setRemindState('sent')
      setTimeout(() => setRemindState('idle'), 3000)
    } catch {
      setRemindState('idle')
    }
  }

  async function handleSendInvite(pin) {
    if (!customer?.id || !customer?.phone) return
    setSendingInvite(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before sending this invite.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-card-invite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const result = await res.json()
      if (!res.ok || result.error) return { error: result.error || 'Could not send card invite.' }

      setConfirmSendInvite(false)
      setInviteSent(true)
      setTimeout(() => setInviteSent(false), 3000)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not send card invite.' }
    } finally {
      setSendingInvite(false)
    }
  }

  async function handleAssign() {
    if (!customer) return
    if (saving) return
    setSaving(true)
    try {
      const { error } = await supabase.from('portable_storage_rentals').upsert({
        asset_id:          asset.id,
        customer_id:       customer.id,
        tenant_name:       customer.name  || null,
        tenant_phone:      customer.phone || null,
        monthly_rate:      assign.monthly_rate ? Number(assign.monthly_rate) : null,
        billing_day:       assign.billing_day  ? Number(assign.billing_day)  : null,
        payment_frequency: assign.payment_frequency || null,
        move_in_date:      assign.move_in_date  || null,
        notes:             assign.notes.trim()  || null,
      }, { onConflict: 'asset_id' })
      if (error) throw error

      onAssigned()
      onClose()
    } catch (err) {
      console.error('Failed to assign portable storage:', err)
      window.alert(err instanceof Error ? err.message : 'Could not assign the storage unit.')
    } finally {
      setSaving(false)
    }
  }

  async function handleVacate() {
    setSaving(true)
    await supabase.from('portable_storage_rentals').delete().eq('asset_id', asset.id)
    setSaving(false)
    onAssigned()
    onClose()
  }

  if (!asset) return null

  const unassigned = !tenantName(rental)
  const status = unassigned ? null : paymentStatus(rental.billing_day, rental.payment_frequency, isPaid, rental.move_in_date, rental.paid_through_date)
  const periods = generatePeriods(rental?.billing_day, rental?.move_in_date)
  const paidPeriodSet = new Set(history.map(p => p.period_label).filter(isPeriodLabel))
  const latestPayment = history.find(payment => isPeriodLabel(payment.period_label))
  const effectivePaidThroughDate = paidThroughFromPayments(history, rental?.billing_day, rental?.paid_through_date)
  const unpaidPeriods = periods.filter(p => !periodCovered(p, rental?.billing_day, paidPeriodSet, effectivePaidThroughDate))
  const behindCount = unpaidPeriods.length

  return (
    <Sheet open={!!asset} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>{asset.label}{asset.size ? ` · ${asset.size}` : ''}</span>
            {status && <StatusBadge status={status} billingDay={rental.billing_day} moveInDate={rental.move_in_date} />}
          </SheetTitle>
        </SheetHeader>

        {unassigned ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Customer</p>
              <CustomerPicker value={customer} onChange={setCustomer} />
              {customer?.has_payment_method ? (
                <div className="flex items-center gap-1.5 text-xs text-green-600 px-1 pt-2">
                  <CheckCircle2 size={13} />
                  Card on file
                </div>
              ) : customer?.phone ? (
                <button onClick={() => setConfirmSendInvite(true)} disabled={sendingInvite} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-1 pt-2">
                  <Send size={13} />
                  {inviteSent ? 'Invite sent!' : 'Send card invite'}
                </button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Monthly Rate ($)</p>
                <Input value={assign.monthly_rate} onChange={e => setAssign(a => ({ ...a, monthly_rate: e.target.value }))} placeholder="120" type="number" min="0" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Billing Day <span className="text-destructive">*</span></p>
                <Input value={assign.billing_day} onChange={e => setAssign(a => ({ ...a, billing_day: e.target.value }))} placeholder="1" type="number" min="1" max="31" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Payment Frequency</p>
              <div className="flex gap-1.5">
                {Object.entries(FREQ_LABELS).map(([val, label]) => (
                  <button key={val} type="button"
                    onClick={() => setAssign(a => ({ ...a, payment_frequency: val }))}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${assign.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
              <StorageDateSelect value={assign.move_in_date} onChange={value => setAssign(a => ({ ...a, move_in_date: value }))} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
              <Input value={assign.notes} onChange={e => setAssign(a => ({ ...a, notes: e.target.value }))} placeholder="Access info, location…" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" disabled={!customer || !assign.billing_day || saving} onClick={handleAssign}>
                {saving ? 'Saving…' : 'Assign'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {editing ? (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1.5">Monthly Rate ($)</p>
                    <Input value={editForm.monthly_rate} onChange={e => setEditForm(f => ({ ...f, monthly_rate: e.target.value }))} placeholder="120" type="number" min="0" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1.5">Billing Day</p>
                    <Input value={editForm.billing_day} onChange={e => setEditForm(f => ({ ...f, billing_day: e.target.value }))} placeholder="1" type="number" min="1" max="31" />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Payment Frequency</p>
                  <div className="flex gap-1.5">
                    {Object.entries(FREQ_LABELS).map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setEditForm(f => ({ ...f, payment_frequency: val }))}
                        className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${editForm.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
                  <StorageDateSelect value={editForm.move_in_date} onChange={value => setEditForm(f => ({ ...f, move_in_date: value }))} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                  <Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Access info, location…" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button className="flex-1" disabled={saving} onClick={handleSaveEdit}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {tenantName(rental) && <p className="font-medium">{tenantName(rental)}</p>}
                    {rental.tenant_phone && (
                      <a href={`tel:${rental.tenant_phone}`} className="flex items-center gap-1.5 text-sm text-primary">
                        <Phone size={13} />
                        {formatPhone(rental.tenant_phone)}
                      </a>
                    )}
                    {rental.customers?.payment_pin && (
                      <button onClick={() => setShowPin(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Payment PIN <span className="font-mono font-semibold text-foreground tracking-widest">{showPin ? rental.customers.payment_pin : '•••••'}</span>
                        {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    )}
                    {rental.customers?.has_payment_method && (
                      <div className="flex items-center gap-1.5 text-xs text-green-600">
                        <CheckCircle2 size={13} />
                        Card on file
                      </div>
                    )}
                    {rental.monthly_rate && <p className="text-sm text-muted-foreground">${rental.monthly_rate}/mo · billed the {ordinal(rental.billing_day)}</p>}
                    {rental.move_in_date && (
                      <p className="text-xs text-muted-foreground">
                        Tenant for {tenureSummary(rental.move_in_date)} · since {formatLocalDate(rental.move_in_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                    {effectivePaidThroughDate && (
                      <p className="text-xs text-green-600">
                        Paid through {formatLocalDate(effectivePaidThroughDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                    {rental.notes && <p className="text-xs text-muted-foreground mt-1">{rental.notes}</p>}
                  </div>
                  <button onClick={startEdit} className="p-2 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                    <Pencil size={15} />
                  </button>
                </div>
              </div>
            )}

            {!editing && (
              <>
                <button
                  onClick={() => { onClose(); navigate(`/storage/portable/${asset.id}/billing`) }}
                  className="w-full flex items-center justify-between bg-card border rounded-xl px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-left">Billing</p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const recent = history.filter(p => isPeriodLabel(p.period_label)).slice(0, 3).map(p => {
                          const [y, m] = p.period_label.split('-').map(Number)
                          return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
                        })
                        if (recent.length > 0) return recent.join(' · ')
                        if (effectivePaidThroughDate) return `Paid through ${formatLocalDate(effectivePaidThroughDate, { month: 'short', day: 'numeric' })}`
                        return behindCount > 0 ? `${behindCount} month${behindCount !== 1 ? 's' : ''} behind` : 'No paid months yet'
                      })()}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>

                {historyLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
                ) : periods.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      {behindCount > 0
                        ? <p className="text-sm font-medium text-destructive">{behindCount} month{behindCount !== 1 ? 's' : ''} behind</p>
                        : <p className="text-sm font-medium text-green-500">Paid up to date</p>
                      }
                      {behindCount > 1 && (
                        <Button size="sm" disabled={payingAll} onClick={() => handlePayAll(unpaidPeriods)}>
                          {payingAll ? 'Saving…' : 'Pay all'}
                        </Button>
                      )}
                    </div>
                    <div className="space-y-0">
                      {periods.map(period => {
                        const payment = history.find(p => p.period_label === period)
                        const amount = payment?.amount ?? periodChargeAmount(period, rental.billing_day, rental.move_in_date, rental.monthly_rate)
                        return (
                          <div key={period} className="flex items-center justify-between py-2.5 border-b last:border-0 text-sm">
                            <span className="text-muted-foreground">
                              {formatPeriod(period)}
                              {amount ? <span className="ml-2 text-xs">${parseFloat(amount).toFixed(2)}</span> : null}
                            </span>
                            {payment ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{new Date(payment.paid_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
                                <CheckCircle2 size={14} className="text-green-500" />
                                {latestPayment?.period_label === period && (
                                  <button onClick={() => setConfirmRemovePayment(true)} className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-1">
                                    remove
                                  </button>
                                )}
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleMarkOnePaid(period)}>Mark paid</Button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : rental.move_in_date ? (
                  <p className="text-sm text-muted-foreground">
                    No payment due yet · first billing {ordinal(rental.billing_day)} of {nextPaymentDate(rental.billing_day)?.toLocaleDateString('en-CA', { month: 'long' })}
                  </p>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border bg-card p-4">
                    <div>
                      <p className="text-sm font-medium">{currentPeriodLabel(rental.billing_day)} payment</p>
                      <p className="text-xs text-muted-foreground">{isPaid ? 'Marked as paid' : 'Not yet received'}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={isPaid ? 'secondary' : 'default'}
                      onClick={() => { isPaid ? setConfirmRemovePayment(true) : onTogglePaid() }}
                    >
                      {isPaid ? 'Remove latest' : 'Mark paid'}
                    </Button>
                  </div>
                )}

                {behindCount > 0 && rental.tenant_phone && (
                  <Button variant="outline" className="w-full gap-2" disabled={remindState !== 'idle'} onClick={() => handleSendReminder(behindCount)}>
                    <Send size={14} />
                    {remindState === 'sending' ? 'Sending…' : remindState === 'sent' ? 'Sent!' : 'Send reminder'}
                  </Button>
                )}

                {smsLog.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auto-reminders sent</p>
                    <div>
                      {smsLog.map(log => (
                        <div key={log.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <span className="text-sm text-muted-foreground">{formatLocalDate(log.sent_date, { month: 'short', day: 'numeric' })}</span>
                          <span className="text-xs text-muted-foreground">{log.days_overdue === 0 ? 'Due today' : `${log.days_overdue} day${log.days_overdue !== 1 ? 's' : ''} overdue`}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!confirmVacate ? (
                  <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirmVacate(true)}>
                    Remove Assignment
                  </Button>
                ) : (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                    <p className="text-sm font-medium">Remove assignment for {asset.label}?</p>
                    <p className="text-xs text-muted-foreground">This clears the customer and billing info. Payment history is kept.</p>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Type <span className="font-mono font-semibold text-foreground">{asset.label}</span> to confirm</p>
                      <Input value={vacateInput} onChange={e => setVacateInput(e.target.value)} placeholder={asset.label} autoFocus />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => { setConfirmVacate(false); setVacateInput('') }}>Cancel</Button>
                      <Button variant="destructive" className="flex-1" disabled={saving || vacateInput !== asset.label} onClick={handleVacate}>
                        {saving ? 'Saving…' : 'Confirm'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>

      <PinModal
        open={confirmSendInvite}
        onClose={() => !sendingInvite && setConfirmSendInvite(false)}
        onConfirm={handleSendInvite}
        loading={sendingInvite}
        title="Send card invite"
        subtitle="Enter billing PIN to send setup link"
        icon={Send}
        confirmLabel="Send invite"
      >
        <div className="rounded-xl border divide-y text-sm bg-muted/40">
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium text-right">{customer?.name}</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">SMS to</span>
            <span className="font-medium text-right">{formatPhone(customer?.phone)}</span>
          </div>
        </div>
      </PinModal>

      <PinModal
        open={confirmRemovePayment}
        onClose={() => !removingPayment && setConfirmRemovePayment(false)}
        onConfirm={handleRemoveLatestPayment}
        loading={removingPayment}
        title="Remove latest payment"
        subtitle="Enter billing PIN to step paid-through back one month"
        icon={X}
        iconBg="bg-destructive/10"
        iconColor="text-destructive"
        confirmLabel="Remove"
        confirmClassName="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
      >
        <div className="rounded-xl border divide-y text-sm bg-destructive/5">
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium text-right">{tenantName(rental)}</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">Storage</span>
            <span className="font-medium text-right">{asset?.label}</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">Latest month</span>
            <span className="font-medium text-right">{formatPeriod(latestPayment?.period_label)}</span>
          </div>
          {latestPayment?.amount && (
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium text-right">${parseFloat(latestPayment.amount).toFixed(2)}</span>
            </div>
          )}
        </div>
      </PinModal>
    </Sheet>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Storage() {
  const [query, setQuery]                   = useState('')
  const [units, setUnits]                   = useState([])
  const [paidIds, setPaidIds]               = useState(new Set())
  const [customerStorageItems, setCustomerStorageItems] = useState([])
  const [customerStoragePaidIds, setCustomerStoragePaidIds] = useState(new Set())
  const [showAddCustomerStorage, setShowAddCustomerStorage] = useState(false)
  const [selected, setSelected]             = useState(null)
  const [portableAssets, setPortableAssets] = useState([])
  const [rentals, setRentals]               = useState({})
  const [portablePaidIds, setPortablePaidIds] = useState(new Set())
  const [deployedIds, setDeployedIds]       = useState(new Set())
  const [selectedPortable, setSelectedPortable] = useState(null)
  const [loading, setLoading]               = useState(true)
  const [filter, setFilter]                 = useState('all')
  const [sort, setSort]                     = useState('status')

  const fetchAll = useCallback(async () => {
    const cutoff = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 7)
    })()

    const [
      { data: unitData },
      { data: tenancyData },
      { data: customerStorageData },
      { data: paymentData },
      { data: assetData },
      { data: rentalData },
      { data: portablePaymentData },
      { data: deploymentData },
    ] = await Promise.all([
      supabase.from('storage_units').select('*').order('unit_number'),
      supabase.from('storage_tenancies').select('*, customers(name, payment_pin, has_payment_method)').eq('storage_kind', 'fixed_unit').is('end_date', null),
      supabase.from('storage_tenancies').select('*, customers(name, payment_pin, has_payment_method, stripe_customer_id)').eq('storage_kind', 'customer_item').is('end_date', null).order('item_label'),
      supabase.from('storage_payments').select('tenancy_id, period_label').gte('period_label', cutoff),
      supabase.from('assets').select('*, asset_types(name, is_storage)').eq('archived', false).order('label'),
      supabase.from('portable_storage_rentals').select('*, customers(name, payment_pin, has_payment_method, stripe_customer_id)'),
      supabase.from('portable_storage_payments').select('asset_id, period_label').gte('period_label', cutoff),
      supabase.from('active_deployments').select('asset_id'),
    ])

    if (unitData && tenancyData) {
      const tenancyByUnit = {}
      tenancyData.forEach(t => { tenancyByUnit[t.unit_id] = t })

      const merged = unitData.map(u => {
        const t = tenancyByUnit[u.id]
        return {
          id:               u.id,
          unit_number:      u.unit_number,
          created_at:       u.created_at,
          unit_notes:        u.notes         || null,
          tenancy_id:       t?.id            || null,
          customer_id:      t?.customer_id   || null,
          tenant_name:      t?.tenant_name   || null,
          tenant_phone:     t?.tenant_phone  || null,
          monthly_rate:     t?.monthly_rate  || null,
          billing_day:      t?.billing_day   || null,
          payment_frequency: t?.payment_frequency || null,
          move_in_date:     t?.move_in_date  || null,
          paid_through_date: t?.paid_through_date || null,
          notes:            t?.notes         || null,
          customers:        t?.customers     || null,
        }
      })
      setUnits(merged)

      const tenancyToUnit = {}
      merged.forEach(u => { if (u.tenancy_id) tenancyToUnit[u.tenancy_id] = u })

      const paid = new Set(
        merged
          .filter(u => u.tenancy_id && isPaidThroughToday(u.paid_through_date))
          .map(u => u.id)
      )

      paymentData
        ?.filter(p => {
          const u = tenancyToUnit[p.tenancy_id]
          return u && p.period_label === currentPeriodLabel(u.billing_day)
        })
        .map(p => tenancyToUnit[p.tenancy_id]?.id)
        .filter(Boolean)
        .forEach(id => paid.add(id))
      setPaidIds(paid)
    }

    if (customerStorageData) {
      const items = customerStorageData.map(t => ({
        id: t.id,
        tenancy_id: t.id,
        storage_kind: t.storage_kind,
        item_type: t.item_type,
        custom_item_type: t.custom_item_type,
        item_label: t.item_label,
        customer_id: t.customer_id || null,
        tenant_name: t.tenant_name || null,
        tenant_phone: t.tenant_phone || null,
        monthly_rate: t.monthly_rate || null,
        billing_day: t.billing_day || null,
        payment_frequency: t.payment_frequency || null,
        move_in_date: t.move_in_date || null,
        paid_through_date: t.paid_through_date || null,
        notes: t.notes || null,
        customers: t.customers || null,
      }))
      setCustomerStorageItems(items)

      const itemByTenancy = {}
      items.forEach(item => { itemByTenancy[item.tenancy_id] = item })

      const paid = new Set(
        items
          .filter(item => isPaidThroughToday(item.paid_through_date))
          .map(item => item.id)
      )

      paymentData
        ?.filter(payment => {
          const item = itemByTenancy[payment.tenancy_id]
          return item && payment.period_label === currentPeriodLabel(item.billing_day)
        })
        .map(payment => itemByTenancy[payment.tenancy_id]?.id)
        .filter(Boolean)
        .forEach(id => paid.add(id))
      setCustomerStoragePaidIds(paid)
    }

    if (assetData) {
      setPortableAssets(assetData.filter(a => a.asset_types?.is_storage))
    }

    if (deploymentData) {
      setDeployedIds(new Set(deploymentData.map(d => d.asset_id)))
    }

    if (rentalData) {
      const map = {}
      rentalData.forEach(r => { map[r.asset_id] = r })
      setRentals(map)

      const paid = new Set(
        rentalData
          .filter(r => isPaidThroughToday(r.paid_through_date))
          .map(r => r.asset_id)
      )
      portablePaymentData
        ?.filter(p => {
          const rental = rentalData.find(r => r.asset_id === p.asset_id)
          return p.period_label === currentPeriodLabel(rental?.billing_day)
        })
        .map(p => p.asset_id)
        .forEach(id => paid.add(id))
      setPortablePaidIds(paid)
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['storage_units', 'storage_tenancies', 'storage_payments', 'assets', 'asset_types', 'deployments', 'portable_storage_rentals', 'portable_storage_payments'], fetchAll)

  const q = query.trim().toLowerCase()
  const match = (...fields) => fields.some(f => f?.toLowerCase().includes(q))

  const filteredUnits = units
    .filter(u => {
      if (q && !match(u.unit_number, tenantName(u), u.tenant_phone)) return false
      if (filter === 'all') return true
      if (!tenantName(u)) return false
      return filter === 'paid' ? paidIds.has(u.id) : !paidIds.has(u.id)
    })
    .sort((a, b) => {
      if (sort === 'alpha') return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true })
      if (!tenantName(a) && tenantName(b)) return 1
      if (tenantName(a) && !tenantName(b)) return -1
      const sa = paymentStatus(a.billing_day, a.payment_frequency, paidIds.has(a.id), a.move_in_date, a.paid_through_date)
      const sb = paymentStatus(b.billing_day, b.payment_frequency, paidIds.has(b.id), b.move_in_date, b.paid_through_date)
      return (STATUS_ORDER[sa] ?? 4) - (STATUS_ORDER[sb] ?? 4)
    })

  const filteredCustomerStorage = customerStorageItems
    .filter(item => {
      if (q && !match(customerStorageLabel(item), customerStorageTypeLabel(item), tenantName(item), item.tenant_phone, item.notes)) return false
      if (filter === 'all') return true
      return filter === 'paid' ? customerStoragePaidIds.has(item.id) : !customerStoragePaidIds.has(item.id)
    })
    .sort((a, b) => {
      if (sort === 'alpha') return customerStorageLabel(a).localeCompare(customerStorageLabel(b), undefined, { numeric: true })
      const sa = paymentStatus(a.billing_day, a.payment_frequency, customerStoragePaidIds.has(a.id), a.move_in_date, a.paid_through_date)
      const sb = paymentStatus(b.billing_day, b.payment_frequency, customerStoragePaidIds.has(b.id), b.move_in_date, b.paid_through_date)
      return (STATUS_ORDER[sa] ?? 4) - (STATUS_ORDER[sb] ?? 4)
    })

  const filteredPortable = portableAssets
    .filter(a => {
      const rental = rentals[a.id]
      if (q && !match(a.label, a.size, rental?.tenant_name, rental?.tenant_phone)) return false
      if (filter === 'all') return true
      if (!rental?.tenant_name) return false
      return filter === 'paid' ? portablePaidIds.has(a.id) : !portablePaidIds.has(a.id)
    })
    .sort((a, b) => {
      if (sort === 'alpha') return a.label.localeCompare(b.label, undefined, { numeric: true })
      const ra = rentals[a.id]; const rb = rentals[b.id]
      if (!ra?.tenant_name && rb?.tenant_name) return 1
      if (ra?.tenant_name && !rb?.tenant_name) return -1
      const sa = ra ? paymentStatus(ra.billing_day, ra.payment_frequency, portablePaidIds.has(a.id), ra.move_in_date, ra.paid_through_date) : 'unpaid'
      const sb = rb ? paymentStatus(rb.billing_day, rb.payment_frequency, portablePaidIds.has(b.id), rb.move_in_date, rb.paid_through_date) : 'unpaid'
      return (STATUS_ORDER[sa] ?? 4) - (STATUS_ORDER[sb] ?? 4)
    })

  async function handleTogglePortablePaid() {
    const id = selectedPortable.id
    const rental = rentals[id]
    const period = currentPeriodLabel(rental?.billing_day)
    const marking = !portablePaidIds.has(id)
    if (!marking) return

    await supabase.from('portable_storage_payments').upsert(
      {
        asset_id: id,
        period_label: period,
        ...paymentAmountsFromSubtotal(periodChargeAmount(period, rental?.billing_day, rental?.move_in_date, rental?.monthly_rate)),
      },
      { onConflict: 'asset_id,period_label' }
    )
    const paidThroughDate = paidThroughFromPayments([{ period_label: period }], rental?.billing_day, rental?.paid_through_date)
    if (paidThroughDate) {
      await supabase.from('portable_storage_rentals').update({ paid_through_date: paidThroughDate }).eq('asset_id', id)
    }
    setPortablePaidIds(prev => new Set([...prev, id]))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Storage</h1>
        <StorageViewMenu current="list" />
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input type="search" placeholder="Search units…" value={query} onChange={e => setQuery(e.target.value)}
            className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center gap-2">
        <div className="flex gap-1.5 flex-1">
          {[['all', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setSort(s => s === 'status' ? 'alpha' : 'status')}
          className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors ${sort === 'alpha' ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
          <ArrowUpDown size={11} />
          {sort === 'alpha' ? 'A–Z' : 'Status'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
        {loading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

        {!loading && (
          <>
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Fixed Units ({filteredUnits.length})
              </h2>
              <div className="space-y-2">
                {filteredUnits.map(u => (
                  <FixedUnitCard key={u.id} unit={u} isPaid={paidIds.has(u.id)} onTap={setSelected} />
                ))}
                {units.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center mt-4">No fixed units yet — add them in Asset Manager</p>
                )}
                {q && filteredUnits.length === 0 && units.length > 0 && (
                  <p className="text-muted-foreground text-sm text-center mt-4">No units match "{query}"</p>
                )}
              </div>
            </div>

            {portableAssets.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Portable Units ({filteredPortable.length})
                </h2>
                <div className="space-y-2">
                  {filteredPortable.map(a => (
                    <PortableUnitCard key={a.id} asset={a} rental={rentals[a.id]} isPaid={portablePaidIds.has(a.id)} isDeployed={deployedIds.has(a.id)} onTap={setSelectedPortable} />
                  ))}
                  {q && filteredPortable.length === 0 && (
                    <p className="text-muted-foreground text-sm text-center mt-4">No portable units match "{query}"</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Customer Storage ({filteredCustomerStorage.length})
                </h2>
                <Button size="sm" variant="outline" onClick={() => setShowAddCustomerStorage(true)}>
                  <Plus size={14} />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {filteredCustomerStorage.map(item => (
                  <CustomerStorageCard
                    key={item.id}
                    item={item}
                    isPaid={customerStoragePaidIds.has(item.id)}
                    onTap={setSelected}
                  />
                ))}
                {customerStorageItems.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center mt-4">No boats, trailers, or RVs yet</p>
                )}
                {q && filteredCustomerStorage.length === 0 && customerStorageItems.length > 0 && (
                  <p className="text-muted-foreground text-sm text-center mt-4">No customer storage matches "{query}"</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <StorageSheet
        item={selected}
        isPaid={selected ? (selected.storage_kind === 'customer_item' ? customerStoragePaidIds.has(selected.id) : paidIds.has(selected.id)) : false}
        onClose={() => setSelected(null)}
        onTogglePaid={() => {}}
        onAssigned={fetchAll}
      />

      <AddCustomerStorageSheet
        open={showAddCustomerStorage}
        onOpenChange={setShowAddCustomerStorage}
        onSaved={fetchAll}
      />

      <PortableStorageSheet
        asset={selectedPortable}
        rental={selectedPortable ? rentals[selectedPortable.id] : null}
        isPaid={selectedPortable ? portablePaidIds.has(selectedPortable.id) : false}
        onClose={() => setSelectedPortable(null)}
        onTogglePaid={handleTogglePortablePaid}
        onAssigned={fetchAll}
      />
    </div>
  )
}
