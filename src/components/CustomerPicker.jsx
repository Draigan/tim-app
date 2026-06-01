import { useState, useEffect, useRef } from 'react'
import { Search, X, Plus, ChevronDown, MapPin } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/utils'
import { geocodeAddress } from '@/lib/mapbox'
import { CUSTOMER_SAFE_COLUMNS } from '@/lib/customerFields'

const EMPTY_NEW = { name: '', phone: '', email: '', address: '', notes: '' }

export default function CustomerPicker({ value, onChange }) {
  const [open, setOpen]           = useState(false)
  const [query, setQuery]         = useState('')
  const [customers, setCustomers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm]           = useState(EMPTY_NEW)
  const [addrSuggestions, setAddrSuggestions] = useState([])
  const [creating, setCreating]   = useState(false)
  const inputRef  = useRef(null)
  const addrTimer = useRef(null)

  useEffect(() => {
    supabase.from('customers').select(CUSTOMER_SAFE_COLUMNS).order('name').then(({ data }) => {
      if (data) setCustomers(data)
    })
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? customers.filter(c => [c.name, c.phone, c.email].some(f => f?.toLowerCase().includes(q)))
    : []

  function select(customer) {
    onChange(customer)
    setOpen(false)
    setQuery('')
  }

  function setField(field, val) {
    setForm(f => ({ ...f, [field]: val }))
  }

  function handleAddressChange(value) {
    setField('address', value)
    clearTimeout(addrTimer.current)
    if (value.length < 4) { setAddrSuggestions([]); return }
    addrTimer.current = setTimeout(async () => {
      const results = await geocodeAddress(value)
      setAddrSuggestions(results)
    }, 350)
  }

  function selectAddress(feature) {
    setField('address', feature.place_name)
    setAddrSuggestions([])
  }

  async function handleCreate() {
    if (!form.name.trim()) return
    setCreating(true)
    const { data } = await supabase
      .from('customers')
      .insert({
        name:    form.name.trim()    || null,
        phone:   form.phone.trim()   || null,
        email:   form.email.trim()   || null,
        address: form.address.trim() || null,
        notes:   form.notes.trim()   || null,
      })
      .select(CUSTOMER_SAFE_COLUMNS)
      .single()
    setCreating(false)
    if (data) {
      setCustomers(prev => [...prev, data].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))
      select(data)
      setShowCreate(false)
      setForm(EMPTY_NEW)
    }
  }

  // Selected state
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-input bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">{value.name}</p>
          {value.phone && <p className="text-xs text-muted-foreground">{formatPhone(value.phone)}</p>}
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground ml-2 flex-shrink-0">
          <X size={16} />
        </button>
      </div>
    )
  }

  // Picker state
  return (
    <div className="relative">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          <span>Search or select customer…</span>
          <ChevronDown size={16} />
        </button>
      ) : (
        <div className="border border-input rounded-lg bg-background overflow-hidden shadow-md">
          <div className="flex items-center px-3 border-b">
            <Search size={14} className="text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              type="search"
              placeholder="Type a name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 px-2 py-2.5 text-sm bg-transparent outline-none"
            />
            <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => select(c)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent flex items-center justify-between border-b last:border-0"
              >
                <span className="font-medium">{c.name}</span>
                {c.phone && <span className="text-xs text-muted-foreground">{formatPhone(c.phone)}</span>}
              </button>
            ))}
            {filtered.length === 0 && q && (
              <p className="text-xs text-muted-foreground px-3 py-2.5">No customers match "{query}"</p>
            )}
            <button
              type="button"
              onClick={() => { setOpen(false); setShowCreate(true) }}
              className="w-full text-left px-3 py-2.5 text-sm text-primary hover:bg-accent flex items-center gap-2 border-t"
            >
              <Plus size={14} />
              New customer
            </button>
          </div>
        </div>
      )}

      <Sheet open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) { setForm(EMPTY_NEW); setAddrSuggestions([]) } }}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>New Customer</SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Name</p>
              <Input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Full name" autoFocus />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Phone</p>
              <Input value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="(519) 555-0000" type="tel" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Email</p>
              <Input value={form.email} onChange={e => setField('email', e.target.value)} placeholder="email@example.com" type="email" />
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
              <Input value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Anything useful…" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1" type="button" disabled={!form.name.trim() || creating} onClick={handleCreate}>
                {creating ? 'Creating…' : 'Add & Select'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
