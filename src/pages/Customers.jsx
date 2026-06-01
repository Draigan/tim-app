import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Plus, Phone, Mail, ChevronRight, ChevronUp, ChevronDown, Pencil, Truck, MapPin, Star, CreditCard, CheckCircle2, Send, Eye, EyeOff, DollarSign, Archive, ExternalLink } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'
import { geocodeAddress } from '@/lib/mapbox'
import { newBillingRequestId } from '@/lib/billingApproval'
import { CUSTOMER_WITH_CREDIT_SUMMARY_COLUMNS } from '@/lib/customerFields'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtPeriod(label) {
  if (!label || !/^\d{4}-\d{2}$/.test(label)) return label || ''
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

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
  const openCreditTotal = (customer.customer_credits ?? [])
    .filter(c => c.status === 'open')
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

  return (
    <button
      className="w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors"
      onClick={() => onTap(customer)}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{customer.name}</p>
        {contact && <p className="text-xs text-muted-foreground mt-0.5 truncate">{contact}</p>}
        {openCreditTotal > 0 && (
          <p className="text-xs text-amber-600 mt-0.5">Credit owed ${openCreditTotal.toFixed(2)}</p>
        )}
      </div>
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  )
}

// ─── customer sheet ───────────────────────────────────────────────────────────

function CustomerSheet({ customer, isNew, onClose, onSaved }) {
  const navigate = useNavigate()
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
  const [storageTenancies, setStorageTenancies] = useState([])
  const [portableCount, setPortableCount] = useState(0)
  const [credits, setCredits]       = useState([])
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmRefundCredit, setConfirmRefundCredit] = useState(null)
  const [refundPin, setRefundPin]   = useState('')
  const [refundError, setRefundError] = useState('')
  const [archiving, setArchiving]   = useState(false)
  const [resolvingCreditId, setResolvingCreditId] = useState(null)
  const [savingCard, setSavingCard]     = useState(false)
  const [cardSaved, setCardSaved]       = useState(!!customer?.has_payment_method)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSent, setInviteSent]     = useState(false)
  const [confirmSendInvite, setConfirmSendInvite] = useState(false)
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
      supabase.from('storage_tenancies')
        .select('id, move_in_date, end_date, monthly_rate, paid_through_date, storage_units(id, unit_number), storage_payments(period_label, amount, paid_at)')
        .eq('customer_id', customer.id)
        .order('end_date', { ascending: false, nullsFirst: true }),
      supabase.from('portable_storage_rentals').select('asset_id', { count: 'exact', head: true }).eq('customer_id', customer.id),
      supabase.from('customer_credits').select('*, storage_units(unit_number)').eq('customer_id', customer.id).order('created_at', { ascending: false }),
    ]).then(([{ data: a }, { data: p }, { data: st }, { count: pc }, { data: c }]) => {
      if (a) setActive(a)
      if (p) setPast(p)
      if (st) setStorageTenancies(st)
      setPortableCount(pc ?? 0)
      if (c) setCredits(c)
      setHistoryLoading(false)
    })
  }, [customer?.id])

  async function handleArchive() {
    setArchiving(true)
    await supabase.from('customers').update({ archived_at: new Date().toISOString() }).eq('id', customer.id)
    setArchiving(false)
    onSaved()
    onClose()
  }

  async function handleRestore() {
    setArchiving(true)
    await supabase.from('customers').update({ archived_at: null }).eq('id', customer.id)
    setArchiving(false)
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
      await supabase.from('customers').insert(payload)
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

  async function handleMarkCreditRefunded(creditId) {
    setResolvingCreditId(creditId)
    setRefundError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setRefundError('Sign in again before marking this refunded.')
        return
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_credit_refunded',
          credit_id: creditId,
          billing_pin: refundPin,
          request_id: newBillingRequestId(),
        }),
      })
      const result = await res.json()
      if (!res.ok || result.error) {
        setRefundError(result.error || 'Could not mark credit refunded.')
        return
      }

      if (result.credit) setCredits(prev => prev.map(c => c.id === creditId ? result.credit : c))
      setResolvingCreditId(null)
      setConfirmRefundCredit(null)
      setRefundPin('')
      onSaved()
    } finally {
      setResolvingCreditId(null)
    }
  }

  const title = isNew ? 'New Customer' : customer?.name
  const openCredits = credits.filter(c => c.status === 'open')
  const resolvedCredits = credits.filter(c => c.status !== 'open')
  const openCreditTotal = openCredits.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

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
                <Button variant="outline" size="sm" className="gap-2" disabled={sendingInvite} onClick={() => setConfirmSendInvite(true)}>
                  <Send size={14} />
                  {inviteSent ? 'Sent!' : 'Send card invite'}
                </Button>
              )}
              {customer?.stripe_customer_id && (
                <a
                  href={`https://dashboard.stripe.com/customers/${customer.stripe_customer_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink size={14} />
                    Stripe
                  </Button>
                </a>
              )}
            </div>
          )}

          {/* Credits */}
          {!isNew && !editing && credits.length > 0 && (
            <div className="space-y-3">
              {openCreditTotal > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
                  <DollarSign size={16} className="text-amber-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-700">Credit owed ${openCreditTotal.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Prepaid storage balance not transferred to another unit</p>
                  </div>
                </div>
              )}

              {openCredits.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Open Credits</h3>
                  {openCredits.map(c => (
                    <div key={c.id} className="rounded-xl border px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">${Number(c.amount).toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.storage_units?.unit_number ? `Unit ${c.storage_units.unit_number}` : 'Storage'}
                            {c.period_labels?.length ? ` · ${c.period_labels.join(', ')}` : ''}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" disabled={resolvingCreditId === c.id} onClick={() => setConfirmRefundCredit(c)}>
                          {resolvingCreditId === c.id ? 'Saving…' : 'Mark refunded'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {resolvedCredits.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resolved Credits</h3>
                  {resolvedCredits.slice(0, 5).map(c => (
                    <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm opacity-70">
                      <span>${Number(c.amount).toFixed(2)}</span>
                      <span className="text-xs text-muted-foreground capitalize">{c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Storage history */}
          {!isNew && !historyLoading && storageTenancies.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Storage</h3>
              <div className="space-y-2">
                {storageTenancies.map(t => {
                  const isActive = !t.end_date
                  const unitNum = t.storage_units?.unit_number
                  const unitId = t.storage_units?.id
                  const payments = t.storage_payments ?? []
                  const lastPeriod = [...payments].sort((a, b) => (b.period_label || '').localeCompare(a.period_label || ''))[0]?.period_label
                  return (
                    <button
                      key={t.id}
                      onClick={() => { if (unitId) { onClose(); navigate(`/storage/${unitId}/billing`) } }}
                      className="w-full text-left flex items-center gap-3 bg-card border rounded-xl px-4 py-3 hover:bg-accent transition-colors"
                    >
                      <Archive size={14} className="text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">Unit {unitNum}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-green-500/10 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                            {isActive ? 'Active' : 'Past'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.monthly_rate ? `$${t.monthly_rate}/mo · ` : ''}
                          {payments.length} payment{payments.length !== 1 ? 's' : ''}
                          {lastPeriod ? ` · last ${fmtPeriod(lastPeriod)}` : ''}
                        </p>
                        {isActive && t.paid_through_date && (
                          <p className="text-xs text-green-600">Paid through {fmtDate(t.paid_through_date)}</p>
                        )}
                        {!isActive && t.end_date && (
                          <p className="text-xs text-muted-foreground">Ended {fmtDate(t.end_date)}</p>
                        )}
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Deployment history */}
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
            customer.archived_at ? (
              <div className="rounded-xl border border-muted bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-medium">This customer is archived</p>
                <p className="text-xs text-muted-foreground">They are hidden from the main customer list.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
                  <Button className="flex-1" disabled={archiving} onClick={handleRestore}>
                    {archiving ? 'Restoring…' : 'Restore customer'}
                  </Button>
                </div>
              </div>
            ) : confirmArchive ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                <p className="text-sm font-medium">Archive {customer.name}?</p>
                <p className="text-xs text-muted-foreground">They'll be hidden from the main list. You can restore them anytime from the archived section.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setConfirmArchive(false)}>Cancel</Button>
                  <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white" disabled={archiving} onClick={handleArchive}>
                    {archiving ? 'Archiving…' : 'Archive'}
                  </Button>
                </div>
              </div>
            ) : active.length > 0 || storageTenancies.some(t => !t.end_date) || portableCount > 0 || openCredits.length > 0 ? (
              <p className="text-xs text-muted-foreground text-center">
                Resolve active deployments, storage, and credits before archiving
              </p>
            ) : (
              <button
                onClick={() => setConfirmArchive(true)}
                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-amber-600 transition-colors py-2"
              >
                <Archive size={14} />
                Archive customer
              </button>
            )
          )}

        </div>

        <Dialog open={!!confirmRefundCredit} onOpenChange={open => {
          if (!open) {
            setConfirmRefundCredit(null)
            setRefundPin('')
            setRefundError('')
          }
        }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark credit refunded?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Confirm that ${Number(confirmRefundCredit?.amount ?? 0).toFixed(2)} was refunded to {customer?.name}. This will close the open credit.
            </p>
            <Input
              type="password"
              inputMode="numeric"
              placeholder="Billing PIN"
              value={refundPin}
              onChange={e => { setRefundPin(e.target.value); setRefundError('') }}
              autoComplete="off"
            />
            {refundError && <p className="text-xs text-destructive">{refundError}</p>}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" disabled={!!resolvingCreditId} onClick={() => setConfirmRefundCredit(null)}>
                Cancel
              </Button>
              <Button className="flex-1" disabled={!confirmRefundCredit || !!resolvingCreditId || !refundPin.trim()} onClick={() => handleMarkCreditRefunded(confirmRefundCredit.id)}>
                {resolvingCreditId ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </SheetContent>

      <Dialog open={confirmSendInvite} onOpenChange={open => !open && setConfirmSendInvite(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send card invite?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will send a Stripe payment setup link via SMS to <span className="font-medium text-foreground">{form.phone}</span>. They can use it to securely add their card on file for billing.
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmSendInvite(false)}>Cancel</Button>
            <Button className="flex-1 gap-2" disabled={sendingInvite} onClick={() => { setConfirmSendInvite(false); handleSendInvite() }}>
              <Send size={14} />
              {sendingInvite ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Customers() {
  const [customers, setCustomers]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [query, setQuery]                 = useState('')
  const [selected, setSelected]           = useState(null)
  const [adding, setAdding]               = useState(false)
  const [showArchived, setShowArchived]   = useState(false)
  const [archived, setArchived]           = useState([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [archivedLoading, setArchivedLoading] = useState(false)

  const fetchCustomers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [{ data }, { count }] = await Promise.all([
      supabase.from('customers').select(CUSTOMER_WITH_CREDIT_SUMMARY_COLUMNS).is('archived_at', null).order('name'),
      supabase.from('customers').select('id', { count: 'exact', head: true }).not('archived_at', 'is', null),
    ])
    if (data) setCustomers(data)
    setArchivedCount(count ?? 0)
    if (!silent) setLoading(false)
  }, [])

  const fetchArchived = useCallback(async () => {
    setArchivedLoading(true)
    const { data } = await supabase
      .from('customers')
      .select(CUSTOMER_WITH_CREDIT_SUMMARY_COLUMNS)
      .not('archived_at', 'is', null)
      .order('name')
    if (data) setArchived(data)
    setArchivedLoading(false)
  }, [])

  useEffect(() => {
    if (showArchived) fetchArchived()
  }, [showArchived, fetchArchived])

  const refreshSilent = useCallback(() => fetchCustomers(true), [fetchCustomers])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])
  useRealtime(['customers', 'customer_credits'], refreshSilent)

  const q = query.trim().toLowerCase()
  const filtered = customers.filter(c =>
    !q || [c.name, c.phone, c.email].some(f => f?.toLowerCase().includes(q))
  )

  function handleSaved() {
    fetchCustomers(true)
    if (showArchived) fetchArchived()
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
            {customers.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-12">No customers yet</p>
            )}
            {q && filtered.length === 0 && customers.length > 0 && (
              <p className="text-muted-foreground text-sm text-center mt-12">No customers match "{query}"</p>
            )}

            {!q && archivedCount > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 w-full"
                >
                  <Archive size={13} />
                  {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
                  {showArchived ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {showArchived && (
                  <div className="space-y-2 mt-1">
                    {archivedLoading && <p className="text-muted-foreground text-xs text-center py-4">Loading…</p>}
                    {!archivedLoading && archived.map(c => (
                      <div key={c.id} className="opacity-50">
                        <CustomerCard customer={c} onTap={setSelected} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
