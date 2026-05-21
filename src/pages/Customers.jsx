import { useState, useEffect, useCallback } from 'react'
import { Search, X, Plus, Phone, Mail, ChevronRight, Pencil, Truck, Warehouse } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fullName(c) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

function fmtPhone(p) {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p
}

const EMPTY_FORM = { first_name: '', last_name: '', phone: '', email: '', notes: '' }

// ─── customer card ────────────────────────────────────────────────────────────

function CustomerCard({ customer, onTap }) {
  const contact = [customer.phone && fmtPhone(customer.phone), customer.email].filter(Boolean).join(' · ')

  return (
    <button
      className="w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors"
      onClick={() => onTap(customer)}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{fullName(customer)}</p>
        {contact && <p className="text-xs text-muted-foreground mt-0.5 truncate">{contact}</p>}
      </div>
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

// ─── customer sheet ───────────────────────────────────────────────────────────

function CustomerSheet({ customer, isNew, onClose, onSaved }) {
  const [editing, setEditing]   = useState(isNew)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(
    customer
      ? { first_name: customer.first_name ?? '', last_name: customer.last_name ?? '', phone: customer.phone ?? '', email: customer.email ?? '', notes: customer.notes ?? '' }
      : EMPTY_FORM
  )
  const [active, setActive]   = useState([])
  const [past, setPast]       = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (!customer) return
    setHistoryLoading(true)
    Promise.all([
      supabase.from('active_deployments').select('*').eq('customer_id', customer.id),
      supabase.from('deployments')
        .select('id, address, picked_up_at, assets(label, asset_types(name))')
        .eq('customer_id', customer.id)
        .not('picked_up_at', 'is', null)
        .order('picked_up_at', { ascending: false })
        .limit(10),
    ]).then(([{ data: a }, { data: p }]) => {
      if (a) setActive(a)
      if (p) setPast(p)
      setHistoryLoading(false)
    })
  }, [customer?.id])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.first_name.trim()) return
    setSaving(true)
    const payload = {
      first_name: form.first_name.trim(),
      last_name:  form.last_name.trim()  || null,
      phone:      form.phone.trim()      || null,
      email:      form.email.trim()      || null,
      notes:      form.notes.trim()      || null,
    }
    if (isNew) {
      await supabase.from('customers').insert(payload)
    } else {
      await supabase.from('customers').update(payload).eq('id', customer.id)
    }
    setSaving(false)
    onSaved()
    if (isNew) onClose()
    else setEditing(false)
  }

  const title = isNew ? 'New Customer' : fullName(customer)

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>{title}</span>
            {!isNew && !editing && (
              <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground">
                <Pencil size={16} />
              </button>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">

          {/* Fields */}
          {editing ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">First name</p>
                  <Input value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="First" autoFocus={isNew} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Last name</p>
                  <Input value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Last" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Phone</p>
                <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(519) 555-0000" type="tel" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Email</p>
                <Input value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" type="email" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything useful…" />
              </div>
              <div className="flex gap-2 pt-1">
                {!isNew && <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>}
                <Button className="flex-1" disabled={!form.first_name.trim() || saving} onClick={handleSave}>
                  {saving ? 'Saving…' : isNew ? 'Add Customer' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {form.phone && (
                <a href={`tel:${form.phone}`} className="flex items-center gap-2.5 text-sm text-primary">
                  <Phone size={14} />
                  {fmtPhone(form.phone)}
                </a>
              )}
              {form.email && (
                <a href={`mailto:${form.email}`} className="flex items-center gap-2.5 text-sm text-primary">
                  <Mail size={14} />
                  {form.email}
                </a>
              )}
              {form.notes && <p className="text-sm text-muted-foreground">{form.notes}</p>}
            </div>
          )}

          {/* History */}
          {!isNew && !historyLoading && (active.length > 0 || past.length > 0) && (
            <div className="space-y-4 pt-1">

              {active.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active Deployments</h3>
                  <div className="space-y-2">
                    {active.map(d => (
                      <div key={d.id} className="flex items-center gap-3 bg-card border rounded-xl px-4 py-3">
                        <Truck size={14} className="text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{d.label} <span className="font-normal text-muted-foreground">· {d.type_name}</span></p>
                          <p className="text-xs text-muted-foreground truncate">{d.address}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {past.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Past Deployments</h3>
                  <div className="space-y-2">
                    {past.map(d => (
                      <div key={d.id} className="flex items-center gap-3 bg-card border rounded-xl px-4 py-3 opacity-60">
                        <Truck size={14} className="text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {d.assets?.label}
                            <span className="font-normal text-muted-foreground"> · {d.assets?.asset_types?.name}</span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{d.address}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {!isNew && !historyLoading && active.length === 0 && past.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No deployments yet</p>
          )}

        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [query, setQuery]         = useState('')
  const [selected, setSelected]   = useState(null)
  const [adding, setAdding]       = useState(false)

  const fetchCustomers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('last_name', { ascending: true, nullsFirst: false })
      .order('first_name')
    if (data) setCustomers(data)
    if (!silent) setLoading(false)
  }, [])

  const refreshSilent = useCallback(() => fetchCustomers(true), [fetchCustomers])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])
  useRealtime(['customers'], refreshSilent)

  const q = query.trim().toLowerCase()
  const filtered = customers.filter(c =>
    !q || [c.first_name, c.last_name, c.phone, c.email].some(f => f?.toLowerCase().includes(q))
  )

  function handleSaved() {
    fetchCustomers(true)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Customers</h1>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus size={14} />
          Add
        </Button>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search customers…"
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

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

        {!loading && (
          <div className="space-y-2">
            {filtered.map(c => (
              <CustomerCard key={c.id} customer={c} onTap={setSelected} />
            ))}
            {!loading && customers.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-12">No customers yet</p>
            )}
            {q && filtered.length === 0 && customers.length > 0 && (
              <p className="text-muted-foreground text-sm text-center mt-12">No customers match "{query}"</p>
            )}
          </div>
        )}
      </div>

      {selected && (
        <CustomerSheet
          customer={selected}
          isNew={false}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      {adding && (
        <CustomerSheet
          customer={null}
          isNew
          onClose={() => setAdding(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
