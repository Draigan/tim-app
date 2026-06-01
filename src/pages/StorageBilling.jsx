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

function generatePeriods(billingDay, moveInDate) {
  if (!billingDay) return []
  const current = currentPeriodLabel(billingDay)
  if (!moveInDate) return [current]
  const [sy, sm_raw] = moveInDate.split('-').map(Number)
  const sm = sm_raw - 1
  let [y, m] = current.split('-').map(Number)
  m -= 1
  const periods = []
  while ((y > sy || (y === sy && m >= sm)) && periods.length < 24) {
    periods.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    if (--m < 0) { m = 11; y-- }
  }
  return periods.filter(p => {
    const [py, pm] = p.split('-').map(Number)
    const bd = Math.min(billingDay, lastDayOf(py, pm - 1))
    return `${py}-${String(pm).padStart(2,'0')}-${String(bd).padStart(2,'0')}` >= moveInDate
  })
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

function StatusHero({ behindCount, monthlyRate, history, billingDay, paidThroughDate }) {
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
    const outstanding = behindCount * (monthlyRate || 0)
    return (
      <div className="rounded-2xl bg-destructive/10 border border-destructive/20 px-4 py-4 flex items-center gap-3">
        <AlertCircle size={28} className="text-destructive flex-shrink-0" />
        <div>
          <p className="font-semibold text-destructive">
            {behindCount} month{behindCount !== 1 ? 's' : ''} overdue
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

function PinModal({ open, onClose, onConfirm, charging, actionType, details }) {
  const [pin, setPin] = useState('')

  useEffect(() => { if (open) setPin('') }, [open])

  if (!open) return null

  const { tenantName, unitNumber, periods, monthlyRate, extras, extrasTotal, grandTotal } = details

  function tap(key) {
    if (key === 'del') { setPin(p => p.slice(0, -1)); return }
    if (pin.length >= 6) return
    setPin(p => p + key)
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
              actionType === 'card' ? 'bg-green-500/15' : 'bg-primary/10'
            )}>
              {actionType === 'cash'
                ? <Banknote size={22} className="text-primary" />
                : <CreditCard size={22} className="text-green-600" />
              }
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">
                {actionType === 'cash' ? 'Record cash payment' : 'Charge card'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {actionType === 'cash' ? 'Cash or cheque · enter PIN to confirm' : 'Card on file · enter PIN to confirm'}
              </p>
            </div>
          </div>

          {/* Charge summary */}
          <div>
            <div className={cn('rounded-xl border divide-y text-sm', actionType === 'card' ? 'bg-green-500/5' : 'bg-muted/40')}>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Tenant</span>
                <span className="font-medium">{tenantName || 'Unknown'}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Unit</span>
                <span className="font-medium">{unitNumber}</span>
              </div>
              {periods.map(({ label }) => (
                <div key={label} className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">{formatPeriod(label)}</span>
                  <span>${parseFloat(monthlyRate || 0).toFixed(2)}</span>
                </div>
              ))}
              {extras.map(e => parseFloat(e.amount) > 0 && (
                <div key={e.id} className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground truncate max-w-[60%]">{e.label || 'Extra'}</span>
                  <span>${parseFloat(e.amount).toFixed(2)}</span>
                </div>
              ))}
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
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={cn(
                    'w-3 h-3 rounded-full transition-all duration-100',
                    i < pin.length
                      ? actionType === 'card' ? 'bg-green-500 scale-110' : 'bg-primary scale-110'
                      : 'bg-muted-foreground/25'
                  )}
                />
              ))}
            </div>
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
                actionType === 'card' && 'bg-green-600 hover:bg-green-700 text-white'
              )}
              disabled={pin.length === 0 || charging}
              onClick={() => onConfirm(pin)}
            >
              {charging
                ? <><Loader2 size={14} className="animate-spin" /> {actionType === 'cash' ? 'Saving…' : 'Charging…'}</>
                : actionType === 'cash' ? <><Banknote size={14} /> Mark paid</> : <><CreditCard size={14} /> Charge card</>
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
  const { tenantName, unitNumber, periods, monthlyRate, extras, grandTotal, paidThrough, paymentMethod } = result
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
          {periods.map(label => (
            <div key={label} className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">{formatPeriod(label)}</span>
              <span className="text-green-600">${parseFloat(monthlyRate || 0).toFixed(2)}</span>
            </div>
          ))}
          {extras.map(e => parseFloat(e.amount) > 0 && (
            <div key={e.id} className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground truncate max-w-[60%]">{e.label || 'Extra'}</span>
              <span className="text-green-600">${parseFloat(e.amount).toFixed(2)}</span>
            </div>
          ))}
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
  const { unitId } = useParams()
  const navigate   = useNavigate()

  const [unit, setUnit]           = useState(null)
  const [tenancy, setTenancy]     = useState(null)
  const [history, setHistory]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('history')
  const [chargeMonths, setChargeMonths] = useState(1)
  const [extras, setExtras]       = useState([])
  const [charging, setCharging]   = useState(false)
  const [chargeError, setChargeError] = useState('')
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState('card')
  const [chargeSuccess, setChargeSuccess] = useState(null)

  const fetchUnit = useCallback(async () => {
    const [{ data: u }, { data: t }] = await Promise.all([
      supabase.from('storage_units').select('id, unit_number').eq('id', unitId).single(),
      supabase.from('storage_tenancies')
        .select('*, customers(name, has_payment_method)')
        .eq('unit_id', unitId)
        .is('end_date', null)
        .maybeSingle(),
    ])

    if (u) setUnit(u)
    if (t) {
      setTenancy(t)

      const { data: payments } = await supabase
        .from('storage_payments')
        .select('*')
        .eq('tenancy_id', t.id)
        .order('period_label', { ascending: false })
      if (payments) setHistory(sortPaymentsByPeriod(payments))
    } else {
      setTenancy(null)
      setHistory([])
    }

    setLoading(false)
  }, [unitId])

  useEffect(() => { queueMicrotask(fetchUnit) }, [fetchUnit])
  useRealtime(['storage_payments', 'storage_tenancies'], fetchUnit)

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
        <h1 className="text-lg font-semibold">Unit {unit.unit_number}</h1>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No active tenant</p>
      </div>
    </div>
  )

  const hasCard       = !!tenancy.customers?.has_payment_method
  const periods       = generatePeriods(tenancy.billing_day, tenancy.move_in_date)
  const paidSet       = new Set(history.map(p => p.period_label).filter(isPeriodLabel))
  const paidThroughDate = paidThroughFromPayments(history, tenancy.billing_day, tenancy.paid_through_date)
  const unpaidPeriods = periods.filter(p => !periodCovered(p, tenancy.billing_day, paidSet, paidThroughDate))
  const behindCount   = unpaidPeriods.length
  const tenantName    = tenancy.customers?.name || tenancy.tenant_name

  function mergeHistoryPayments(payments, periodLabels) {
    const labels = periodLabels ?? payments.map(p => p.period_label)
    setHistory(prev => sortPaymentsByPeriod([...payments, ...prev.filter(p => !labels.includes(p.period_label))]))
  }

  function chargePeriods(months) {
    if (months === 0) return []
    const start = currentPeriodLabel(tenancy.billing_day)
    const [y, m] = start.split('-').map(Number)
    const labels = []
    for (let offset = 0; labels.length < months && offset < 120; offset++) {
      const d = new Date(y, m - 1 + offset, 1)
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!periodCovered(label, tenancy.billing_day, paidSet, paidThroughDate)) labels.push(label)
    }
    return labels.map(label => ({ label, alreadyPaid: false }))
  }

  const chargePreview = chargePeriods(chargeMonths)

  async function handleMarkPaidCharge() {
    const snapshot = {
      tenantName,
      unitNumber: unit.unit_number,
      periods: chargePreview.map(p => p.label),
      monthlyRate: tenancy.monthly_rate || 0,
      extras: extras.filter(e => parseFloat(e.amount) > 0),
      extrasTotal,
      grandTotal,
      paymentMethod: 'cash',
    }
    const toMark = chargePreview.filter(p => !p.alreadyPaid).map(p => p.label)
    if (!toMark.length) return
    setCharging(true)
    try {
      const { data } = await supabase.from('storage_payments')
        .upsert(toMark.map(p => ({ tenancy_id: tenancy.id, period_label: p })), { onConflict: 'tenancy_id,period_label' })
        .select()
      mergeHistoryPayments(data ?? [], toMark)
      const nextPaidThroughDate = await extendTenancyPaidThrough({
        tenancyId: tenancy.id,
        billingDay: tenancy.billing_day,
        periods: toMark,
        currentPaidThroughDate: paidThroughDate,
      })
      if (nextPaidThroughDate) setTenancy(t => ({ ...t, paid_through_date: nextPaidThroughDate }))
      setPinModalOpen(false)
      setExtras([])
      setChargeMonths(0)
      setChargeSuccess({ ...snapshot, periods: toMark, paidThrough: nextPaidThroughDate })
    } finally {
      setCharging(false)
    }
  }

  const extrasTotal        = extras.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
  const baseTotal          = (tenancy.monthly_rate || 0) * chargePreview.length
  const grandTotal         = baseTotal + extrasTotal
  const canMarkPaidCharge  = chargePreview.length > 0

  function openPinModal(action) {
    setChargeError('')
    setPendingAction(action)
    setPinModalOpen(true)
  }

  function handlePinConfirm(pin) {
    if (pendingAction === 'cash') handleMarkPaidCharge(pin)
    else handleChargeCard(pin)
  }

  async function handleChargeCard(pin) {
    const snapshot = {
      tenantName,
      unitNumber: unit.unit_number,
      periods: chargePreview.map(p => p.label),
      monthlyRate: tenancy.monthly_rate || 0,
      extras: extras.filter(e => parseFloat(e.amount) > 0),
      extrasTotal,
      grandTotal,
      paymentMethod: 'card',
    }

    setCharging(true)
    setChargeError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setPinModalOpen(false)
        setChargeError('Sign in again before charging this card.')
        return
      }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          periods: chargePreview.map(p => p.label),
          extra_amount: extrasTotal,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setPinModalOpen(false)
        setChargeError(data.error || 'Charge failed.')
        return
      }
      if (data.status === 'charged') {
        const chargedPeriods = data.periods ?? []
        let nextPaidThroughDate = null
        if (chargedPeriods.length) {
          const { data: payments } = await supabase.from('storage_payments').select('*')
            .eq('tenancy_id', tenancy.id).in('period_label', chargedPeriods)
          const fallbackPayments = chargedPeriods.map(period => ({
            id: `${tenancy.id}-${period}`,
            tenancy_id: tenancy.id,
            period_label: period,
            paid_at: new Date().toISOString(),
            amount: tenancy.monthly_rate,
          }))
          mergeHistoryPayments(payments?.length ? payments : fallbackPayments, chargedPeriods)
          nextPaidThroughDate = await extendTenancyPaidThrough({
            tenancyId: tenancy.id,
            billingDay: tenancy.billing_day,
            periods: chargedPeriods,
            currentPaidThroughDate: paidThroughDate,
          })
          if (nextPaidThroughDate) setTenancy(t => ({ ...t, paid_through_date: nextPaidThroughDate }))
        }
        setPinModalOpen(false)
        setExtras([])
        setChargeMonths(0)
        setChargeSuccess({ ...snapshot, periods: chargedPeriods, paidThrough: nextPaidThroughDate })
      } else if (data.status === 'skipped') {
        setPinModalOpen(false)
        setChargeError(data.reason === 'no_card' ? 'No usable card on file.' : `Charge skipped: ${data.reason || 'unknown reason'}.`)
      }
    } catch (err) {
      setPinModalOpen(false)
      setChargeError(err instanceof Error ? err.message : 'Charge failed.')
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
          <h1 className="text-lg font-semibold">Unit {unit.unit_number}</h1>
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
          monthlyRate={tenancy.monthly_rate}
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
                    {unpaidPeriods.map((period, i) => (
                      <div key={period} className={cn('flex items-center justify-between px-4 py-3 text-sm', i < unpaidPeriods.length - 1 && 'border-b border-destructive/20')}>
                        <span className="font-medium">{formatPeriod(period)}</span>
                        {tenancy.monthly_rate && <span className="text-xs text-muted-foreground">${parseFloat(tenancy.monthly_rate).toFixed(2)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Paid months</p>
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
                  {chargePreview.map(({ label, alreadyPaid }, i) => (
                    <div key={label} className={cn('flex items-center justify-between px-4 py-2.5 text-sm', i < chargePreview.length - 1 && 'border-b')}>
                      <span className="font-medium">{formatPeriod(label)}</span>
                      <div className="flex items-center gap-2">
                        {tenancy.monthly_rate && <span className="text-xs text-muted-foreground">${parseFloat(tenancy.monthly_rate).toFixed(2)}</span>}
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

              {/* Total */}
              {grandTotal > 0 && (
                <div className="flex items-center justify-between py-2 border-t text-sm font-semibold">
                  <span>Total</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
              )}

              {/* Action buttons */}
              {grandTotal > 0 && (
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

              {grandTotal > 0 && !hasCard && !canMarkPaidCharge && (
                <p className="text-xs text-muted-foreground text-center py-2">No card on file</p>
              )}

              {chargeError && (
                <p className="text-xs text-destructive text-center py-2">{chargeError}</p>
              )}

              {grandTotal === 0 && (
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
          unitNumber: unit.unit_number,
          periods: chargePreview,
          monthlyRate: tenancy.monthly_rate,
          extras,
          extrasTotal,
          grandTotal,
        }}
      />
    </div>
  )
}
