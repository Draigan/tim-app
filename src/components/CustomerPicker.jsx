import { useState, useEffect, useRef } from 'react'
import { Search, X, Plus, ChevronDown } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

function fmtPhone(p) {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p
}

export default function CustomerPicker({ value, onChange }) {
  const [open, setOpen]           = useState(false)
  const [query, setQuery]         = useState('')
  const [customers, setCustomers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName]     = useState('')
  const [newPhone, setNewPhone]   = useState('')
  const [creating, setCreating]   = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    supabase.from('customers').select('*').order('name').then(({ data }) => {
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
    ? customers.filter(c => [c.name, c.phone].some(f => f?.toLowerCase().includes(q)))
    : []

  function select(customer) {
    onChange(customer)
    setOpen(false)
    setQuery('')
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    const { data } = await supabase
      .from('customers')
      .insert({ name: newName.trim(), phone: newPhone.trim() || null })
      .select('id, name, phone')
      .single()
    setCreating(false)
    if (data) {
      setCustomers(prev => [...prev, data].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))
      select(data)
      setShowCreate(false)
      setNewName('')
      setNewPhone('')
    }
  }

  // Selected state
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-input bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">{value.name}</p>
          {value.phone && <p className="text-xs text-muted-foreground">{fmtPhone(value.phone)}</p>}
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
                {c.phone && <span className="text-xs text-muted-foreground">{fmtPhone(c.phone)}</span>}
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

      <Sheet open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) { setNewName(''); setNewPhone('') } }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>New Customer</SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Name</p>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" autoFocus />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Phone</p>
              <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="(519) 555-0000" type="tel" />
            </div>
            <p className="text-xs text-muted-foreground">More details can be added later in the Customers tab.</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1" type="button" disabled={!newName.trim() || creating} onClick={handleCreate}>
                {creating ? 'Creating…' : 'Add & Select'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
