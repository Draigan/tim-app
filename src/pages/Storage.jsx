import { useState } from 'react'
import { Search, X, Phone, ChevronRight, CheckCircle2, Send, DoorOpen } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ─── mock data (replace with Supabase queries) ────────────────────────────────

const TODAY_DAY = new Date().getDate()
const THIS_MONTH = new Date().toISOString().slice(0, 7)

const MOCK_FIXED = [
  { id: '1', unit_number: 'A1', tenant_name: 'John Smith',  tenant_phone: '5195551234', monthly_rate: 120, billing_day: 1,  payment_frequency: 'monthly', move_in_date: '2025-01-15', notes: '', sms_opt_in: true },
  { id: '2', unit_number: 'A2', tenant_name: 'Sarah Jones', tenant_phone: '5195555678', monthly_rate: 150, billing_day: 15, payment_frequency: 'monthly', move_in_date: '2024-06-01', notes: '', sms_opt_in: true },
  { id: '3', unit_number: 'B1', tenant_name: 'Mike Davis',  tenant_phone: '5195559012', monthly_rate: 200, billing_day: 23, payment_frequency: 'monthly', move_in_date: '2025-03-01', notes: 'Extra lock on door', sms_opt_in: false },
  { id: '4', unit_number: 'B2', tenant_name: null,          tenant_phone: null,          monthly_rate: null, billing_day: null, payment_frequency: null,    move_in_date: null,         notes: '', sms_opt_in: false },
]

const MOCK_PORTABLE = [
  { id: 'p1', label: 'PS-01', address: '123 Main St, Kitchener ON', customer_name: 'Bob Wilson', customer_phone: '5195554321', monthly_rate: 180, billing_day: 5,  payment_frequency: 'monthly', sms_opt_in: true },
  { id: 'p2', label: 'PS-02', address: '456 Oak Ave, Waterloo ON',  customer_name: 'Lisa Chen',  customer_phone: '5195557890', monthly_rate: 180, billing_day: 22, payment_frequency: 'monthly', sms_opt_in: true },
]

const MOCK_PAID_IDS = new Set(['2', 'p2'])

const MOCK_HISTORY = {
  '1': [
    { period_label: '2026-04', paid_at: '2026-04-02T10:00:00Z', amount: 120 },
    { period_label: '2026-03', paid_at: '2026-03-01T09:00:00Z', amount: 120 },
    { period_label: '2026-02', paid_at: '2026-02-04T11:00:00Z', amount: 120 },
  ],
  '2': [
    { period_label: '2026-05', paid_at: '2026-05-15T08:00:00Z', amount: 150 },
    { period_label: '2026-04', paid_at: '2026-04-15T09:00:00Z', amount: 150 },
    { period_label: '2026-03', paid_at: '2026-03-16T10:00:00Z', amount: 150 },
  ],
  'p1': [
    { period_label: '2026-04', paid_at: '2026-04-05T08:00:00Z', amount: 180 },
    { period_label: '2026-03', paid_at: '2026-03-05T08:00:00Z', amount: 180 },
  ],
}

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function fmtPhone(p) {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p
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
            {unit.tenant_phone && <span className="text-xs text-muted-foreground">{fmtPhone(unit.tenant_phone)}</span>}
          </div>
        )}
      </div>
      {status && <StatusBadge status={status} billingDay={unit.billing_day} />}
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

function PortableCard({ unit, isPaid, onTap }) {
  const status = paymentStatus(unit.billing_day, unit.payment_frequency, isPaid)

  return (
    <button
      className={cn('w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors', cardBorder(status))}
      onClick={() => onTap(unit)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{unit.label}</span>
          {unit.customer_name && <span className="text-sm text-muted-foreground truncate">{unit.customer_name}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{unit.address}</p>
      </div>
      <StatusBadge status={status} billingDay={unit.billing_day} />
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

// ─── bottom sheet ─────────────────────────────────────────────────────────────

function StorageSheet({ item, type, isPaid, onClose, onTogglePaid }) {
  if (!item) return null

  const vacant = type === 'fixed' && !item.tenant_name
  const status = vacant ? null : paymentStatus(item.billing_day, item.payment_frequency, isPaid)
  const history = MOCK_HISTORY[item.id] || []
  const phone = type === 'fixed' ? item.tenant_phone : item.customer_phone
  const name  = type === 'fixed' ? item.tenant_name  : item.customer_name
  const title = type === 'fixed' ? `Unit ${item.unit_number}` : item.label

  return (
    <Sheet open={!!item} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>{title}</span>
            {status && <StatusBadge status={status} billingDay={item.billing_day} />}
          </SheetTitle>
        </SheetHeader>

        {vacant ? (
          <div className="text-center py-8 text-muted-foreground">
            <DoorOpen size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">This unit is vacant</p>
            <Button className="mt-4" size="sm">Assign tenant</Button>
          </div>
        ) : (
          <div className="space-y-5">

            {/* Info */}
            <div className="space-y-1">
              {name && <p className="font-medium">{name}</p>}
              {phone && (
                <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-sm text-primary">
                  <Phone size={13} />
                  {fmtPhone(phone)}
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

            {/* Paid toggle */}
            <div className="flex items-center justify-between rounded-xl border bg-card p-4">
              <div>
                <p className="text-sm font-medium">{THIS_MONTH} payment</p>
                <p className="text-xs text-muted-foreground">{isPaid ? 'Marked as paid' : 'Not yet received'}</p>
              </div>
              <Button size="sm" variant={isPaid ? 'secondary' : 'default'} onClick={onTogglePaid}>
                {isPaid ? 'Mark unpaid' : 'Mark paid'}
              </Button>
            </div>

            {/* Send reminder */}
            {!isPaid && phone && (
              <Button variant="outline" className="w-full gap-2">
                <Send size={14} />
                Send reminder
              </Button>
            )}

            {/* Payment history */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Payment history
              </h3>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No payments recorded yet</p>
              ) : (
                <div className="space-y-0">
                  {history.map((p, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b last:border-0 text-sm">
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
  const [query, setQuery]     = useState('')
  const [selected, setSelected] = useState(null) // { item, type }
  const [paidIds, setPaidIds] = useState(MOCK_PAID_IDS)

  const q = query.trim().toLowerCase()
  const match = (...fields) => fields.some(f => f?.toLowerCase().includes(q))

  const fixedFiltered = MOCK_FIXED
    .filter(u => !q || match(u.unit_number, u.tenant_name, u.tenant_phone))
    .sort((a, b) => {
      if (!a.tenant_name && b.tenant_name) return 1
      if (a.tenant_name && !b.tenant_name) return -1
      const sa = paymentStatus(a.billing_day, a.payment_frequency, paidIds.has(a.id))
      const sb = paymentStatus(b.billing_day, b.payment_frequency, paidIds.has(b.id))
      return (STATUS_ORDER[sa] ?? 4) - (STATUS_ORDER[sb] ?? 4)
    })

  const portableFiltered = MOCK_PORTABLE.filter(u =>
    !q || match(u.label, u.customer_name, u.customer_phone, u.address)
  )

  function handleTogglePaid() {
    const id = selected.item.id
    setPaidIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Fixed Units ({fixedFiltered.length})
          </h2>
          <div className="space-y-2">
            {fixedFiltered.map(u => (
              <FixedUnitCard
                key={u.id}
                unit={u}
                isPaid={paidIds.has(u.id)}
                onTap={item => setSelected({ item, type: 'fixed' })}
              />
            ))}
          </div>
        </div>

        {portableFiltered.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Portable Storage ({portableFiltered.length})
            </h2>
            <div className="space-y-2">
              {portableFiltered.map(u => (
                <PortableCard
                  key={u.id}
                  unit={u}
                  isPaid={paidIds.has(u.id)}
                  onTap={item => setSelected({ item, type: 'portable' })}
                />
              ))}
            </div>
          </div>
        )}

        {q && fixedFiltered.length === 0 && portableFiltered.length === 0 && (
          <p className="text-muted-foreground text-sm text-center mt-12">No units match "{query}"</p>
        )}
      </div>

      <StorageSheet
        item={selected?.item}
        type={selected?.type}
        isPaid={selected ? paidIds.has(selected.item.id) : false}
        onClose={() => setSelected(null)}
        onTogglePaid={handleTogglePaid}
      />
    </div>
  )
}
