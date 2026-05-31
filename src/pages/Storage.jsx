import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Phone, ChevronRight, CheckCircle2, Send, Pencil, ArrowUpDown, CreditCard, Plus, Eye, EyeOff } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import CustomerPicker from '@/components/CustomerPicker'
import { cn, formatPhone } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'

const todayDay = () => new Date().getDate()

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

function paymentStatus(billingDay, frequency, isPaid, moveInDate) {
  if (!billingDay || !frequency || frequency === 'one_time' || frequency === 'other') {
    return isPaid ? 'paid' : 'unpaid'
  }
  if (isPaid) return 'paid'
  const today = new Date()
  const effectiveDay = Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth()))
  if (moveInDate) {
    const billingDate = todayDay() >= effectiveDay
      ? new Date(today.getFullYear(), today.getMonth(), effectiveDay)
      : new Date(today.getFullYear(), today.getMonth() - 1, Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth() - 1)))
    const [my, mm, md] = moveInDate.split('-').map(Number)
    if (billingDate < new Date(my, mm - 1, md)) return 'upcoming'
  }
  if (todayDay() > effectiveDay) return 'overdue'
  if (effectiveDay - todayDay() <= 3) return 'due_soon'
  return 'upcoming'
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const STATUS_ORDER = { overdue: 0, due_soon: 1, upcoming: 2, unpaid: 2, paid: 3 }

function nextPaymentDate(billingDay) {
  if (!billingDay) return null
  const today = new Date()
  const thisDay = Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth()))
  const candidate = new Date(today.getFullYear(), today.getMonth(), thisDay)
  if (candidate <= today) {
    const nm0 = (today.getMonth() + 1) % 12
    const ny = today.getFullYear() + (today.getMonth() === 11 ? 1 : 0)
    return new Date(ny, nm0, Math.min(billingDay, lastDayOf(ny, nm0)))
  }
  return candidate
}

function daysUntilPayment(billingDay) {
  if (!billingDay) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const next = nextPaymentDate(billingDay); next.setHours(0, 0, 0, 0)
  return Math.round((next - today) / 86400000)
}

function tenureSummary(moveInDate) {
  if (!moveInDate) return null
  const start = new Date(moveInDate)
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
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
}

function generatePeriods(billingDay, moveInDate) {
  if (!billingDay) return []
  const current = currentPeriodLabel(billingDay)
  if (!moveInDate) return [current]
  const [sy, sm_raw, sd] = moveInDate.split('-').map(Number)
  const sm = sm_raw - 1 // 0-indexed
  let [y, m] = current.split('-').map(Number)
  m -= 1 // 0-indexed
  const periods = []
  while ((y > sy || (y === sy && m >= sm)) && periods.length < 24) {
    periods.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    if (--m < 0) { m = 11; y-- }
  }
  // Only include periods whose billing date falls on or after move-in
  return periods.filter(p => {
    const [py, pm] = p.split('-').map(Number)
    const billingDay_ = Math.min(billingDay, lastDayOf(py, pm - 1))
    const billingStr = `${py}-${String(pm).padStart(2,'0')}-${String(billingDay_).padStart(2,'0')}`
    return billingStr >= moveInDate
  })
}

function PaymentCountdown({ billingDay, frequency, isPaid }) {
  if (!billingDay || !frequency || frequency === 'one_time' || frequency === 'other') return null
  const days = daysUntilPayment(billingDay)
  const next = nextPaymentDate(billingDay)
  const dateStr = next.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  if (isPaid) return <p className="text-sm text-muted-foreground">Next payment in {days} day{days !== 1 ? 's' : ''} · {dateStr}</p>
  if (days < 0) {
    const overdueDays = Math.abs(days)
    return <p className="text-sm font-medium text-destructive">{overdueDays} day{overdueDays !== 1 ? 's' : ''} overdue · was due {dateStr}</p>
  }
  if (days === 0) return <p className="text-sm font-medium text-amber-500">Due today · {dateStr}</p>
  if (days <= 3) return <p className="text-sm font-medium text-amber-500">Due in {days} day{days !== 1 ? 's' : ''} · {dateStr}</p>
  return <p className="text-sm text-muted-foreground">Due in {days} days · {dateStr}</p>
}

// ─── shared small pieces ──────────────────────────────────────────────────────

function StatusBadge({ status, billingDay }) {
  if (status === 'paid')     return <span className="text-xs font-medium text-green-500">Paid</span>
  if (status === 'overdue')  return <span className="text-xs font-medium text-destructive">Overdue</span>
  if (status === 'due_soon') return <span className="text-xs font-medium text-amber-500">{billingDay === todayDay() ? 'Due today' : `Due ${ordinal(billingDay)}`}</span>
  if (status === 'upcoming') return <span className="text-xs text-muted-foreground">Due {ordinal(billingDay)}</span>
  return <span className="text-xs text-muted-foreground">Unpaid</span>
}

function cardBorder(status) {
  if (status === 'overdue')  return 'border-red-500/60'
  if (status === 'due_soon') return 'border-amber-500/50'
  return ''
}

// ─── fixed unit pieces ────────────────────────────────────────────────────────

function FixedUnitCard({ unit, isPaid, onTap }) {
  const vacant = !tenantName(unit)
  const status = vacant ? null : paymentStatus(unit.billing_day, unit.payment_frequency, isPaid, unit.move_in_date)

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
          </div>
        )}
      </div>
      {status && <StatusBadge status={status} billingDay={unit.billing_day} />}
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

const FREQ_LABELS = { monthly: 'Monthly', one_time: 'One-time' }

const tenantName = (item) => item?.customers?.name || item?.tenant_name || null
const localDateStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const EMPTY_ASSIGN = { monthly_rate: '150', billing_day: String(new Date().getDate()), payment_frequency: 'monthly', move_in_date: localDateStr(), notes: '' }

function StorageSheet({ item, isPaid, onClose, onTogglePaid, onAssigned }) {
  const navigate = useNavigate()
  const [history, setHistory] = useState([])
  const [smsLog, setSmsLog] = useState([])
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [customer, setCustomer] = useState(null)
  const [allCustomers, setAllCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [isNewCustomer, setIsNewCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' })
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmVacate, setConfirmVacate] = useState(false)
  const [vacateInput, setVacateInput]     = useState('')
  const [remindState, setRemindState] = useState('idle') // idle | sending | sent
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [payingAll, setPayingAll] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasCard, setHasCard] = useState(false)
  const [charging, setCharging] = useState(false)
  const [freqTab, setFreqTab] = useState(item?.payment_frequency === 'one_time' ? 'one_time' : 'monthly')
  const [oneTimeMonths, setOneTimeMonths] = useState(1)
  const [showPin, setShowPin] = useState(false)

  useEffect(() => {
    if (!item) return
    if (!tenantName(item)) {
      supabase.from('customers').select('id, name, phone, email, stripe_payment_method_id').order('name')
        .then(({ data }) => { if (data) setAllCustomers(data) })
    }
  }, [item?.id])

  useEffect(() => {
    if (!item) return
    setCustomer(null)
    setSearch('')
    setIsNewCustomer(false)
    setNewCustomer({ name: '', phone: '', email: '' })
    setAssign(EMPTY_ASSIGN)
  }, [item?.id])

  useEffect(() => {
    if (!item) return
    if (tenantName(item)) {
      setHistoryLoading(true)
      Promise.all([
        supabase.from('storage_payments').select('*').eq('unit_id', item.id).order('period_label', { ascending: false }),
        supabase.from('sms_reminder_log').select('*').eq('ref_id', item.id).order('sent_date', { ascending: false }).limit(10),
        item.customer_id
          ? supabase.from('customers').select('stripe_payment_method_id').eq('id', item.customer_id).single()
          : Promise.resolve({ data: null }),
      ]).then(([{ data: payments }, { data: logs }, { data: cust }]) => {
        if (payments) setHistory(payments)
        if (logs) setSmsLog(logs)
        setHasCard(!!cust?.stripe_payment_method_id)
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
  }, [item?.id])

  function startEdit() {
    setEditForm({
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
    await supabase.from('storage_units').update({
      monthly_rate:      editForm.monthly_rate ? Number(editForm.monthly_rate) : null,
      billing_day:       editForm.billing_day  ? Number(editForm.billing_day)  : null,
      payment_frequency: editForm.payment_frequency || null,
      move_in_date:      editForm.move_in_date  || null,
      notes:             editForm.notes.trim()  || null,
    }).eq('id', item.id)
    setSaving(false)
    setEditing(false)
    onAssigned()
  }

  async function handleMarkOnePaid(period) {
    const { data } = await supabase
      .from('storage_payments')
      .upsert({ unit_id: item.id, period_label: period }, { onConflict: 'unit_id,period_label' })
      .select()
      .single()
    if (data) setHistory(prev => [data, ...prev])
    onAssigned()
  }

  async function handleUnmarkPaid(period) {
    await supabase.from('storage_payments').delete().eq('unit_id', item.id).eq('period_label', period)
    setHistory(prev => prev.filter(p => p.period_label !== period))
    onAssigned()
  }

  async function handlePayAll(unpaid) {
    setPayingAll(true)
    const inserts = unpaid.map(period => ({ unit_id: item.id, period_label: period }))
    const { data } = await supabase.from('storage_payments').upsert(inserts, { onConflict: 'unit_id,period_label' }).select()
    setHistory(prev => [...(data ?? []), ...prev])
    setPayingAll(false)
    onAssigned()
  }

  async function handleChargeNow(period) {
    setCharging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: item.id }),
      })
      const data = await res.json()
if (data.status === 'charged') {
        const { data: payment } = await supabase
          .from('storage_payments').select('*')
          .eq('unit_id', item.id).eq('period_label', data.period).maybeSingle()
        if (payment) setHistory(prev => [payment, ...prev.filter(p => p.period_label !== data.period)])
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
    const inserts = unpaid.map(period => ({ unit_id: item.id, period_label: period }))
    const { data } = await supabase.from('storage_payments').upsert(inserts, { onConflict: 'unit_id,period_label' }).select()
    setHistory(prev => [...(data ?? []), ...prev])
    onAssigned()
  }

  async function handleChargeOneTime() {
    setCharging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: item.id, months: oneTimeMonths }),
      })
      const data = await res.json()
      if (data.status === 'charged') {
        const { data: payments } = await supabase
          .from('storage_payments').select('*')
          .eq('unit_id', item.id).in('period_label', data.periods ?? [])
        if (payments?.length) setHistory(prev => [...payments, ...prev.filter(p => !data.periods?.includes(p.period_label))])
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
      const behind = behindCount > 1
        ? `${behindCount} months behind`
        : behindCount === 1 ? 'overdue' : 'outstanding'
      const body =
        `Hi ${tenantName(item)}, this is a reminder that your storage unit ${item.unit_number} payment is ${behind}.` +
        ` Please arrange payment at your earliest convenience.`
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: item.tenant_phone, body, ref_id: item.id, unit_type: 'fixed' }),
      })
      setSmsLog(prev => [{
        id: crypto.randomUUID(), ref_id: item.id, unit_type: 'fixed',
        phone: item.tenant_phone, sent_date: new Date().toISOString().slice(0, 10),
        days_overdue: null, message: body, created_at: new Date().toISOString(),
      }, ...prev])
      setRemindState('sent')
      setTimeout(() => setRemindState('idle'), 3000)
    } catch {
      setRemindState('idle')
    }
  }

  async function handleVacate() {
    setSaving(true)
    await supabase.from('storage_units').update({
      customer_id: null, tenant_name: null, tenant_phone: null,
      monthly_rate: null, billing_day: null, payment_frequency: null,
      move_in_date: null, notes: null,
    }).eq('id', item.id)
    setSaving(false)
    onAssigned()
    onClose()
  }

  async function handleSendInvite() {
    if (!customer?.id || !customer?.phone) return
    setSendingInvite(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-card-invite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customer.id }),
      })
      setInviteSent(true)
      setTimeout(() => setInviteSent(false), 3000)
    } finally {
      setSendingInvite(false)
    }
  }

  async function handleAssign() {
    setSaving(true)
    let assignCustomer = customer
    if (isNewCustomer) {
      const pin = String(Math.floor(1000 + Math.random() * 9000))
      const { data } = await supabase.from('customers').insert({
        name:  newCustomer.name.trim()  || null,
        phone: newCustomer.phone.trim() || null,
        email: newCustomer.email.trim() || null,
        pin,
      }).select('*').single()
      if (!data) { setSaving(false); return }
      assignCustomer = data
    }
    if (!assignCustomer) { setSaving(false); return }
    const billingDay = assign.billing_day ? Number(assign.billing_day) : null
    // Clear only manually-marked (no real charge) payments from a previous tenant for the current period
    if (billingDay) {
      const period = currentPeriodLabel(billingDay)
      await supabase.from('storage_payments').delete()
        .eq('unit_id', item.id).eq('period_label', period).is('amount', null)
    }
    await supabase.from('storage_units').update({
      customer_id:       assignCustomer.id,
      tenant_name:       assignCustomer.name  || null,
      tenant_phone:      assignCustomer.phone || null,
      monthly_rate:      assign.monthly_rate ? Number(assign.monthly_rate) : null,
      billing_day:       billingDay,
      payment_frequency: assign.payment_frequency || null,
      move_in_date:      assign.move_in_date  || null,
      notes:             assign.notes.trim()  || null,
    }).eq('id', item.id)
    setSaving(false)
    onAssigned()
    onClose()
  }

  if (!item) return null

  const vacant = !tenantName(item)
  const status = vacant ? null : paymentStatus(item.billing_day, item.payment_frequency, isPaid, item.move_in_date)
  const periods = generatePeriods(item.billing_day, item.move_in_date)
  const paidPeriodSet = new Set(history.map(p => p.period_label))
  const unpaidPeriods = periods.filter(p => !paidPeriodSet.has(p))
  const behindCount = unpaidPeriods.length

  return (
    <Sheet open={!!item} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>Unit {item.unit_number}</span>
            {status && <StatusBadge status={status} billingDay={item.billing_day} />}
          </SheetTitle>
        </SheetHeader>

        {vacant ? (
          <div className="space-y-4">

            {/* ── Step 1: Customer ── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Customer</p>
              {customer ? (
                <div className="space-y-2">
                  <div className="bg-muted/50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{customer.name}</p>
                      {customer.phone && <p className="text-xs text-muted-foreground">{customer.phone}</p>}
                      {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                    </div>
                    <button onClick={() => { setCustomer(null); setSearch(''); setIsNewCustomer(false) }} className="text-muted-foreground hover:text-foreground ml-2">
                      <X size={16} />
                    </button>
                  </div>
                  {customer.stripe_payment_method_id ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 px-1">
                      <CheckCircle2 size={13} />
                      Card on file
                    </div>
                  ) : customer.phone ? (
                    <button onClick={handleSendInvite} disabled={sendingInvite} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-1">
                      <Send size={13} />
                      {inviteSent ? 'Invite sent!' : sendingInvite ? 'Sending…' : 'Send card invite'}
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
                  <Input value={newCustomer.phone} onChange={e => setNewCustomer(c => ({ ...c, phone: e.target.value }))} placeholder="(519) 555-0000" type="tel" />
                  <Input value={newCustomer.email} onChange={e => setNewCustomer(c => ({ ...c, email: e.target.value }))} placeholder="email@example.com" type="email" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search existing customers…"
                      className="pl-8"
                      autoFocus
                    />
                  </div>
                  {search.trim().length > 0 && (
                    <div className="border rounded-xl overflow-hidden">
                      {allCustomers
                        .filter(c => [c.name, c.phone, c.email].some(f => f?.toLowerCase().includes(search.toLowerCase())))
                        .slice(0, 5)
                        .map(c => (
                          <button key={c.id} type="button" onClick={() => { setCustomer(c); setSearch('') }}
                            className="w-full text-left px-4 py-3 text-sm hover:bg-accent flex items-center justify-between border-b last:border-0">
                            <span className="font-medium">{c.name}</span>
                            {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
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

            {/* ── Step 2: Unit details ── */}
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
                <Input value={assign.move_in_date} onChange={e => setAssign(a => ({ ...a, move_in_date: e.target.value, billing_day: e.target.value ? String(new Date(e.target.value + 'T12:00:00').getDate()) : a.billing_day }))} type="date" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                <Input value={assign.notes} onChange={e => setAssign(a => ({ ...a, notes: e.target.value }))} placeholder="Extra lock, access info…" />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1"
                disabled={(!customer && (!isNewCustomer || !newCustomer.name.trim())) || !assign.billing_day || saving}
                onClick={handleAssign}>
                {saving ? 'Saving…' : 'Assign Unit'}
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
                        className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${editForm.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
                  <Input value={editForm.move_in_date} onChange={e => setEditForm(f => ({ ...f, move_in_date: e.target.value }))} type="date" />
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
                    {item.customers?.pin && (
                      <button onClick={() => setShowPin(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        PIN <span className="font-mono font-semibold text-foreground tracking-widest">{showPin ? item.customers.pin : '••••'}</span>
                        {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    )}
                    {item.monthly_rate && (
                      <p className="text-sm text-muted-foreground">${item.monthly_rate}/mo · billed the {ordinal(item.billing_day)}</p>
                    )}
                    {item.move_in_date && (
                      <p className="text-xs text-muted-foreground">
                        Tenant for {tenureSummary(item.move_in_date)} · since {new Date(item.move_in_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
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
                  onClick={() => { onClose(); navigate(`/storage/${item.id}/billing`) }}
                  className="w-full flex items-center justify-between bg-card border rounded-xl px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-left">Billing</p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const recent = history.slice(0, 3).map(p => {
                          const [y, m] = p.period_label.split('-').map(Number)
                          return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
                        })
                        if (recent.length > 0) return recent.join(' · ')
                        return behindCount > 0 ? `${behindCount} month${behindCount !== 1 ? 's' : ''} behind` : 'No payments yet'
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
                    Mark Vacant
                  </Button>
                ) : (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                    <p className="text-sm font-medium">Mark unit {item.unit_number} as vacant?</p>
                    <p className="text-xs text-muted-foreground">This clears the tenant and billing info. Payment history is kept.</p>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Type <span className="font-mono font-semibold text-foreground">{item.unit_number}</span> to confirm</p>
                      <Input
                        value={vacateInput}
                        onChange={e => setVacateInput(e.target.value)}
                        placeholder={item.unit_number}
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => { setConfirmVacate(false); setVacateInput('') }}>Cancel</Button>
                      <Button variant="destructive" className="flex-1" disabled={saving || vacateInput !== item.unit_number} onClick={handleVacate}>
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
    </Sheet>
  )
}

// ─── portable unit pieces ─────────────────────────────────────────────────────

function PortableUnitCard({ asset, rental, isPaid, isDeployed, onTap }) {
  const unassigned = !tenantName(rental)
  const status = unassigned ? null : paymentStatus(rental.billing_day, rental.payment_frequency, isPaid, rental.move_in_date)

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
        {unassigned && isDeployed && (
          <p className="text-xs text-primary mt-0.5">Deployed</p>
        )}
      </div>
      {status && <StatusBadge status={status} billingDay={rental.billing_day} />}
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

function PortableStorageSheet({ asset, rental, isPaid, onClose, onTogglePaid, onAssigned }) {
  const [history, setHistory] = useState([])
  const [smsLog, setSmsLog] = useState([])
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [customer, setCustomer] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmVacate, setConfirmVacate] = useState(false)
  const [vacateInput, setVacateInput]     = useState('')
  const [remindState, setRemindState] = useState('idle')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [payingAll, setPayingAll] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (!asset) return
    if (tenantName(rental)) {
      setHistoryLoading(true)
      Promise.all([
        supabase.from('portable_storage_payments').select('*').eq('asset_id', asset.id).order('period_label', { ascending: false }),
        supabase.from('sms_reminder_log').select('*').eq('ref_id', asset.id).order('sent_date', { ascending: false }).limit(10),
      ]).then(([{ data: payments }, { data: logs }]) => {
        if (payments) setHistory(payments)
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
    const { data } = await supabase
      .from('portable_storage_payments')
      .upsert({ asset_id: asset.id, period_label: period }, { onConflict: 'asset_id,period_label' })
      .select()
      .single()
    if (data) setHistory(prev => [data, ...prev])
    onAssigned()
  }

  async function handleUnmarkPaid(period) {
    await supabase.from('portable_storage_payments').delete().eq('asset_id', asset.id).eq('period_label', period)
    setHistory(prev => prev.filter(p => p.period_label !== period))
    onAssigned()
  }

  async function handlePayAll(unpaid) {
    setPayingAll(true)
    const inserts = unpaid.map(period => ({ asset_id: asset.id, period_label: period }))
    const { data } = await supabase.from('portable_storage_payments').upsert(inserts, { onConflict: 'asset_id,period_label' }).select()
    setHistory(prev => [...(data ?? []), ...prev])
    setPayingAll(false)
    onAssigned()
  }

  async function handleSendReminder(behindCount) {
    setRemindState('sending')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const behind = behindCount > 1
        ? `${behindCount} months behind`
        : behindCount === 1 ? 'overdue' : 'outstanding'
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

  async function handleAssign() {
    if (!customer) return
    setSaving(true)
    const payload = {
      asset_id:          asset.id,
      customer_id:       customer.id,
      tenant_name:       customer.name  || null,
      tenant_phone:      customer.phone || null,
      monthly_rate:      assign.monthly_rate ? Number(assign.monthly_rate) : null,
      billing_day:       assign.billing_day  ? Number(assign.billing_day)  : null,
      payment_frequency: assign.payment_frequency || null,
      move_in_date:      assign.move_in_date  || null,
      notes:             assign.notes.trim()  || null,
    }
    await supabase.from('portable_storage_rentals').upsert(payload, { onConflict: 'asset_id' })
    setSaving(false)
    onAssigned()
    onClose()
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
  const status = unassigned ? null : paymentStatus(rental.billing_day, rental.payment_frequency, isPaid, rental.move_in_date)
  const periods = generatePeriods(rental?.billing_day, rental?.move_in_date)
  const paidPeriodSet = new Set(history.map(p => p.period_label))
  const unpaidPeriods = periods.filter(p => !paidPeriodSet.has(p))
  const behindCount = unpaidPeriods.length

  return (
    <Sheet open={!!asset} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>{asset.label}{asset.size ? ` · ${asset.size}` : ''}</span>
            {status && <StatusBadge status={status} billingDay={rental.billing_day} />}
          </SheetTitle>
        </SheetHeader>

        {unassigned ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Customer</p>
              <CustomerPicker value={customer} onChange={setCustomer} />
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
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${assign.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
              <Input value={assign.move_in_date} onChange={e => setAssign(a => ({ ...a, move_in_date: e.target.value, billing_day: e.target.value ? String(new Date(e.target.value + 'T12:00:00').getDate()) : a.billing_day }))} type="date" />
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
                        className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${editForm.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
                  <Input value={editForm.move_in_date} onChange={e => setEditForm(f => ({ ...f, move_in_date: e.target.value }))} type="date" />
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
                    {rental.monthly_rate && (
                      <p className="text-sm text-muted-foreground">${rental.monthly_rate}/mo · billed the {ordinal(rental.billing_day)}</p>
                    )}
                    {rental.move_in_date && (
                      <p className="text-xs text-muted-foreground">
                        Tenant for {tenureSummary(rental.move_in_date)} · since {new Date(rental.move_in_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                        return (
                          <div key={period} className="flex items-center justify-between py-2.5 border-b last:border-0 text-sm">
                            <span className="text-muted-foreground">{formatPeriod(period)}</span>
                            {payment ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{new Date(payment.paid_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
                                <CheckCircle2 size={14} className="text-green-500" />
                                <button onClick={() => handleUnmarkPaid(period)} className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-1">undo</button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleMarkOnePaid(period)}>
                                Mark paid
                              </Button>
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
                    <Button size="sm" variant={isPaid ? 'secondary' : 'default'} onClick={onTogglePaid}>
                      {isPaid ? 'Mark unpaid' : 'Mark paid'}
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
                          <span className="text-sm text-muted-foreground">
                            {new Date(log.sent_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {log.days_overdue === 0 ? 'Due today' : `${log.days_overdue} day${log.days_overdue !== 1 ? 's' : ''} overdue`}
                          </span>
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
                      <Input
                        value={vacateInput}
                        onChange={e => setVacateInput(e.target.value)}
                        placeholder={asset.label}
                        autoFocus
                      />
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
    </Sheet>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Storage() {
  const [query, setQuery]                   = useState('')
  const [units, setUnits]                   = useState([])
  const [paidIds, setPaidIds]               = useState(new Set())
  const [selected, setSelected]             = useState(null)
  const [portableAssets, setPortableAssets] = useState([])
  const [rentals, setRentals]               = useState({})
  const [portablePaidIds, setPortablePaidIds] = useState(new Set())
  const [deployedIds, setDeployedIds]       = useState(new Set())
  const [selectedPortable, setSelectedPortable] = useState(null)
  const [loading, setLoading]               = useState(true)
  const [filter, setFilter]                 = useState('all')   // 'all' | 'unpaid' | 'paid'
  const [sort, setSort]                     = useState('status') // 'status' | 'alpha'

  const fetchAll = useCallback(async () => {
    const cutoff = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 7)
    })()

    const [
      { data: unitData },
      { data: paymentData },
      { data: assetData },
      { data: rentalData },
      { data: portablePaymentData },
      { data: deploymentData },
    ] = await Promise.all([
      supabase.from('storage_units').select('*, customers(name, pin)').order('unit_number'),
      supabase.from('storage_payments').select('unit_id, period_label').gte('period_label', cutoff),
      supabase.from('assets').select('*, asset_types(name, is_storage)').eq('archived', false).order('label'),
      supabase.from('portable_storage_rentals').select('*, customers(name, pin)'),
      supabase.from('portable_storage_payments').select('asset_id, period_label').gte('period_label', cutoff),
      supabase.from('active_deployments').select('asset_id'),
    ])

    if (unitData && paymentData) {
      setUnits(unitData)
      const paid = new Set(
        paymentData
          .filter(p => {
            const unit = unitData.find(u => u.id === p.unit_id)
            return p.period_label === currentPeriodLabel(unit?.billing_day)
          })
          .map(p => p.unit_id)
      )
      setPaidIds(paid)
    }

    if (assetData) {
      const portable = assetData.filter(a => a.asset_types?.is_storage)
      setPortableAssets(portable)
    }

    if (deploymentData) {
      setDeployedIds(new Set(deploymentData.map(d => d.asset_id)))
    }

    if (rentalData) {
      const map = {}
      rentalData.forEach(r => { map[r.asset_id] = r })
      setRentals(map)

      if (portablePaymentData) {
        const paid = new Set(
          portablePaymentData
            .filter(p => {
              const rental = rentalData.find(r => r.asset_id === p.asset_id)
              return p.period_label === currentPeriodLabel(rental?.billing_day)
            })
            .map(p => p.asset_id)
        )
        setPortablePaidIds(paid)
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['storage_units', 'storage_payments', 'portable_storage_rentals', 'portable_storage_payments'], fetchAll)

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
      const sa = paymentStatus(a.billing_day, a.payment_frequency, paidIds.has(a.id), a.move_in_date)
      const sb = paymentStatus(b.billing_day, b.payment_frequency, paidIds.has(b.id), b.move_in_date)
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
      const ra = rentals[a.id]
      const rb = rentals[b.id]
      if (!ra?.tenant_name && rb?.tenant_name) return 1
      if (ra?.tenant_name && !rb?.tenant_name) return -1
      const sa = ra ? paymentStatus(ra.billing_day, ra.payment_frequency, portablePaidIds.has(a.id), ra.move_in_date) : 'unpaid'
      const sb = rb ? paymentStatus(rb.billing_day, rb.payment_frequency, portablePaidIds.has(b.id), rb.move_in_date) : 'unpaid'
      return (STATUS_ORDER[sa] ?? 4) - (STATUS_ORDER[sb] ?? 4)
    })

  async function handleToggleFixedPaid() {
    const id = selected.id
    const period = currentPeriodLabel(selected.billing_day)
    const marking = !paidIds.has(id)
    if (marking) {
      await supabase.from('storage_payments').upsert({
        unit_id: id, period_label: period, amount: selected.monthly_rate ?? null,
      }, { onConflict: 'unit_id,period_label' })
      setPaidIds(prev => new Set([...prev, id]))
    } else {
      await supabase.from('storage_payments').delete().eq('unit_id', id).eq('period_label', period)
      setPaidIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function handleTogglePortablePaid() {
    const id = selectedPortable.id
    const rental = rentals[id]
    const period = currentPeriodLabel(rental?.billing_day)
    const marking = !portablePaidIds.has(id)
    if (marking) {
      await supabase.from('portable_storage_payments').upsert({
        asset_id: id, period_label: period, amount: rental?.monthly_rate ?? null,
      }, { onConflict: 'asset_id,period_label' })
      setPortablePaidIds(prev => new Set([...prev, id]))
    } else {
      await supabase.from('portable_storage_payments').delete().eq('asset_id', id).eq('period_label', period)
      setPortablePaidIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Storage</h1>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search units…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
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
                  <p className="text-muted-foreground text-sm text-center mt-4">No fixed units yet — add them in Settings → Storage Manager</p>
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
                    <PortableUnitCard
                      key={a.id}
                      asset={a}
                      rental={rentals[a.id]}
                      isPaid={portablePaidIds.has(a.id)}
                      isDeployed={deployedIds.has(a.id)}
                      onTap={setSelectedPortable}
                    />
                  ))}
                  {q && filteredPortable.length === 0 && (
                    <p className="text-muted-foreground text-sm text-center mt-4">No portable units match "{query}"</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <StorageSheet
        item={selected}
        isPaid={selected ? paidIds.has(selected.id) : false}
        onClose={() => setSelected(null)}
        onTogglePaid={handleToggleFixedPaid}
        onAssigned={fetchAll}
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
