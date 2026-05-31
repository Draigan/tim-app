import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X, Plus, Phone, Mail, ChevronRight, Pencil, Truck, Trash2, MapPin, Star, CreditCard, CheckCircle2, Send, Eye, EyeOff } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'
import { geocodeAddress } from '@/lib/mapbox'

// ─── helpers ──────────────────────────────────────────────────────────────────


const EMPTY_FORM = { name: '', phone: '', email: '', address: '', notes: '' }

function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// ─── customer card ────────────────────────────────────────────────────────────

function CustomerCard({ customer, onTap }) {
  const contact = [customer.phone && formatPhone(customer.phone), customer.email].filter(Boolean).join(' · ')

  return (
    <button
      className="w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors"
      onClick={() => onTap(customer)}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{customer.name}</p>
        {contact && <p className="text-xs text-muted-foreground mt-0.5 truncate">{contact}</p>}
      </div>
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

// ─── customer sheet ───────────────────────────────────────────────────────────

function CustomerSheet({ customer, isNew, onClose, onSaved }) {
  const [editing, setEditing]       = useState(isNew)
  const [saving, setSaving]         = useState(false)
  const [addrSuggestions, setAddrSuggestions] = useState([])
  const addrTimer = useRef(null)
  const [form, setForm]         = useState(
    customer
      ? { name: customer.name ?? '', phone: customer.phone ?? '', email: customer.email ?? '', address: customer.address ?? '', notes: customer.notes ?? '' }
      : EMPTY_FORM
  )
  const [active, setActive]         = useState([])
  const [past, setPast]             = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [storageCount, setStorageCount] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [savingCard, setSavingCard]     = useState(false)
  const [cardSaved, setCardSaved]       = useState(!!customer?.stripe_payment_method_id)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSent, setInviteSent]     = useState(false)
  const [showPin, setShowPin]           = useState(false)

  useEffect(() => {
    if (!customer) return
    setHistoryLoading(true)
    Promise.all([
      supabase.from('active_deployments').select('*').eq('customer_id', customer.id),
      supabase.from('deployments')
        .select('id, address, picked_up_at, review_requested_at, assets(label, asset_types(name))')
        .eq('customer_id', customer.id)
        .not('picked_up_at', 'is', null)
        .order('picked_up_at', { ascending: false })
        .limit(10),
      supabase.from('storage_units').select('id', { count: 'exact', head: true }).eq('customer_id', customer.id),
      supabase.from('portable_storage_rentals').select('asset_id', { count: 'exact', head: true }).eq('customer_id', customer.id),
    ]).then(([{ data: a }, { data: p }, { count: sc }, { count: pc }]) => {
      if (a) setActive(a)
      if (p) setPast(p)
      setStorageCount((sc ?? 0) + (pc ?? 0))
      setHistoryLoading(false)
    })
  }, [customer?.id])

  async function handleDelete() {
    setDeleting(true)
    await supabase.from('customers').delete().eq('id', customer.id)
    setDeleting(false)
    onSaved()
    onClose()
  }

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function handleAddressChange(value) {
    set('address', value)
    clearTimeout(addrTimer.current)
    if (value.length < 4) { setAddrSuggestions([]); return }
    addrTimer.current = setTimeout(async () => {
      const results = await geocodeAddress(value)
      setAddrSuggestions(results)
    }, 350)
  }

  function selectAddress(feature) {
    set('address', feature.place_name)
    setAddrSuggestions([])
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      name:    form.name.trim()    || null,
      phone:   form.phone.trim()   || null,
      email:   form.email.trim()   || null,
      address: form.address.trim() || null,
      notes:   form.notes.trim()   || null,
    }
    if (isNew) {
      const pin = String(Math.floor(1000 + Math.random() * 9000))
      await supabase.from('customers').insert({ ...payload, pin })
    } else {
      await supabase.from('customers').update(payload).eq('id', customer.id)
    }
    setSaving(false)
    onSaved()
    if (isNew) onClose()
    else setEditing(false)
  }

  async function handleSaveCard() {
    setSavingCard(true)
    const tab = window.open('', '_blank')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-setup-session`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customer.id, origin: window.location.origin }),
      })
      const { url } = await res.json()
      if (url && tab) tab.location.href = url
      else if (tab) tab.close()
    } catch (err) {
      console.error('stripe-setup-session error:', err)
      if (tab) tab.close()
    } finally {
      setSavingCard(false)
    }
  }

  async function handleSendInvite() {
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

  const title = isNew ? 'New Customer' : customer?.name

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
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
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Name</p>
                <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Tim Horton" autoFocus={isNew} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Phone</p>
                <Input value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} placeholder="(519) 555-0000" type="tel" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Email</p>
                <Input value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" type="email" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Address</p>
                <div className="relative">
                  <Input
                    value={form.address}
                    onChange={e => handleAddressChange(e.target.value)}
                    placeholder="123 Main St, Kitchener ON"
                    autoComplete="off"
                  />
                  {addrSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden">
                      {addrSuggestions.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent flex items-start gap-2"
                          onClick={() => selectAddress(s)}
                        >
                          <MapPin size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                          {s.place_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything useful…" />
              </div>
              <div className="flex gap-2 pt-1">
                {!isNew && <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>}
                <Button className="flex-1" disabled={!form.name.trim() || saving} onClick={handleSave}>
                  {saving ? 'Saving…' : isNew ? 'Add Customer' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {form.phone && (
                <a href={`tel:${form.phone}`} className="flex items-center gap-2.5 text-sm text-primary">
                  <Phone size={14} />
                  {formatPhone(form.phone)}
                </a>
              )}
              {form.email && (
                <a href={`mailto:${form.email}`} className="flex items-center gap-2.5 text-sm text-primary">
                  <Mail size={14} />
                  {form.email}
                </a>
              )}
              {form.notes && <p className="text-sm text-muted-foreground">{form.notes}</p>}
              {customer?.pin && (
                <button onClick={() => setShowPin(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  PIN <span className="font-mono font-semibold text-foreground tracking-widest">{showPin ? customer.pin : '••••'}</span>
                  {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
              )}
            </div>
          )}

          {/* Card on file */}
          {!isNew && !editing && (
            <div className="flex items-center gap-2 flex-wrap">
              {cardSaved ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 size={15} />
                  Card on file
                </div>
              ) : (
                <Button variant="outline" size="sm" className="gap-2" disabled={savingCard} onClick={handleSaveCard}>
                  <CreditCard size={14} />
                  {savingCard ? 'Opening…' : 'Save card'}
                </Button>
              )}
              {form.phone && (
                <Button variant="outline" size="sm" className="gap-2" disabled={sendingInvite} onClick={handleSendInvite}>
                  <Send size={14} />
                  {inviteSent ? 'Sent!' : sendingInvite ? 'Sending…' : 'Send card invite'}
                </Button>
              )}
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
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {d.assets?.label}
                            <span className="font-normal text-muted-foreground"> · {d.assets?.asset_types?.name}</span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{d.address}</p>
                        </div>
                        {d.review_requested_at && (
                          <Star size={13} className="text-yellow-500 fill-yellow-500 flex-shrink-0" title="Review requested" />
                        )}
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

          {!isNew && !editing && !historyLoading && (
            confirmDelete ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <p className="text-sm font-medium">Delete {customer.name}?</p>
                <p className="text-xs text-muted-foreground">Their contact info will be removed. Deployment history is kept.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1" disabled={deleting} onClick={handleDelete}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            ) : active.length > 0 || storageCount > 0 ? (
              <p className="text-xs text-muted-foreground text-center">
                Remove active assignments before deleting
              </p>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors py-2"
              >
                <Trash2 size={14} />
                Delete customer
              </button>
            )
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
      .order('name')
    if (data) setCustomers(data)
    if (!silent) setLoading(false)
  }, [])

  const refreshSilent = useCallback(() => fetchCustomers(true), [fetchCustomers])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])
  useRealtime(['customers'], refreshSilent)

  const q = query.trim().toLowerCase()
  const filtered = customers.filter(c =>
    !q || [c.name, c.phone, c.email].some(f => f?.toLowerCase().includes(q))
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
