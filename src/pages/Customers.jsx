import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Plus, Phone, Mail, ChevronRight, ChevronUp, ChevronDown, Pencil, Truck, MapPin, Star, CreditCard, CheckCircle2, Send, Eye, EyeOff, DollarSign, Archive, ExternalLink, Copy } from 'lucide-react'
import PinModal from '@/components/PinModal'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { formatPhone, formatPhoneInput } from '@/lib/utils'
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

function RefundSuccessView({ result, onDone }) {
  const { credit, customerName, refundedAt } = result
  const amount = Number(credit?.amount ?? 0)
  const unitNumber = credit?.storage_units?.unit_number
  const periods = credit?.period_labels ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center py-4">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
          <CheckCircle2 size={34} className="text-green-500" />
        </div>
        <p className="text-xl font-bold">Refund recorded</p>
        <p className="text-sm text-muted-foreground mt-1">
          ${amount.toFixed(2)} marked refunded
        </p>
      </div>

      <div className="rounded-xl border overflow-hidden text-sm">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receipt</p>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <DollarSign size={12} />
            Refund
          </span>
        </div>
        <div className="divide-y">
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium">{customerName || 'Customer'}</span>
          </div>
          {unitNumber && (
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Unit</span>
              <span className="font-medium">{unitNumber}</span>
            </div>
          )}
          {periods.length > 0 && (
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Periods</span>
              <span className="font-medium text-right">{periods.map(fmtPeriod).join(', ')}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-2.5 font-semibold">
            <span>Total refunded</span>
            <span className="text-green-600">${amount.toFixed(2)}</span>
          </div>
          {refundedAt && (
            <div className="flex justify-between px-4 py-2.5 bg-green-500/5">
              <span className="text-muted-foreground">Recorded</span>
              <span className="font-medium text-green-700">{fmtDate(refundedAt)}</span>
            </div>
          )}
        </div>
      </div>

      <Button className="w-full" onClick={onDone}>Done</Button>
    </div>
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
      ? { name: customer.name ?? '', phone: formatPhone(customer.phone ?? ''), email: customer.email ?? '', address: customer.address ?? '', notes: customer.notes ?? '' }
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
  const [refundSuccess, setRefundSuccess] = useState(null)
  const [archiving, setArchiving]   = useState(false)
  const [resolvingCreditId, setResolvingCreditId] = useState(null)
  const [savingCard, setSavingCard]     = useState(false)
  const cardSaved = !!customer?.has_payment_method
  const [copyingCardLink, setCopyingCardLink] = useState(false)
  const [cardLinkCopied, setCardLinkCopied] = useState(false)
  const [cardLinkError, setCardLinkError] = useState('')
  const [showCardLinkInline, setShowCardLinkInline] = useState(false)
  const [cardLinkUrl, setCardLinkUrl] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSent, setInviteSent]     = useState(false)
  const [confirmSendInvite, setConfirmSendInvite] = useState(false)
  const [showPin, setShowPin]           = useState(false)

  useEffect(() => {
    if (!customer) return
    setRefundSuccess(null)
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

  async function createStripeSetupUrl({ invite = false } = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sign in again before creating a Stripe link.')

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-setup-session`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customer.id,
        origin: window.location.origin,
        link_type: invite ? 'invite' : 'checkout',
      }),
    })
    const result = await res.json()
    if (!res.ok || result.error || !result.url) {
      throw new Error(result.error || `Could not create Stripe ${invite ? 'invite' : 'link'}.`)
    }
    return result.url
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return
      } catch (err) {
        console.warn('Clipboard API failed, falling back to manual copy:', err)
      }
    }

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!copied) throw new Error('Could not copy card invite.')
  }

  async function handleSaveCard() {
    setSavingCard(true)
    setCardLinkError('')
    const tab = window.open('', '_blank')
    try {
      const url = await createStripeSetupUrl()
      if (tab) tab.location.href = url
    } catch (err) {
      console.error('stripe-setup-session error:', err)
      setCardLinkError(err instanceof Error ? err.message : 'Could not create Stripe link.')
      if (tab) tab.close()
    } finally {
      setSavingCard(false)
    }
  }

  async function handleCopyCardLink() {
    setCopyingCardLink(true)
    setCardLinkError('')
    try {
      const url = await createStripeSetupUrl({ invite: true })
      setCardLinkUrl(url)
      setShowCardLinkInline(true)
    } catch (err) {
      console.error('copy stripe setup link error:', err)
      setCardLinkError(err instanceof Error ? err.message : 'Could not copy card invite.')
    } finally {
      setCopyingCardLink(false)
    }
  }

  async function handleSendInvite(pin) {
    setSendingInvite(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before sending this invite.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-card-invite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const result = await res.json()
      if (!res.ok || result.error) return { error: result.error || 'Could not send card invite.' }

      setConfirmSendInvite(false)
      setInviteSent(true)
      setTimeout(() => setInviteSent(false), 3000)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not send card invite.' }
    } finally {
      setSendingInvite(false)
    }
  }

  async function handleMarkCreditRefunded(creditId, pin) {
    setResolvingCreditId(creditId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: 'Sign in again before marking this refunded.' }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-billing-run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_credit_refunded',
          credit_id: creditId,
          billing_pin: pin,
          request_id: newBillingRequestId(),
        }),
      })
      const result = await res.json()
      if (!res.ok || result.error) return { error: result.error || 'Could not mark credit refunded.' }

      if (result.credit) setCredits(prev => prev.map(c => c.id === creditId ? result.credit : c))
      setRefundSuccess({
        credit: result.credit ?? credits.find(c => c.id === creditId),
        customerName: customer?.name,
        refundedAt: result.credit?.resolved_at ?? new Date().toISOString(),
      })
      setConfirmRefundCredit(null)
      onSaved()
    } finally {
      setResolvingCreditId(null)
    }
  }

  const title = isNew ? 'New Customer' : customer?.name
  const openCredits = credits.filter(c => c.status === 'open')
  const resolvedCredits = credits.filter(c => c.status !== 'open')
  const openCreditTotal = openCredits.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const pinModalOpen = !!confirmRefundCredit || confirmSendInvite

  function handleSheetOpenChange(open) {
    if (open) return
    if (pinModalOpen) return
    onClose()
  }

  function handleSheetInteractOutside(event) {
    if (pinModalOpen) event.preventDefault()
  }

  return (
    <Sheet open onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
        onPointerDownOutside={handleSheetInteractOutside}
        onInteractOutside={handleSheetInteractOutside}
      >
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center justify-between pr-6">
            <span>{title}</span>
            {!refundSuccess && !isNew && !editing && (
              <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground">
                <Pencil size={16} />
              </button>
            )}
          </SheetTitle>
        </SheetHeader>

        {refundSuccess ? (
          <RefundSuccessView result={refundSuccess} onDone={() => setRefundSuccess(null)} />
        ) : (
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
              {customer?.payment_pin && (
                <button onClick={() => setShowPin(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Payment PIN <span className="font-mono font-semibold text-foreground tracking-widest">{showPin ? customer.payment_pin : '•••••'}</span>
                  {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
              )}
            </div>
          )}

          {/* Card on file */}
          {!isNew && !editing && (
            <div className="space-y-2">
              {showCardLinkInline ? (
                <div className="space-y-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-blue-700">Stripe card setup link</p>
                    <button
                      onClick={() => setShowCardLinkInline(false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="bg-background border rounded-lg p-3 text-xs font-mono break-all text-muted-foreground select-all">
                    {cardLinkUrl}
                  </div>
                  <p className="text-xs text-blue-600">Tap and hold to select all, then copy</p>
                </div>
              ) : (
                <>
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
                    <Button variant="outline" size="sm" className="gap-2" disabled={copyingCardLink} onClick={handleCopyCardLink}>
                      <Copy size={14} />
                      {copyingCardLink ? 'Getting link…' : 'Copy invite'}
                    </Button>
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
                  {cardLinkError && <p className="text-xs text-destructive">{cardLinkError}</p>}
                </>
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
        )}

      </SheetContent>

      <PinModal
        open={!!confirmRefundCredit}
        onClose={() => setConfirmRefundCredit(null)}
        onConfirm={pin => confirmRefundCredit
          ? handleMarkCreditRefunded(confirmRefundCredit.id, pin)
          : { error: 'No credit selected.' }
        }
        loading={!!resolvingCreditId}
        title="Mark credit refunded"
        subtitle="Enter billing PIN to confirm"
        icon={DollarSign}
        confirmLabel="Confirm refund"
      >
        <div className="rounded-xl border divide-y text-sm bg-muted/40">
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium">{customer?.name}</span>
          </div>
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">${Number(confirmRefundCredit?.amount ?? 0).toFixed(2)}</span>
          </div>
        </div>
      </PinModal>

      <PinModal
        open={confirmSendInvite}
        onClose={() => !sendingInvite && setConfirmSendInvite(false)}
        onConfirm={handleSendInvite}
        loading={sendingInvite}
        title="Send card invite"
        subtitle="Enter billing PIN to send setup link"
        icon={Send}
        confirmLabel="Send invite"
      >
        <div className="rounded-xl border divide-y text-sm bg-muted/40">
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium text-right">{customer?.name}</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <span className="text-muted-foreground">SMS to</span>
            <span className="font-medium text-right">{formatPhone(form.phone)}</span>
          </div>
        </div>
      </PinModal>
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
