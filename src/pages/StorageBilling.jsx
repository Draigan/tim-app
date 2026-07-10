import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CreditCard, Banknote, CheckCircle2, Plus, X, AlertCircle, Clock, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { cn } from '@/lib/utils'
import { newBillingRequestId } from '@/lib/billingApproval'

// ─── helpers ──────────────────────────────────────────────────────────────────

function lastDayOf(year, month0) {
  return new Date(year, month0 + 1, 0).getDate()
}

const DAY_MS = 86400000
const cents = value => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const dollars = value => Number((value / 100).toFixed(2))
const SALES_TAX_RATE = 0.13
const SALES_TAX_LABEL = 'HST'
const LATE_FEE_RATE = 0.20
const LATE_FEE_DAY = 6
const CUSTOMER_STORAGE_TYPE_LABELS = {
  boat: 'Boat',
  trailer: 'Trailer',
  rv: 'RV',
  custom: 'Custom',
}

function customerStorageTypeLabel(item) {
  if (item?.item_type === 'custom') return item.custom_item_type || 'Custom'
  return CUSTOMER_STORAGE_TYPE_LABELS[item?.item_type] ?? 'Storage'
}

function customerStorageLabel(item) {
  const type = customerStorageTypeLabel(item)
  return item?.item_label ? `${type} · ${item.item_label}` : type
}

function taxCentsForSubtotal(subtotalCents) {
  return Math.round(subtotalCents * SALES_TAX_RATE)
}

function paymentBreakdownFromSubtotal(subtotal, collectTax) {
  const subtotalCents = cents(subtotal)
  const taxCents = collectTax ? taxCentsForSubtotal(subtotalCents) : 0
  return {
    subtotal: dollars(subtotalCents),
    tax: dollars(taxCents),
    amount: dollars(subtotalCents + taxCents),
    tax_rate: collectTax && taxCents > 0 ? SALES_TAX_RATE : 0,
    tax_label: collectTax && taxCents > 0 ? SALES_TAX_LABEL : null,
  }
}

function taxableBreakdownFromSubtotal(subtotal) {
  return paymentBreakdownFromSubtotal(subtotal, true)
}

function taxAmountForSubtotal(subtotal) {
  return taxableBreakdownFromSubtotal(subtotal).tax
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

function periodLabelForDate(date, billingDay) {
  if (!date || !billingDay) return null
  const effective = Math.min(billingDay, lastDayOf(date.getFullYear(), date.getMonth()))
  if (date.getDate() >= effective) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
  }
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`
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

function effectiveDueDateForPeriod(label, billingDay, moveInDate) {
  const dueDate = periodDueDate(label, billingDay)
  if (!dueDate) return null
  const moveIn = parseLocalDate(moveInDate)
  const periodEnd = paidThroughForPeriod(label, billingDay)
  if (moveIn && periodEnd && periodEnd < moveIn) return null
  if (moveIn && dueDate < moveIn && (!periodEnd || moveIn <= periodEnd)) return moveIn
  return dueDate
}

function lateFeeDateForPeriod(label, billingDay, moveInDate) {
  const dueDate = effectiveDueDateForPeriod(label, billingDay, moveInDate)
  if (!dueDate || !isPeriodLabel(label)) return null
  const [y, m] = label.split('-').map(Number)
  const sixth = new Date(y, m - 1, LATE_FEE_DAY)
  return dueDate > sixth ? addDays(dueDate, 5) : sixth
}

function lateFeeAmountForPeriod(label, billingDay, moveInDate, monthlyRate) {
  return dollars(Math.round(periodChargeCents(label, billingDay, moveInDate, monthlyRate) * LATE_FEE_RATE))
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
  return paidThrough >= parseLocalDate(dateStr(new Date()))
}

function periodCovered(period, billingDay, paidSet, paidThroughDate) {
  if (paidSet.has(period)) return true
  const paidThrough = parseLocalDate(paidThroughDate)
  if (!paidThrough) return false
  const periodPaidThrough = paidThroughForPeriod(period, billingDay)
  if (periodPaidThrough && paidThrough >= periodPaidThrough) return true
  return period === currentPeriodLabel(billingDay) && isPaidThroughToday(paidThroughDate)
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

function formatPeriod(label) {
  if (!isPeriodLabel(label)) return label || 'Unknown period'
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
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

function paidMonthLabel(period, billingDay) {
  if (!isPeriodLabel(period)) return 'Paid'
  return period > currentPeriodLabel(billingDay) ? 'Prepaid' : 'Paid'
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatusHero({ behindCount, overdueCount, monthlyRate, outstandingTotal, history, billingDay, paidThroughDate }) {
  const lastPaid = history.find(p => isPeriodLabel(p.period_label)) ?? history[0]

  if (isPaidThroughToday(paidThroughDate) || (behindCount === 0 && history.length > 0)) {
    return (
      <div className="rounded-2xl bg-green-500/10 border border-green-500/20 px-4 py-4 flex items-center gap-3">
        <CheckCircle2 size={28} className="text-green-500 flex-shrink-0" />
        <div>
          <p className="font-semibold text-green-600">Paid up to date</p>
          {paidThroughDate ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Paid through {formatLocalDate(paidThroughDate, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          ) : lastPaid && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last paid month · {formatPeriod(lastPaid.period_label)}
              {lastPaid.amount ? ` · $${parseFloat(lastPaid.amount).toFixed(2)}` : ''}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (behindCount > 0) {
    const outstanding = outstandingTotal ?? behindCount * (monthlyRate || 0)
    const isOverdue = overdueCount > 0
    return (
      <div className={cn('rounded-2xl border px-4 py-4 flex items-center gap-3', isOverdue ? 'bg-destructive/10 border-destructive/20' : 'bg-amber-500/10 border-amber-500/20')}>
        {isOverdue
          ? <AlertCircle size={28} className="text-destructive flex-shrink-0" />
          : <Clock size={28} className="text-amber-500 flex-shrink-0" />
        }
        <div>
          <p className={cn('font-semibold', isOverdue ? 'text-destructive' : 'text-amber-600')}>
            {isOverdue
              ? `${behindCount} month${behindCount !== 1 ? 's' : ''} overdue`
              : behindCount === 1 ? 'Payment due' : `${behindCount} payments due`
            }
          </p>
          {outstanding > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">${outstanding.toFixed(2)} outstanding</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-4 flex items-center gap-3">
      <Clock size={28} className="text-amber-500 flex-shrink-0" />
      <div>
        <p className="font-semibold text-amber-600">
          {billingDay ? `Due ${ordinal(billingDay)} of each month` : 'No billing set'}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">No paid months recorded yet</p>
      </div>
    </div>
  )
}

// ─── PIN modal ────────────────────────────────────────────────────────────────

const PIN_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
]
const PIN_LENGTH = 4

function PinModal({ open, onClose, onConfirm, charging, actionType, details }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const isCash = actionType === 'cash'
  const isCard = actionType === 'card'
  const isRemove = actionType === 'remove'

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setPin('')
      setError('')
    })
  }, [open])

  const handleConfirm = useCallback(async () => {
    if (charging || pin.length !== PIN_LENGTH) return
    setError('')
    const result = await onConfirm(pin)
    if (result?.error) {
      setError(result.error)
      setPin('')
    }
  }, [charging, onConfirm, pin])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event) {
      if (charging) return

      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        setError('')
        setPin(current => current.length >= PIN_LENGTH ? current : current + event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        setError('')
        setPin(current => current.slice(0, -1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handleConfirm()
      } else if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [charging, handleConfirm, onClose, open])

  if (!open) return null

  const { tenantName, unitNumber, periods = [], monthlyRate, extras = [], taxTotal = 0, grandTotal = 0 } = details

  function tap(key) {
    setError('')
    if (key === 'del') {
      setPin(current => current.slice(0, -1))
      return
    }
    setPin(current => current.length >= PIN_LENGTH ? current : current + key)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-background rounded-t-2xl shadow-xl pb-safe"
        onClick={e => e.stopPropagation()}
      >
        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        <div className="px-5 pt-3 pb-6 space-y-5">

          {/* Payment type header */}
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0',
              isCard ? 'bg-green-500/15' : isRemove ? 'bg-destructive/10' : 'bg-primary/10'
            )}>
              {isCash
                ? <Banknote size={22} className="text-primary" />
                : isRemove
                  ? <X size={22} className="text-destructive" />
                  : <CreditCard size={22} className="text-green-600" />
              }
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">
                {isCash ? 'Record cash payment' : isRemove ? 'Remove latest payment' : 'Charge card'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isCash
                  ? 'Cash or cheque · enter PIN to confirm'
                  : isRemove
                    ? 'Steps paid-through back by one month'
                    : 'Card on file · enter PIN to confirm'}
              </p>
            </div>
          </div>

          {/* Charge summary */}
          <div>
            <div className={cn('rounded-xl border divide-y text-sm', isCard ? 'bg-green-500/5' : isRemove ? 'bg-destructive/5' : 'bg-muted/40')}>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Tenant</span>
                <span className="font-medium">{tenantName || 'Unknown'}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Unit</span>
                <span className="font-medium">{unitNumber}</span>
              </div>
              {periods.map(({ label, amount, subtotal, lateFeeAmount }) => (
                <div key={label} className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">
                    {formatPeriod(label)}
                    {lateFeeAmount > 0 ? ' + late fee' : ''}
                  </span>
                  <span>${parseFloat(subtotal ?? amount ?? monthlyRate ?? 0).toFixed(2)}</span>
                </div>
              ))}
              {extras.map(e => parseFloat(e.amount) > 0 && (
                <div key={e.id} className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground truncate max-w-[60%]">{e.label || 'Extra'}</span>
                  <span>${parseFloat(e.amount).toFixed(2)}</span>
                </div>
              ))}
              {taxTotal > 0 && (
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">{SALES_TAX_LABEL} 13%</span>
                  <span>${taxTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2.5 font-semibold">
                <span>Total</span>
                <span>${grandTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* PIN dots */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-xs text-muted-foreground mb-2">Enter billing PIN</p>
            <div className="flex gap-3.5">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-3 h-3 rounded-full transition-all duration-100',
                    i < pin.length
                      ? isCard ? 'bg-green-500 scale-110' : isRemove ? 'bg-destructive scale-110' : 'bg-primary scale-110'
                      : 'bg-muted-foreground/25'
                  )}
                />
              ))}
            </div>
            {error && <p className="text-xs text-destructive mt-2 text-center">{error}</p>}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2">
            {PIN_KEYS.flat().map((key, i) => {
              if (!key) return <div key={i} />
              return (
                <button
                  key={i}
                  type="button"
                  onPointerDown={e => { e.preventDefault(); tap(key) }}
                  className={cn(
                    'h-14 rounded-xl text-lg font-medium transition-colors active:scale-95',
                    key === 'del'
                      ? 'text-muted-foreground hover:bg-muted active:bg-muted/70'
                      : 'bg-muted hover:bg-muted/70 active:bg-muted/50'
                  )}
                >
                  {key === 'del' ? '⌫' : key}
                </button>
              )
            })}
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={charging}>
              Cancel
            </Button>
            <Button
              className={cn(
                'flex-1 gap-2',
                isCard && 'bg-green-600 hover:bg-green-700 text-white',
                isRemove && 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
              )}
              disabled={pin.length !== PIN_LENGTH || charging}
              onClick={handleConfirm}
            >
              {charging
                ? <><Loader2 size={14} className="animate-spin" /> {isCash ? 'Saving…' : isRemove ? 'Removing…' : 'Charging…'}</>
                : isCash ? <><Banknote size={14} /> Mark paid</> : isRemove ? <><X size={14} /> Remove</> : <><CreditCard size={14} /> Charge card</>
              }
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── charge success receipt ───────────────────────────────────────────────────

function ChargeSuccessView({ result, onDone }) {
  const { tenantName, unitNumber, periods, monthlyRate, extras, taxTotal = 0, grandTotal, paidThrough, paymentMethod } = result
  const isCash = paymentMethod === 'cash'

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="flex flex-col items-center py-4">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
          <CheckCircle2 size={34} className="text-green-500" />
        </div>
        <p className="text-xl font-bold">Payment recorded</p>
        <p className="text-sm text-muted-foreground mt-1">
          ${grandTotal.toFixed(2)} {isCash ? 'recorded as cash' : 'charged to card on file'}
        </p>
      </div>

      {/* Receipt */}
      <div className="rounded-xl border overflow-hidden text-sm">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receipt</p>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {isCash ? <><Banknote size={12} /> Cash</> : <><CreditCard size={12} /> Card</>}
          </span>
        </div>
        <div className="divide-y">
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Tenant</span>
            <span className="font-medium">{tenantName || 'Unknown'}</span>
          </div>
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Unit</span>
            <span className="font-medium">{unitNumber}</span>
          </div>
          {periods.map(period => (
            <div key={period.label ?? period} className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">
                {formatPeriod(period.label ?? period)}
                {period.lateFeeAmount > 0 ? ' + late fee' : ''}
              </span>
              <span className="text-green-600">${parseFloat(period.subtotal ?? period.amount ?? monthlyRate ?? 0).toFixed(2)}</span>
            </div>
          ))}
          {extras.map(e => parseFloat(e.amount) > 0 && (
            <div key={e.id} className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground truncate max-w-[60%]">{e.label || 'Extra'}</span>
              <span className="text-green-600">${parseFloat(e.amount).toFixed(2)}</span>
            </div>
          ))}
          {taxTotal > 0 && (
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">{SALES_TAX_LABEL} 13%</span>
              <span className="text-green-600">${taxTotal.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-2.5 font-semibold">
            <span>{isCash ? 'Total received' : 'Total charged'}</span>
            <span className="text-green-600">${grandTotal.toFixed(2)}</span>
          </div>
          {paidThrough && (
            <div className="flex justify-between px-4 py-2.5 bg-green-500/5">
              <span className="text-muted-foreground">Paid through</span>
              <span className="font-medium text-green-700">
                {formatLocalDate(paidThrough, { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}
        </div>
      </div>

      <Button className="w-full" onClick={onDone}>Done</Button>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function StorageBilling() {
  const { unitId, assetId, tenancyId } = useParams()
  const navigate   = useNavigate()
  const isPortable = !!assetId
  const isCustomerItem = !!tenancyId

  const [unit, setUnit]           = useState(null)
  const [tenancy, setTenancy]     = useState(null)
  const [history, setHistory]     = useState([])
  const [lateFees, setLateFees]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('history')
  const [chargeMonths, setChargeMonths] = useState(1)
  const [extras, setExtras]       = useState([])
  const [cashCollectTax, setCashCollectTax] = useState(false)
  const [charging, setCharging]   = useState(false)
  const [lateFeeSaving, setLateFeeSaving] = useState('')
  const [lateFeeError, setLateFeeError] = useState('')
  const [chargeError, setChargeError] = useState('')
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState('card')
  const [chargeSuccess, setChargeSuccess] = useState(null)

  const fetchUnit = useCallback(async () => {
    setLoading(true)

    if (isPortable) {
      const [{ data: a }, { data: r }] = await Promise.all([
        supabase.from('assets').select('id, label, size').eq('id', assetId).single(),
        supabase.from('portable_storage_rentals')
          .select('*, customers(name, has_payment_method, stripe_customer_id)')
          .eq('asset_id', assetId)
          .maybeSingle(),
      ])

      if (a) setUnit({ id: a.id, unit_number: a.label, size: a.size })
      if (r) {
        setTenancy(r)

        const [{ data: payments }, { data: fees }] = await Promise.all([
          supabase
            .from('portable_storage_payments')
            .select('*')
            .eq('asset_id', assetId)
            .order('period_label', { ascending: false }),
          supabase
            .from('storage_late_fees')
            .select('*')
            .eq('portable_rental_id', r.id)
            .order('period_label', { ascending: false }),
        ])
        if (payments) setHistory(sortPaymentsByPeriod(payments))
        if (fees) setLateFees(fees)
      } else {
        setTenancy(null)
        setHistory([])
        setLateFees([])
      }
    } else if (isCustomerItem) {
      const { data: t } = await supabase
        .from('storage_tenancies')
        .select('*, customers(name, has_payment_method, stripe_customer_id)')
        .eq('id', tenancyId)
        .eq('storage_kind', 'customer_item')
        .is('end_date', null)
        .maybeSingle()

      if (t) {
        setUnit({
          id: t.id,
          unit_number: t.item_label,
          item_type: t.item_type,
          custom_item_type: t.custom_item_type,
          item_label: t.item_label,
        })
        setTenancy(t)

        const [{ data: payments }, { data: fees }] = await Promise.all([
          supabase
            .from('storage_payments')
            .select('*')
            .eq('tenancy_id', t.id)
            .order('period_label', { ascending: false }),
          supabase
            .from('storage_late_fees')
            .select('*')
            .eq('tenancy_id', t.id)
            .order('period_label', { ascending: false }),
        ])
        if (payments) setHistory(sortPaymentsByPeriod(payments))
        if (fees) setLateFees(fees)
      } else {
        setUnit(null)
        setTenancy(null)
        setHistory([])
        setLateFees([])
      }
    } else {
      const [{ data: u }, { data: t }] = await Promise.all([
        supabase.from('storage_units').select('id, unit_number').eq('id', unitId).single(),
        supabase.from('storage_tenancies')
          .select('*, customers(name, has_payment_method, stripe_customer_id)')
          .eq('unit_id', unitId)
          .eq('storage_kind', 'fixed_unit')
          .is('end_date', null)
          .maybeSingle(),
      ])

      if (u) setUnit(u)
      if (t) {
        setTenancy(t)

        const [{ data: payments }, { data: fees }] = await Promise.all([
          supabase
            .from('storage_payments')
            .select('*')
            .eq('tenancy_id', t.id)
            .order('period_label', { ascending: false }),
          supabase
            .from('storage_late_fees')
            .select('*')
            .eq('tenancy_id', t.id)
            .order('period_label', { ascending: false }),
        ])
        if (payments) setHistory(sortPaymentsByPeriod(payments))
        if (fees) setLateFees(fees)
      } else {
        setTenancy(null)
        setHistory([])
        setLateFees([])
      }
    }

    setLoading(false)
  }, [assetId, isCustomerItem, isPortable, tenancyId, unitId])

  useEffect(() => { queueMicrotask(fetchUnit) }, [fetchUnit])
  useRealtime(
    isPortable ? ['portable_storage_payments', 'portable_storage_rentals', 'storage_late_fees'] : ['storage_payments', 'storage_tenancies', 'storage_late_fees'],
    fetchUnit
  )

  if (loading || !unit) return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={() => navigate('/storage')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
      </div>
    </div>
  )

  if (!tenancy) return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
        <button onClick={() => navigate('/storage')} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-semibold">
          {isPortable ? unit.unit_number : isCustomerItem ? customerStorageLabel(unit) : `Unit ${unit.unit_number}`}
        </h1>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{isPortable ? 'No active rental' : isCustomerItem ? 'No active storage' : 'No active tenant'}</p>
      </div>
    </div>
  )

  const hasCard       = !!tenancy.customers?.has_payment_method
  const periods       = generatePeriods(tenancy.billing_day, tenancy.move_in_date)
  const paidSet       = new Set(history.map(p => p.period_label).filter(isPeriodLabel))
  const paidThroughDate = paidThroughFromPayments(history, tenancy.billing_day, tenancy.paid_through_date)
  const unpaidPeriods = periods.filter(p => !periodCovered(p, tenancy.billing_day, paidSet, paidThroughDate))
  const openLateFeesByPeriod = new Map(
    lateFees
      .filter(fee => fee.status === 'open')
      .map(fee => [fee.period_label, fee])
  )
  const outstandingTotal = unpaidPeriods.reduce(
    (sum, period) => sum
      + periodChargeAmount(period, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
      + (Number(openLateFeesByPeriod.get(period)?.amount) || 0),
    0,
  )
  const today = parseLocalDate(dateStr(new Date()))
  const overdueCount = unpaidPeriods.filter(period => {
    const dueDate = effectiveDueDateForPeriod(period, tenancy.billing_day, tenancy.move_in_date)
    return dueDate && today && dueDate < today
  }).length
  const behindCount   = unpaidPeriods.length
  const tenantName    = tenancy.customers?.name || tenancy.tenant_name
  const displayName   = isPortable
    ? `${unit.unit_number}${unit.size ? ` · ${unit.size}` : ''}`
    : isCustomerItem ? customerStorageLabel(tenancy) : `Unit ${unit.unit_number}`
  const latestPayment = history.find(payment => isPeriodLabel(payment.period_label))

  function mergeHistoryPayments(payments, periodLabels) {
    const labels = periodLabels ?? payments.map(p => p.period_label)
    setHistory(prev => sortPaymentsByPeriod([...payments, ...prev.filter(p => !labels.includes(p.period_label))]))
  }

  function markLateFeesPaidInState(periodLabels) {
    const paidLabels = new Set(periodLabels)
    const resolvedAt = new Date().toISOString()
    setLateFees(current => current.map(fee => (
      paidLabels.has(fee.period_label) && fee.status === 'open'
        ? { ...fee, status: 'paid', resolved_at: resolvedAt }
        : fee
    )))
  }

  async function extendCurrentPaidThrough(periods, currentPaidThroughDate = paidThroughDate) {
    const nextPaidThroughDate = paidThroughFromPayments(
      periods.map(period_label => ({ period_label })),
      tenancy.billing_day,
      currentPaidThroughDate
    )
    if (!nextPaidThroughDate) return null

    const table = isPortable ? 'portable_storage_rentals' : 'storage_tenancies'
    const column = isPortable ? 'asset_id' : 'id'
    const id = isPortable ? assetId : tenancy.id
    await supabase.from(table).update({ paid_through_date: nextPaidThroughDate }).eq(column, id)
    return nextPaidThroughDate
  }

  function previewForPeriod(label) {
    const baseSubtotal = periodChargeAmount(label, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
    const lateFeeAmount = Number(openLateFeesByPeriod.get(label)?.amount) || 0
    return {
      label,
      baseSubtotal,
      lateFeeAmount,
      ...taxableBreakdownFromSubtotal(baseSubtotal + lateFeeAmount),
      alreadyPaid: false,
    }
  }

  function chargePeriods(months) {
    if (months === 0) return []
    const start = currentPeriodLabel(tenancy.billing_day)
    const [y, m] = start.split('-').map(Number)
    const labels = []
    for (let offset = 0; labels.length < months && offset < 120; offset++) {
      const d = new Date(y, m - 1 + offset, 1)
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const amount = periodChargeAmount(label, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
      if (!periodCovered(label, tenancy.billing_day, paidSet, paidThroughDate) && amount > 0) labels.push(label)
    }
    return labels.map(previewForPeriod)
  }

  const chargePreview = chargePeriods(chargeMonths)
  const previewByLabel = new Map(chargePreview.map(period => [period.label, period]))

  function paymentAmountsForPeriod(period, collectTax = true) {
    const preview = previewByLabel.get(period)
    const subtotal = preview?.subtotal ?? periodChargeAmount(period, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
    const breakdown = paymentBreakdownFromSubtotal(subtotal, collectTax)
    return {
      amount: breakdown.amount,
      subtotal_amount: breakdown.subtotal,
      tax_amount: breakdown.tax,
      tax_rate: breakdown.tax_rate,
      tax_label: breakdown.tax_label,
    }
  }

  async function handleMarkPaidCharge(pin) {
    const snapshot = {
      tenantName,
      unitNumber: displayName,
      periods: chargePreview,
      monthlyRate: tenancy.monthly_rate || 0,
      extras: extras.filter(e => parseFloat(e.amount) > 0),
      extrasTotal,
      taxTotal: cashTaxTotal,
      grandTotal: cashGrandTotal,
      paymentMethod: 'cash',
    }
    const toMark = chargePreview.filter(p => !p.alreadyPaid).map(p => p.label)
    if (!toMark.length) return { error: 'No unpaid months selected.' }
    setCharging(true)
    setChargeError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before recording this payment.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_cash_payment',
          ...(isPortable ? { portable_asset_id: assetId } : isCustomerItem ? { tenancy_id: tenancy.id } : { cash_unit_id: unitId }),
          periods: toMark,
          collect_tax: cashCollectTax,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { error: data.error || 'Could not record payment.' }
      if (data.status === 'skipped') {
        return { error: data.reason === 'already_paid' ? 'Payment is already recorded.' : `Payment skipped: ${data.reason || 'unknown reason'}.` }
      }

      const paidPeriods = data.periods ?? toMark
      const payments = data.payments?.length ? data.payments : paidPeriods.map(period => ({
        id: `${tenancy.id}-${period}`,
        ...(isPortable ? { asset_id: assetId } : { tenancy_id: tenancy.id }),
        period_label: period,
        paid_at: new Date().toISOString(),
        ...paymentAmountsForPeriod(period, cashCollectTax),
      }))
      mergeHistoryPayments(payments, paidPeriods)
      markLateFeesPaidInState(paidPeriods)
      const nextPaidThroughDate = data.paid_through_date ?? await extendCurrentPaidThrough(paidPeriods)
      if (nextPaidThroughDate) setTenancy(t => ({ ...t, paid_through_date: nextPaidThroughDate }))
      setPinModalOpen(false)
      setExtras([])
      setChargeMonths(0)
      setCashCollectTax(false)
      setChargeSuccess({
        ...snapshot,
        periods: paidPeriods.map(period => previewByLabel.get(period) ?? previewForPeriod(period)),
        paidThrough: nextPaidThroughDate,
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not record payment.' }
    } finally {
      setCharging(false)
    }
  }

  const extrasTotal        = extras.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
  const extraTaxTotal      = taxAmountForSubtotal(extrasTotal)
  const baseSubtotal       = chargePreview.reduce((sum, period) => sum + (Number(period.subtotal) || 0), 0)
  const baseTotal          = chargePreview.reduce((sum, period) => sum + (Number(period.amount) || 0), 0)
  const taxTotal           = dollars(cents(baseTotal - baseSubtotal) + cents(extraTaxTotal))
  const subtotalTotal      = baseSubtotal + extrasTotal
  const cardGrandTotal     = baseTotal + extrasTotal + extraTaxTotal
  const cashTaxTotal       = cashCollectTax ? taxTotal : 0
  const cashGrandTotal     = subtotalTotal + cashTaxTotal
  const canMarkPaidCharge  = chargePreview.length > 0

  function replaceLateFeeInState(nextFee) {
    setLateFees(current => {
      const withoutFee = current.filter(fee => fee.period_label !== nextFee.period_label)
      return sortPaymentsByPeriod([nextFee, ...withoutFee])
    })
  }

  async function toggleLateFee(period, enabled) {
    const existing = openLateFeesByPeriod.get(period)
    setLateFeeSaving(period)
    setLateFeeError('')

    try {
      if (enabled) {
        const amount = lateFeeAmountForPeriod(period, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
        if (amount <= 0) return

        const { data, error } = await supabase
          .from('storage_late_fees')
          .upsert(
            {
              ...(isPortable
                ? { portable_rental_id: tenancy.id, asset_id: assetId }
                : { tenancy_id: tenancy.id }),
              period_label: period,
              rate: LATE_FEE_RATE,
              amount,
              status: 'open',
              applied_at: new Date().toISOString(),
              resolved_at: null,
            },
            { onConflict: isPortable ? 'portable_rental_id,period_label' : 'tenancy_id,period_label' },
          )
          .select()
          .single()

        if (error) throw error
        if (data) replaceLateFeeInState(data)
      } else if (existing) {
        const { data, error } = await supabase
          .from('storage_late_fees')
          .update({ status: 'waived', resolved_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        if (data) replaceLateFeeInState(data)
      }
    } catch (err) {
      console.error('late fee toggle error:', err)
      setLateFeeError(err instanceof Error ? err.message : 'Could not update late fee.')
    } finally {
      setLateFeeSaving('')
    }
  }

  function openPinModal(action) {
    setChargeError('')
    setPendingAction(action)
    setPinModalOpen(true)
  }

  function handlePinConfirm(pin) {
    if (pendingAction === 'cash') return handleMarkPaidCharge(pin)
    if (pendingAction === 'remove') return handleRemoveLatestPayment(pin)
    return handleChargeCard(pin)
  }

  async function handleRemoveLatestPayment(pin) {
    if (!latestPayment) return { error: 'No paid months to remove.' }

    setCharging(true)
    setChargeError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before removing this payment.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_latest_payment',
          ...(isPortable ? { portable_asset_id: assetId } : isCustomerItem ? { tenancy_id: tenancy.id } : { unit_id: unitId }),
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
      setLateFees(current => current.map(fee => (
        fee.period_label === removed.period_label && fee.status === 'paid'
          ? { ...fee, status: 'open', resolved_at: null }
          : fee
      )))
      setTenancy(current => current ? { ...current, paid_through_date: data.paid_through_date ?? null } : current)
      setPinModalOpen(false)
      setTab('history')
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not remove payment.' }
    } finally {
      setCharging(false)
    }
  }

  async function handleChargeCard(pin) {
    const snapshot = {
      tenantName,
      unitNumber: displayName,
      periods: chargePreview,
      monthlyRate: tenancy.monthly_rate || 0,
      extras: extras.filter(e => parseFloat(e.amount) > 0),
      extrasTotal,
      taxTotal,
      grandTotal: cardGrandTotal,
      paymentMethod: 'card',
    }

    setCharging(true)
    setChargeError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        return { error: 'Sign in again before charging this card.' }
      }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isPortable ? { portable_asset_id: assetId } : isCustomerItem ? { tenancy_id: tenancy.id } : { unit_id: unitId }),
          periods: chargePreview.map(p => p.label),
          extra_amount: extrasTotal,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        return { error: data.error || 'Charge failed.' }
      }
      if (data.status === 'charged') {
        const chargedPeriods = data.periods ?? []
        let nextPaidThroughDate = null
        if (chargedPeriods.length) {
          const paymentQuery = supabase.from(isPortable ? 'portable_storage_payments' : 'storage_payments').select('*')
          const { data: payments } = await (isPortable
            ? paymentQuery.eq('asset_id', assetId).in('period_label', chargedPeriods)
            : paymentQuery.eq('tenancy_id', tenancy.id).in('period_label', chargedPeriods)
          )
          const fallbackPayments = chargedPeriods.map(period => ({
            id: `${tenancy.id}-${period}`,
            ...(isPortable ? { asset_id: assetId } : { tenancy_id: tenancy.id }),
            period_label: period,
            paid_at: new Date().toISOString(),
            ...paymentAmountsForPeriod(period, true),
          }))
          mergeHistoryPayments(payments?.length ? payments : fallbackPayments, chargedPeriods)
          markLateFeesPaidInState(chargedPeriods)
          nextPaidThroughDate = data.paid_through_date ?? await extendCurrentPaidThrough(chargedPeriods)
          if (nextPaidThroughDate) setTenancy(t => ({ ...t, paid_through_date: nextPaidThroughDate }))
        }
        setPinModalOpen(false)
        setExtras([])
        setChargeMonths(0)
        setCashCollectTax(false)
        setChargeSuccess({
          ...snapshot,
          periods: chargedPeriods.map(period => previewByLabel.get(period) ?? previewForPeriod(period)),
          paidThrough: nextPaidThroughDate,
        })
      } else if (data.status === 'skipped') {
        return { error: data.reason === 'no_card' ? 'No usable card on file.' : `Charge skipped: ${data.reason || 'unknown reason'}.` }
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Charge failed.' }
    } finally { setCharging(false) }
  }

  return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
        <button onClick={() => navigate('/storage')} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">{displayName}</h1>
          {tenantName && <p className="text-xs text-muted-foreground truncate">{tenantName}</p>}
        </div>
        {tenancy.monthly_rate && (
          <p className="text-sm text-muted-foreground flex-shrink-0">${tenancy.monthly_rate}/mo</p>
        )}
        {tenancy.customers?.stripe_customer_id && (
          <a
            href={`https://dashboard.stripe.com/customers/${tenancy.customers.stripe_customer_id}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        <StatusHero
          behindCount={behindCount}
          overdueCount={overdueCount}
          monthlyRate={tenancy.monthly_rate}
          outstandingTotal={outstandingTotal}
          history={history}
          billingDay={tenancy.billing_day}
          paidThroughDate={paidThroughDate}
        />

        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {[['history', 'Paid months'], ['charge', 'Charge']].map(([val, label]) => (
            <button key={val} type="button"
              onClick={() => { setTab(val); if (val === 'charge') setChargeSuccess(null) }}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${tab === val ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Paid months tab ── */}
        {tab === 'history' ? (
          periods.length > 0 || history.length > 0 || paidThroughDate ? (
            <div className="space-y-4">
              {unpaidPeriods.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Outstanding</p>
                  <div className="rounded-xl border border-destructive/30 overflow-hidden">
                    {unpaidPeriods.map((period, i) => {
                      const baseAmount = periodChargeAmount(period, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
                      const lateFee = openLateFeesByPeriod.get(period)
                      const lateFeeAmount = Number(lateFee?.amount) || 0
                      const lateFeeDate = lateFeeDateForPeriod(period, tenancy.billing_day, tenancy.move_in_date)
                      const lateFeeEligible = lateFeeDate && today && lateFeeDate <= today
                      const lateFeeDisabled = lateFeeSaving === period || (!lateFee && !lateFeeEligible)
                      return (
                        <div key={period} className={cn('flex items-center justify-between gap-3 px-4 py-3 text-sm', i < unpaidPeriods.length - 1 && 'border-b border-destructive/20')}>
                          <div className="min-w-0">
                            <p className="font-medium">{formatPeriod(period)}</p>
                            <p className="text-xs text-muted-foreground">
                              ${baseAmount.toFixed(2)}
                              {lateFeeAmount > 0 ? ` + $${lateFeeAmount.toFixed(2)} late fee` : lateFeeDate && !lateFeeEligible ? ` · Late fee ${formatLocalDate(dateStr(lateFeeDate), { month: 'short', day: 'numeric' })}` : ''}
                            </p>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-3">
                            <span className="text-xs font-medium text-muted-foreground">${(baseAmount + lateFeeAmount).toFixed(2)}</span>
                            <label className={cn('flex items-center gap-1.5 text-xs', lateFeeDisabled ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
                              <input
                                type="checkbox"
                                checked={!!lateFee}
                                disabled={lateFeeDisabled}
                                onChange={e => toggleLateFee(period, e.target.checked)}
                                className="h-4 w-4 accent-destructive"
                              />
                              Late fee
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {lateFeeError && <p className="text-xs text-destructive pt-1">{lateFeeError}</p>}
                </div>
              )}

              {history.length > 0 && (
                <div className="space-y-1">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Paid months</p>
                    {latestPayment && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={charging}
                        onClick={() => openPinModal('remove')}
                      >
                        Remove latest
                      </Button>
                    )}
                  </div>
                  <div className="rounded-xl border overflow-hidden">
                    {history.map((payment, i) => (
                      <div key={payment.id} className={cn('flex items-center justify-between gap-3 px-4 py-3 text-sm', i < history.length - 1 && 'border-b')}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium">{formatPeriod(payment.period_label)}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              Recorded {new Date(payment.paid_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                              {payment.amount ? ` · $${parseFloat(payment.amount).toFixed(2)}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="flex-shrink-0 text-xs font-medium text-green-600">{paidMonthLabel(payment.period_label, tenancy.billing_day)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unpaidPeriods.length === 0 && history.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No paid months yet</p>
              )}
            </div>
          ) : tenancy.move_in_date ? (
            <p className="text-sm text-muted-foreground">
              No payment due yet · first billing {ordinal(tenancy.billing_day)} of{' '}
              {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-CA', { month: 'long' })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No billing info set.</p>
          )
        ) : (

          /* ── Charge tab ── */
          chargeSuccess ? (
            <ChargeSuccessView
              result={chargeSuccess}
              onDone={() => { setChargeSuccess(null); setTab('history') }}
            />
          ) : (
            <div className="space-y-4">

              {/* Month selector */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Months to charge</p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setChargeMonths(m => Math.max(0, m - 1))}
                    className="w-10 h-10 rounded-xl border flex items-center justify-center text-lg font-medium hover:bg-accent transition-colors flex-shrink-0">−</button>
                  <div className="flex-1 text-center">
                    <p className="text-3xl font-bold">{chargeMonths}</p>
                    <p className="text-xs text-muted-foreground">{chargeMonths === 1 ? 'month' : 'months'}</p>
                  </div>
                  <button onClick={() => setChargeMonths(m => Math.min(24, m + 1))}
                    className="w-10 h-10 rounded-xl border flex items-center justify-center text-lg font-medium hover:bg-accent transition-colors flex-shrink-0">+</button>
                </div>
              </div>

              {/* Periods preview */}
              {chargePreview.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  {chargePreview.map(({ label, subtotal, lateFeeAmount, alreadyPaid }, i) => (
                    <div key={label} className={cn('flex items-center justify-between px-4 py-2.5 text-sm', i < chargePreview.length - 1 && 'border-b')}>
                      <div>
                        <p className="font-medium">{formatPeriod(label)}</p>
                        {lateFeeAmount > 0 && <p className="text-xs text-destructive">Includes ${lateFeeAmount.toFixed(2)} late fee</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {subtotal > 0 && <span className="text-xs text-muted-foreground">${subtotal.toFixed(2)}</span>}
                        {alreadyPaid
                          ? <div className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> Paid</div>
                          : <span className="text-xs text-primary font-medium">Will charge</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Extra charges */}
              {extras.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Extra charges</p>
                  {extras.map(e => (
                    <div key={e.id} className="flex items-center gap-2">
                      <Input value={e.label} onChange={ev => setExtras(prev => prev.map(x => x.id === e.id ? { ...x, label: ev.target.value } : x))} placeholder="Description" className="flex-1" />
                      <div className="relative w-28 flex-shrink-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <Input type="number" min="0" step="0.01" value={e.amount} onChange={ev => setExtras(prev => prev.map(x => x.id === e.id ? { ...x, amount: ev.target.value } : x))} className="pl-6" placeholder="0.00" />
                      </div>
                      <button onClick={() => setExtras(prev => prev.filter(x => x.id !== e.id))} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setExtras(prev => [...prev, { id: crypto.randomUUID(), label: '', amount: '' }])}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
                <Plus size={13} />
                Add extra charge
              </button>

              {canMarkPaidCharge && (
                <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Add HST to cash payment</span>
                  <input
                    type="checkbox"
                    checked={cashCollectTax}
                    onChange={e => setCashCollectTax(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                </label>
              )}

              {/* Total */}
              {subtotalTotal > 0 && (
                <div className="space-y-1 py-2 border-t text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>${subtotalTotal.toFixed(2)}</span>
                  </div>
                  {canMarkPaidCharge && cashTaxTotal > 0 && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Cash {SALES_TAX_LABEL} 13%</span>
                      <span>${cashTaxTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {canMarkPaidCharge && (
                    <div className="flex items-center justify-between font-semibold">
                      <span>Cash total</span>
                      <span>${cashGrandTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {hasCard && taxTotal > 0 && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Card {SALES_TAX_LABEL} 13%</span>
                      <span>${taxTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {hasCard && (
                    <div className="flex items-center justify-between font-semibold">
                      <span>Card total</span>
                      <span>${cardGrandTotal.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              {subtotalTotal > 0 && (
                <div className="flex gap-2">
                  {canMarkPaidCharge && (
                    <Button variant="outline" className="flex-1 gap-1.5" disabled={charging} onClick={() => openPinModal('cash')}>
                      <Banknote size={13} />
                      Cash
                    </Button>
                  )}
                  {hasCard && (
                    <Button className="flex-1 gap-1.5" disabled={charging} onClick={() => openPinModal('card')}>
                      <CreditCard size={13} />
                      Charge card
                    </Button>
                  )}
                </div>
              )}

              {subtotalTotal > 0 && !hasCard && !canMarkPaidCharge && (
                <p className="text-xs text-muted-foreground text-center py-2">No card on file</p>
              )}

              {chargeError && (
                <p className="text-xs text-destructive text-center py-2">{chargeError}</p>
              )}

              {subtotalTotal === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Set months above or add an extra charge</p>
              )}
            </div>
          )
        )}
      </div>

      <PinModal
        open={pinModalOpen}
        onClose={() => !charging && setPinModalOpen(false)}
        onConfirm={handlePinConfirm}
        charging={charging}
        actionType={pendingAction}
        details={{
          tenantName,
          unitNumber: displayName,
          periods: pendingAction === 'remove' && latestPayment
            ? [{
                label: latestPayment.period_label,
                subtotal: latestPayment.subtotal_amount ?? latestPayment.amount ?? 0,
              }]
            : chargePreview,
          monthlyRate: tenancy.monthly_rate,
          extras: pendingAction === 'remove' ? [] : extras,
          extrasTotal,
          taxTotal: pendingAction === 'remove' ? 0 : pendingAction === 'cash' ? cashTaxTotal : taxTotal,
          grandTotal: pendingAction === 'remove'
            ? Number(latestPayment?.amount ?? 0)
            : pendingAction === 'cash' ? cashGrandTotal : cardGrandTotal,
        }}
      />
    </div>
  )
}
