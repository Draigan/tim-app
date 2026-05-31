import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CreditCard, CheckCircle2, Plus, X, AlertCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { cn } from '@/lib/utils'

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
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
}

function shortMonth(label) {
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short' })
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatusHero({ behindCount, monthlyRate, history, billingDay }) {
  const current = currentPeriodLabel(billingDay)
  const lastPaid = history[0]

  if (behindCount === 0 && history.length > 0) {
    return (
      <div className="rounded-2xl bg-green-500/10 border border-green-500/20 px-4 py-4 flex items-center gap-3">
        <CheckCircle2 size={28} className="text-green-500 flex-shrink-0" />
        <div>
          <p className="font-semibold text-green-600">Paid up to date</p>
          {lastPaid && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last payment · {formatPeriod(lastPaid.period_label)}
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
        <p className="text-xs text-muted-foreground mt-0.5">No payments recorded yet</p>
      </div>
    </div>
  )
}

function PaymentTimeline({ periods, paidSet, billingDay }) {
  const current = currentPeriodLabel(billingDay)
  // Include future paid periods not in the normal range
  const futurePaid = [...paidSet].filter(p => p > current && !periods.includes(p)).sort()
  const all = [...[...periods].reverse(), ...futurePaid]
  if (!all.length) return null
  const display = all.slice(-12)

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="flex gap-1.5 pb-1" style={{ minWidth: 'max-content' }}>
        {display.map(period => {
          const paid    = paidSet.has(period)
          const isNow   = period === current
          const overdue = !paid && period <= current

          return (
            <div key={period} className="flex flex-col items-center gap-1">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center text-xs font-semibold transition-colors',
                paid    ? 'bg-green-500 text-white' :
                overdue ? (isNow ? 'bg-amber-400 text-white' : 'bg-destructive/80 text-white') :
                          'bg-muted text-muted-foreground border'
              )}>
                {paid ? <CheckCircle2 size={14} /> : shortMonth(period).slice(0, 3)}
              </div>
              <span className="text-[10px] text-muted-foreground">{shortMonth(period)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function StorageBilling() {
  const { unitId } = useParams()
  const navigate   = useNavigate()

  const [unit, setUnit]           = useState(null)
  const [history, setHistory]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [freqTab, setFreqTab]     = useState('monthly')
  const [oneTimeMonths, setOneTimeMonths] = useState(0)
  const [extras, setExtras]       = useState([])
  const [charging, setCharging]   = useState(false)
  const [payingAll, setPayingAll] = useState(false)

  const fetchUnit = useCallback(async () => {
    const [{ data: u }, { data: payments }] = await Promise.all([
      supabase.from('storage_units')
        .select('*, customers(name, stripe_payment_method_id)')
        .eq('id', unitId).single(),
      supabase.from('storage_payments')
        .select('*').eq('unit_id', unitId).order('period_label', { ascending: false }),
    ])
    if (u) { setUnit(u); setFreqTab(u.payment_frequency === 'one_time' ? 'one_time' : 'monthly') }
    if (payments) setHistory(payments)
    setLoading(false)
  }, [unitId])

  useEffect(() => { fetchUnit() }, [fetchUnit])
  useRealtime(['storage_payments'], fetchUnit)

  if (loading || !unit) return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={() => navigate('/storage')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
      </div>
    </div>
  )

  const hasCard       = !!unit.customers?.stripe_payment_method_id
  const periods       = generatePeriods(unit.billing_day, unit.move_in_date)
  const moveInPeriod  = unit.move_in_date ? unit.move_in_date.substring(0, 7) : null
  const tenancyHistory = moveInPeriod ? history.filter(p => p.period_label >= moveInPeriod) : history
  const paidSet       = new Set(tenancyHistory.map(p => p.period_label))
  const unpaidPeriods = periods.filter(p => !paidSet.has(p))
  const paidPeriods   = periods.filter(p => paidSet.has(p))
  const behindCount   = unpaidPeriods.length
  const tenantName    = unit.customers?.name || unit.tenant_name
  const current       = currentPeriodLabel(unit.billing_day)

  function oneTimePeriods(months) {
    if (months === 0) return []
    const start = currentPeriodLabel(unit.billing_day)
    const [y, m] = start.split('-').map(Number)
    let offset = 0
    while (offset < 100) {
      const d = new Date(y, m - 1 + offset, 1)
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!paidSet.has(label)) break
      offset++
    }
    return Array.from({ length: months }, (_, i) => {
      const d = new Date(y, m - 1 + offset + i, 1)
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { label, alreadyPaid: paidSet.has(label) }
    })
  }

  async function handleMarkOnePaid(period) {
    const { data } = await supabase.from('storage_payments')
      .upsert({ unit_id: unit.id, period_label: period }, { onConflict: 'unit_id,period_label' })
      .select().single()
    if (data) setHistory(prev => [data, ...prev].sort((a, b) => b.period_label.localeCompare(a.period_label)))
  }

  async function handleUnmarkPaid(period) {
    await supabase.from('storage_payments').delete().eq('unit_id', unit.id).eq('period_label', period)
    setHistory(prev => prev.filter(p => p.period_label !== period))
  }

  async function handlePayAll() {
    setPayingAll(true)
    const inserts = unpaidPeriods.map(p => ({ unit_id: unit.id, period_label: p }))
    const { data } = await supabase.from('storage_payments').upsert(inserts, { onConflict: 'unit_id,period_label' }).select()
    setHistory(prev => [...(data ?? []), ...prev].sort((a, b) => b.period_label.localeCompare(a.period_label)))
    setPayingAll(false)
  }

  async function handleMarkPaidOneTime() {
    const toMark = oneTimePeriods(oneTimeMonths).filter(p => !p.alreadyPaid).map(p => p.label)
    if (!toMark.length) return
    const { data } = await supabase.from('storage_payments')
      .upsert(toMark.map(p => ({ unit_id: unit.id, period_label: p })), { onConflict: 'unit_id,period_label' })
      .select()
    setHistory(prev => [...(data ?? []), ...prev].sort((a, b) => b.period_label.localeCompare(a.period_label)))
  }

  async function handleChargeNow(period) {
    setCharging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unit.id }),
      })
      const data = await res.json()
      if (data.status === 'charged') {
        const { data: payment } = await supabase.from('storage_payments').select('*')
          .eq('unit_id', unit.id).eq('period_label', data.period).maybeSingle()
        if (payment) setHistory(prev => [payment, ...prev.filter(p => p.period_label !== data.period)])
      }
    } finally { setCharging(false) }
  }

  const extrasTotal = extras.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
  const baseTotal   = (unit.monthly_rate || 0) * oneTimeMonths
  const grandTotal  = baseTotal + extrasTotal

  async function handleChargeOneTime() {
    setCharging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unit.id, months: oneTimeMonths, extra_amount: extrasTotal }),
      })
      const data = await res.json()
      if (data.status === 'charged' && data.periods) {
        const { data: payments } = await supabase.from('storage_payments').select('*')
          .eq('unit_id', unit.id).in('period_label', data.periods)
        if (payments?.length) setHistory(prev => [...payments, ...prev.filter(p => !data.periods.includes(p.period_label))].sort((a, b) => b.period_label.localeCompare(a.period_label)))
      }
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
        {unit.monthly_rate && (
          <p className="text-sm text-muted-foreground flex-shrink-0">${unit.monthly_rate}/mo</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Status hero */}
        <StatusHero
          behindCount={behindCount}
          monthlyRate={unit.monthly_rate}
          history={tenancyHistory}
          billingDay={unit.billing_day}
        />

        {/* Month timeline */}
        {(periods.length > 0 || tenancyHistory.length > 0) && (
          <PaymentTimeline periods={periods} paidSet={paidSet} billingDay={unit.billing_day} />
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {[['monthly', 'Monthly'], ['one_time', 'One-time']].map(([val, label]) => (
            <button key={val} type="button"
              onClick={() => setFreqTab(val)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${freqTab === val ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Monthly tab ── */}
        {freqTab === 'monthly' ? (
          periods.length > 0 ? (
            <div className="space-y-4">

              {/* Outstanding */}
              {unpaidPeriods.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outstanding</p>
                    {unpaidPeriods.length > 1 && (
                      <Button size="sm" variant="destructive" disabled={payingAll} onClick={handlePayAll}>
                        {payingAll ? 'Saving…' : `Pay all ${unpaidPeriods.length}`}
                      </Button>
                    )}
                  </div>
                  <div className="rounded-xl border border-destructive/30 overflow-hidden">
                    {unpaidPeriods.map((period, i) => (
                      <div key={period} className={cn('flex items-center justify-between px-4 py-3 text-sm', i < unpaidPeriods.length - 1 && 'border-b border-destructive/20')}>
                        <div>
                          <span className="font-medium">{formatPeriod(period)}</span>
                          {unit.monthly_rate && <span className="text-xs text-muted-foreground ml-2">${parseFloat(unit.monthly_rate).toFixed(2)}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasCard && period === current && (
                            <Button size="sm" className="gap-1.5 h-7 text-xs" disabled={charging} onClick={() => handleChargeNow(period)}>
                              <CreditCard size={11} />
                              {charging ? '…' : 'Charge'}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleMarkOnePaid(period)}>
                            Mark paid
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment history — current tenancy only */}
              {tenancyHistory.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payment History</p>
                  <div className="rounded-xl border overflow-hidden">
                    {tenancyHistory.map((payment, i) => (
                      <div key={payment.id} className={cn('flex items-center justify-between px-4 py-3 text-sm', i < tenancyHistory.length - 1 && 'border-b')}>
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                          <div>
                            <p className="font-medium">{formatPeriod(payment.period_label)}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(payment.paid_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                              {payment.amount ? ` · $${parseFloat(payment.amount).toFixed(2)} · Card` : ' · Manual'}
                            </p>
                          </div>
                        </div>
                        {!payment.amount && (
                          <button onClick={() => handleUnmarkPaid(payment.period_label)} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                            undo
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unpaidPeriods.length === 0 && paidPeriods.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No payment periods yet</p>
              )}
            </div>
          ) : unit.move_in_date ? (
            <p className="text-sm text-muted-foreground">
              No payment due yet · first billing {ordinal(unit.billing_day)} of{' '}
              {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-CA', { month: 'long' })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No billing info set.</p>
          )
        ) : (

          /* ── One-time tab ── */
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Months</p>
                <Input type="number" min="0" max="24" value={oneTimeMonths}
                  onChange={e => setOneTimeMonths(Math.max(0, parseInt(e.target.value) || 0))} />
              </div>
              <div className="flex-1 pt-5">
                {oneTimeMonths > 0 && <p className="text-xs text-muted-foreground">${(unit.monthly_rate || 0).toFixed(2)} × {oneTimeMonths}</p>}
                <p className="text-sm font-medium">${baseTotal.toFixed(2)}</p>
              </div>
            </div>

            {oneTimePeriods(oneTimeMonths).length > 0 && (
              <div className="rounded-xl border overflow-hidden">
                {oneTimePeriods(oneTimeMonths).map(({ label, alreadyPaid }, i) => (
                  <div key={label} className={cn('flex items-center justify-between px-4 py-2.5 text-sm', i < oneTimeMonths - 1 && 'border-b')}>
                    <span className="text-muted-foreground">{formatPeriod(label)}</span>
                    {alreadyPaid
                      ? <div className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle2 size={12} /> Paid</div>
                      : <span className="text-xs font-medium text-primary">Will pay</span>
                    }
                  </div>
                ))}
              </div>
            )}

            {extras.length > 0 && (
              <div className="space-y-2">
                {extras.map(e => (
                  <div key={e.id} className="flex items-center gap-2">
                    <Input value={e.label} onChange={ev => setExtras(prev => prev.map(x => x.id === e.id ? { ...x, label: ev.target.value } : x))} placeholder="e.g. Boxes" className="flex-1" />
                    <div className="relative w-24 flex-shrink-0">
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

            <button onClick={() => setExtras(prev => [...prev, { id: crypto.randomUUID(), label: '', amount: '' }])} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
              <Plus size={13} />
              Add extra charge
            </button>

            {(extrasTotal > 0 || oneTimeMonths > 0) && (
              <div className="flex items-center justify-between py-2 border-t text-sm font-semibold">
                <span>Total</span>
                <span>${grandTotal.toFixed(2)}</span>
              </div>
            )}

            <div className="flex gap-2">
              {hasCard && grandTotal > 0 && (
                <Button className="flex-1 gap-1.5" disabled={charging} onClick={handleChargeOneTime}>
                  <CreditCard size={13} />
                  {charging ? 'Charging…' : `Charge $${grandTotal.toFixed(2)}`}
                </Button>
              )}
              {(oneTimeMonths > 0 || extrasTotal > 0) && (
                <Button variant="outline" className="flex-1" onClick={handleMarkPaidOneTime}>
                  Mark paid
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
