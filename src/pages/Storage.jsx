import { useState, useEffect, useCallback } from 'react'
import { Search, X, Phone, ChevronRight, CheckCircle2, Send } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import CustomerPicker from '@/components/CustomerPicker'
import { cn, formatPhone } from '@/lib/utils'

const TODAY_DAY = new Date().getDate()

// ─── helpers ──────────────────────────────────────────────────────────────────

// Returns the billing-cycle period label for a given billing day.
// If today is before the billing day, we're still in last month's cycle.
function currentPeriodLabel(billingDay) {
  const today = new Date()
  if (!billingDay || today.getDate() >= billingDay) {
    return today.toISOString().slice(0, 7)
  }
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return d.toISOString().slice(0, 7)
}

function paymentStatus(billingDay, frequency, isPaid) {
  if (!billingDay || !frequency || frequency === 'one_time' || frequency === 'other') {
    return isPaid ? 'paid' : 'unpaid'
  }
  if (isPaid) return 'paid'
  if (TODAY_DAY > billingDay) return 'overdue'
  if (billingDay - TODAY_DAY <= 3) return 'due_soon'
  return 'upcoming'
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const STATUS_ORDER = { overdue: 0, due_soon: 1, upcoming: 2, unpaid: 2, paid: 3 }

// ─── small pieces ─────────────────────────────────────────────────────────────

function StatusBadge({ status, billingDay }) {
  if (status === 'paid')     return <span className="text-xs font-medium text-green-500">Paid</span>
  if (status === 'overdue')  return <span className="text-xs font-medium text-destructive">Overdue</span>
  if (status === 'due_soon') return <span className="text-xs font-medium text-amber-500">Due {ordinal(billingDay)}</span>
  if (status === 'upcoming') return <span className="text-xs text-muted-foreground">Due {ordinal(billingDay)}</span>
  return <span className="text-xs text-muted-foreground">Unpaid</span>
}

function cardBorder(status) {
  if (status === 'overdue')  return 'border-red-500/60'
  if (status === 'due_soon') return 'border-amber-500/50'
  return ''
}

// ─── cards ────────────────────────────────────────────────────────────────────

function FixedUnitCard({ unit, isPaid, onTap }) {
  const vacant = !unit.tenant_name
  const status = vacant ? null : paymentStatus(unit.billing_day, unit.payment_frequency, isPaid)

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
            : <span className="text-sm text-muted-foreground truncate">{unit.tenant_name}</span>
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

// ─── bottom sheet ─────────────────────────────────────────────────────────────

const FREQ_LABELS = { monthly: 'Monthly', weekly: 'Weekly', one_time: 'One-time' }
const EMPTY_ASSIGN = { monthly_rate: '', billing_day: '', payment_frequency: 'monthly', move_in_date: '', notes: '' }

function StorageSheet({ item, isPaid, onClose, onTogglePaid, onAssigned }) {
  const [history, setHistory] = useState([])
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [customer, setCustomer] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmVacate, setConfirmVacate] = useState(false)

  useEffect(() => {
    if (!item) return
    if (item.tenant_name) {
      supabase
        .from('storage_payments')
        .select('*')
        .eq('unit_id', item.id)
        .order('period_label', { ascending: false })
        .limit(12)
        .then(({ data }) => { if (data) setHistory(data) })
    } else {
      setAssign(EMPTY_ASSIGN)
      setCustomer(null)
    }
    setConfirmVacate(false)
  }, [item?.id])

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

  async function handleAssign() {
    if (!customer) return
    setSaving(true)
    await supabase.from('storage_units').update({
      customer_id:       customer.id,
      tenant_name:       customer.name  || null,
      tenant_phone:      customer.phone || null,
      monthly_rate:      assign.monthly_rate ? Number(assign.monthly_rate) : null,
      billing_day:       assign.billing_day  ? Number(assign.billing_day)  : null,
      payment_frequency: assign.payment_frequency || null,
      move_in_date:      assign.move_in_date  || null,
      notes:             assign.notes.trim()  || null,
    }).eq('id', item.id)
    setSaving(false)
    onAssigned()
    onClose()
  }

  if (!item) return null

  const vacant = !item.tenant_name
  const status = vacant ? null : paymentStatus(item.billing_day, item.payment_frequency, isPaid)

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
                <p className="text-xs text-muted-foreground mb-1.5">Billing Day</p>
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
              <Input value={assign.move_in_date} onChange={e => setAssign(a => ({ ...a, move_in_date: e.target.value }))} type="date" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
              <Input value={assign.notes} onChange={e => setAssign(a => ({ ...a, notes: e.target.value }))} placeholder="Extra lock, access info…" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" disabled={!customer || saving} onClick={handleAssign}>
                {saving ? 'Saving…' : 'Assign'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">

            <div className="space-y-1">
              {item.tenant_name && <p className="font-medium">{item.tenant_name}</p>}
              {item.tenant_phone && (
                <a href={`tel:${item.tenant_phone}`} className="flex items-center gap-1.5 text-sm text-primary">
                  <Phone size={13} />
                  {formatPhone(item.tenant_phone)}
                </a>
              )}
              {item.monthly_rate && item.billing_day && (
                <p className="text-sm text-muted-foreground">
                  ${item.monthly_rate}/mo · Due the {ordinal(item.billing_day)}
                </p>
              )}
              {item.move_in_date && (
                <p className="text-xs text-muted-foreground">Move-in {item.move_in_date}</p>
              )}
              {item.notes && <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>}
            </div>

            <div className="flex items-center justify-between rounded-xl border bg-card p-4">
              <div>
                <p className="text-sm font-medium">{currentPeriodLabel(item.billing_day)} payment</p>
                <p className="text-xs text-muted-foreground">{isPaid ? 'Marked as paid' : 'Not yet received'}</p>
              </div>
              <Button size="sm" variant={isPaid ? 'secondary' : 'default'} onClick={onTogglePaid}>
                {isPaid ? 'Mark unpaid' : 'Mark paid'}
              </Button>
            </div>

            {!isPaid && item.tenant_phone && (
              <Button variant="outline" className="w-full gap-2">
                <Send size={14} />
                Send reminder
              </Button>
            )}

            {!confirmVacate ? (
              <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirmVacate(true)}>
                Mark Vacant
              </Button>
            ) : (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <p className="text-sm font-medium">Mark this unit as vacant?</p>
                <p className="text-xs text-muted-foreground">This clears the tenant and billing info. Payment history is kept.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setConfirmVacate(false)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1" disabled={saving} onClick={handleVacate}>
                    {saving ? 'Saving…' : 'Confirm'}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Payment history
              </h3>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No payments recorded yet</p>
              ) : (
                <div className="space-y-0">
                  {history.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2.5 border-b last:border-0 text-sm">
                      <span className="text-muted-foreground">{p.period_label}</span>
                      <div className="flex items-center gap-3">
                        {p.amount && <span>${p.amount}</span>}
                        <span className="text-xs text-muted-foreground">
                          {new Date(p.paid_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                        </span>
                        <CheckCircle2 size={14} className="text-green-500" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Storage() {
  const [query, setQuery]       = useState('')
  const [units, setUnits]       = useState([])
  const [paidIds, setPaidIds]   = useState(new Set())
  const [selected, setSelected] = useState(null)
  const [loading, setLoading]   = useState(true)

  const fetchAll = useCallback(async () => {
    const cutoff = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 7)
    })()
    const [{ data: unitData }, { data: paymentData }] = await Promise.all([
      supabase.from('storage_units').select('*').order('unit_number'),
      supabase.from('storage_payments').select('unit_id, period_label').gte('period_label', cutoff),
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
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const q = query.trim().toLowerCase()
  const match = (...fields) => fields.some(f => f?.toLowerCase().includes(q))

  const filtered = units
    .filter(u => !q || match(u.unit_number, u.tenant_name, u.tenant_phone))
    .sort((a, b) => {
      if (!a.tenant_name && b.tenant_name) return 1
      if (a.tenant_name && !b.tenant_name) return -1
      const sa = paymentStatus(a.billing_day, a.payment_frequency, paidIds.has(a.id))
      const sb = paymentStatus(b.billing_day, b.payment_frequency, paidIds.has(b.id))
      return (STATUS_ORDER[sa] ?? 4) - (STATUS_ORDER[sb] ?? 4)
    })

  async function handleTogglePaid() {
    const id = selected.id
    const period = currentPeriodLabel(selected.billing_day)
    const marking = !paidIds.has(id)
    if (marking) {
      await supabase.from('storage_payments').upsert({
        unit_id: id,
        period_label: period,
        amount: selected.monthly_rate ?? null,
      }, { onConflict: 'unit_id,period_label' })
      setPaidIds(prev => new Set([...prev, id]))
    } else {
      await supabase.from('storage_payments').delete().eq('unit_id', id).eq('period_label', period)
      setPaidIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
    setSelected(null)
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

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
        {loading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

        {!loading && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Fixed Units ({filtered.length})
            </h2>
            <div className="space-y-2">
              {filtered.map(u => (
                <FixedUnitCard
                  key={u.id}
                  unit={u}
                  isPaid={paidIds.has(u.id)}
                  onTap={setSelected}
                />
              ))}
              {!loading && units.length === 0 && (
                <p className="text-muted-foreground text-sm text-center mt-8">No storage units yet — add them in Settings → Storage Manager</p>
              )}
              {q && filtered.length === 0 && units.length > 0 && (
                <p className="text-muted-foreground text-sm text-center mt-8">No units match "{query}"</p>
              )}
            </div>
          </div>
        )}
      </div>

      <StorageSheet
        item={selected}
        isPaid={selected ? paidIds.has(selected.id) : false}
        onClose={() => setSelected(null)}
        onTogglePaid={handleTogglePaid}
        onAssigned={fetchAll}
      />
    </div>
  )
}
