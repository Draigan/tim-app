import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCheck, CheckCircle2, MoreHorizontal, Plus, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import PinModal from '@/components/PinModal'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const ADMIN_SHARE = 0.25
const START_DATE = '2026-06-05'
const CUSTOMER_STORAGE_TYPE_LABELS = { boat: 'Boat', trailer: 'Trailer', rv: 'RV', custom: 'Custom' }
const PAYMENT_METHOD_LABELS = { stripe: 'Stripe', cash: 'Cash', untracked: 'Untracked' }

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function tenancyLabel(tenancy, unit) {
  if (tenancy?.storage_kind === 'customer_item') {
    const type = tenancy.item_type === 'custom'
      ? tenancy.custom_item_type || 'Custom'
      : CUSTOMER_STORAGE_TYPE_LABELS[tenancy.item_type] ?? 'Storage'
    return tenancy.item_label ? `${type} ${tenancy.item_label}` : type
  }
  return unit ? `Unit ${unit.unit_number}` : 'Unknown unit'
}

function inferPaymentMethod(type, taxAmount) {
  if (type === 'manual') return 'cash'
  return Number(taxAmount || 0) > 0 ? 'stripe' : 'cash'
}

function paymentMethodForRow(type, taxAmount, paymentMethod) {
  if (paymentMethod === 'stripe' || paymentMethod === 'cash') return paymentMethod
  return inferPaymentMethod(type, taxAmount)
}

function methodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] ?? PAYMENT_METHOD_LABELS.untracked
}

function emptyMethodTotals() {
  return { stripe: 0, cash: 0, untracked: 0 }
}

function methodBreakdown(payments) {
  return payments.reduce((totals, payment) => {
    totals[payment.paymentMethod] = (totals[payment.paymentMethod] ?? 0) + payment.remaining
    return totals
  }, emptyMethodTotals())
}

function methodBreakdownText(totals) {
  return [
    `Stripe $${totals.stripe.toFixed(2)}`,
    `Cash $${totals.cash.toFixed(2)}`,
    totals.untracked > 0.01 ? `Untracked $${totals.untracked.toFixed(2)}` : null,
  ].filter(Boolean).join(' · ')
}

export default function AdminRevenue() {
  const navigate = useNavigate()
  const [payments, setPayments] = useState([])
  const [hiddenPayments, setHiddenPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(null)
  const [acceptModal, setAcceptModal] = useState(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [manualModal, setManualModal] = useState(false)
  const [manualAmount, setManualAmount] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [markAllPinOpen, setMarkAllPinOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [markClientModal, setMarkClientModal] = useState(null)
  const [markingClient, setMarkingClient] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      { data: fixedPayments },
      { data: tenancies },
      { data: storageUnits },
      { data: portablePayments },
      { data: portableAssets },
      { data: portableRentals },
      { data: manualPayments },
      { data: received },
      { data: hidden },
    ] = await Promise.all([
      supabase.from('storage_payments').select('*').gte('paid_at', START_DATE).order('paid_at', { ascending: false }),
      supabase.from('storage_tenancies').select('id, unit_id, customer_id, storage_kind, item_type, custom_item_type, item_label, tenant_name, customers(name)'),
      supabase.from('storage_units').select('id, unit_number'),
      supabase.from('portable_storage_payments').select('*').gte('paid_at', START_DATE).order('paid_at', { ascending: false }),
      supabase.from('assets').select('id, label, size'),
      supabase.from('portable_storage_rentals').select('asset_id, customer_id, tenant_name, customers(name)'),
      supabase.from('admin_manual_payments').select('id, amount, note, paid_at').gte('paid_at', START_DATE).order('paid_at', { ascending: false }),
      supabase.from('admin_payment_received').select('payment_type, payment_id, amount_received'),
      supabase.from('admin_payment_hidden').select('payment_type, payment_id'),
    ])

    const tenancyMap = new Map((tenancies ?? []).map(t => [t.id, t]))
    const unitMap    = new Map((storageUnits ?? []).map(u => [u.id, u]))
    const assetMap   = new Map((portableAssets ?? []).map(a => [a.id, a]))
    const rentalMap  = new Map((portableRentals ?? []).map(r => [r.asset_id, r]))
    const hiddenSet  = new Set((hidden ?? []).map(r => `${r.payment_type}:${r.payment_id}`))

    const receivedMap = new Map()
    for (const r of (received ?? [])) {
      const key = `${r.payment_type}:${r.payment_id}`
      receivedMap.set(key, (receivedMap.get(key) ?? 0) + Number(r.amount_received || 0))
    }

    function buildRow(type, id, label, tenantName, amount, subtotalAmount, taxAmount, paidAt, clientKey = null, paymentMethod = null) {
      const revenueAmount = subtotalAmount ?? amount
      const adminShare    = revenueAmount * ADMIN_SHARE
      const totalReceived = receivedMap.get(`${type}:${id}`) ?? 0
      const clientName    = tenantName?.trim() || 'Unknown client'
      return {
        key: `${type}:${id}`, id, type, label, tenantName,
        clientKey: clientKey || (tenantName?.trim() ? `tenant:${tenantName.trim().toLowerCase()}` : `payment:${type}:${id}`),
        clientName,
        paymentMethod: paymentMethodForRow(type, taxAmount, paymentMethod),
        amount, subtotalAmount: revenueAmount, taxAmount, adminShare, totalReceived,
        remaining: adminShare - totalReceived,
        paidAt,
      }
    }

    const fixedRows = (fixedPayments ?? []).map(p => {
      const tenancy = tenancyMap.get(p.tenancy_id)
      const unit    = tenancy ? unitMap.get(tenancy.unit_id) : null
      return buildRow(
        'fixed', p.id,
        tenancyLabel(tenancy, unit),
        tenancy?.customers?.name || tenancy?.tenant_name || null,
        Number(p.amount || 0),
        p.subtotal_amount === null || p.subtotal_amount === undefined ? null : Number(p.subtotal_amount || 0),
        Number(p.tax_amount || 0),
        p.paid_at,
        tenancy?.customer_id ? `customer:${tenancy.customer_id}` : null,
        p.payment_method
      )
    })

    const portableRows = (portablePayments ?? []).map(p => {
      const asset  = assetMap.get(p.asset_id)
      const rental = rentalMap.get(p.asset_id)
      return buildRow(
        'portable', p.id,
        asset ? asset.label + (asset.size ? ` · ${asset.size}` : '') : 'Unknown',
        rental?.customers?.name || rental?.tenant_name || null,
        Number(p.amount || 0),
        p.subtotal_amount === null || p.subtotal_amount === undefined ? null : Number(p.subtotal_amount || 0),
        Number(p.tax_amount || 0),
        p.paid_at,
        rental?.customer_id ? `customer:${rental.customer_id}` : null,
        p.payment_method
      )
    })

    const manualRows = (manualPayments ?? []).map(p => buildRow(
      'manual', p.id,
      'Cash payment',
      p.note || null,
      Number(p.amount || 0),
      Number(p.amount || 0),
      0,
      p.paid_at,
      null,
      'cash'
    ))

    const all = [...fixedRows, ...portableRows, ...manualRows].sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
    setPayments(all.filter(p => !hiddenSet.has(p.key)))
    setHiddenPayments(all.filter(p => hiddenSet.has(p.key)))
    setLoading(false)
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(load, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  async function hidePayment(payment) {
    await supabase.from('admin_payment_hidden').insert({ payment_type: payment.type, payment_id: payment.id })
    setMenuOpen(null)
    setPayments(prev => prev.filter(p => p.key !== payment.key))
    setHiddenPayments(prev => [...prev, payment])
  }

  async function unhidePayment(payment) {
    await supabase.from('admin_payment_hidden').delete().eq('payment_type', payment.type).eq('payment_id', payment.id)
    setMenuOpen(null)
    setHiddenPayments(prev => prev.filter(p => p.key !== payment.key))
    setPayments(prev => [...prev, payment].sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)))
  }

  async function recordReceived(payment, amount) {
    setSaving(true)
    await supabase.from('admin_payment_received').insert({
      payment_type: payment.type,
      payment_id:   payment.id,
      amount_received: Number(Number(amount).toFixed(2)),
    })
    setSaving(false)
    setAcceptModal(null)
    setPartialAmount('')
    load()
  }

  async function markAllReceived(pin) {
    if (pin !== '4321') return { error: 'Incorrect PIN' }

    const outstanding = payments.filter(p => p.remaining > 0.01)
    if (outstanding.length === 0) {
      setMarkAllPinOpen(false)
      return { ok: true }
    }

    setMarkingAll(true)
    const { error } = await supabase.from('admin_payment_received').insert(
      outstanding.map(p => ({
        payment_type: p.type,
        payment_id: p.id,
        amount_received: Number(p.remaining.toFixed(2)),
      }))
    )
    setMarkingAll(false)

    if (error) {
      console.error('mark all received failed', error)
      return { error: error.message || 'Could not mark all as received.' }
    }

    setMarkAllPinOpen(false)
    await load()
    return { ok: true }
  }

  async function markClientReceived(pin) {
    if (pin !== '4321') return { error: 'Incorrect PIN' }
    if (!markClientModal) return { error: 'No client selected.' }

    const outstanding = payments.filter(p => p.clientKey === markClientModal.clientKey && p.remaining > 0.01)
    if (outstanding.length === 0) {
      setMarkClientModal(null)
      return { ok: true }
    }

    setMarkingClient(true)
    const { error } = await supabase.from('admin_payment_received').insert(
      outstanding.map(p => ({
        payment_type: p.type,
        payment_id: p.id,
        amount_received: Number(p.remaining.toFixed(2)),
      }))
    )
    setMarkingClient(false)

    if (error) {
      console.error('mark client received failed', error)
      return { error: error.message || 'Could not mark this client as received.' }
    }

    setMarkClientModal(null)
    await load()
    return { ok: true }
  }

  async function addManualPayment() {
    const amount = Number(manualAmount)
    if (!Number.isFinite(amount) || amount <= 0) return

    setSaving(true)
    const { error } = await supabase.from('admin_manual_payments').insert({
      amount: Number(amount.toFixed(2)),
      note: manualNote.trim() || null,
    })
    setSaving(false)

    if (error) {
      console.error('manual payment insert failed', error)
      return
    }

    setManualModal(false)
    setManualAmount('')
    setManualNote('')
    load()
  }

  const pending      = payments.filter(p => p.remaining > 0.01)
  const totalPending = pending.reduce((s, p) => s + p.remaining, 0)
  const pendingTotalsByMethod = methodBreakdown(pending)
  const pendingClientGroups = [...pending.reduce((groups, payment) => {
    const group = groups.get(payment.clientKey) ?? {
      clientKey: payment.clientKey,
      clientName: payment.clientName,
      payments: [],
      total: 0,
      methodTotals: emptyMethodTotals(),
    }
    group.payments.push(payment)
    group.total += payment.remaining
    group.methodTotals[payment.paymentMethod] = (group.methodTotals[payment.paymentMethod] ?? 0) + payment.remaining
    groups.set(payment.clientKey, group)
    return groups
  }, new Map()).values()]
    .filter(group => group.payments.length > 1)
    .sort((a, b) => b.total - a.total || b.payments.length - a.payments.length || a.clientName.localeCompare(b.clientName))
  const grossTotal    = payments.reduce((s, p) => s + p.amount, 0)
  const grossSubtotal = payments.reduce((s, p) => s + p.subtotalAmount, 0)
  const manualAmountValue = Number(manualAmount)
  const manualCut = Number.isFinite(manualAmountValue) && manualAmountValue > 0 ? manualAmountValue * ADMIN_SHARE : 0

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
        <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-semibold">Admin</h1>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setManualModal(true)}>
          <Plus size={14} />
          Add cash
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Gross */}
        {!loading && payments.length > 0 && (
          <div className="bg-card border rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground">Gross · {payments.length} entr{payments.length !== 1 ? 'ies' : 'y'}</p>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <div>
                <p className="text-2xl font-bold">${grossSubtotal.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Before taxes</p>
              </div>
              <div>
                <p className="text-2xl font-bold">${grossTotal.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">After taxes</p>
              </div>
            </div>
          </div>
        )}

        {/* Summary strip */}
        {!loading && payments.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              <p className="text-lg font-bold text-amber-600">${totalPending.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{pending.length} pending</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {methodBreakdownText(pendingTotalsByMethod)}
              </p>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
              <p className="text-lg font-bold text-green-600">
                ${payments.reduce((s, p) => s + p.totalReceived, 0).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{payments.filter(p => p.remaining <= 0.01).length} received</p>
            </div>
          </div>
        )}

        {!loading && pending.length > 0 && (
          <Button variant="outline" className="w-full gap-2" onClick={() => setMarkAllPinOpen(true)}>
            <CheckCheck size={16} />
            Mark all {pending.length} received (${totalPending.toFixed(2)})
          </Button>
        )}

        {!loading && pendingClientGroups.length > 0 && (
          <div className="bg-card border rounded-xl px-4 py-3 space-y-3">
            <div>
              <p className="text-sm font-semibold">Pending by client</p>
              <p className="text-xs text-muted-foreground">Mark every pending receipt for one client.</p>
            </div>
            <div className="space-y-2">
              {pendingClientGroups.map(group => (
                <div key={group.clientKey} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{group.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.payments.length} payment{group.payments.length !== 1 ? 's' : ''} · ${group.total.toFixed(2)} owed
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {methodBreakdownText(group.methodTotals)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0 gap-1.5"
                    onClick={() => setMarkClientModal(group)}
                  >
                    <UserCheck size={14} />
                    Received
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
        ) : payments.length === 0 ? (
          <div className="text-center py-12 space-y-1">
            <p className="text-sm font-medium">No payments yet</p>
            <p className="text-xs text-muted-foreground">Payments recorded from today will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map(payment => {
              const isFullyReceived = payment.remaining <= 0.01
              const isPartial       = payment.totalReceived > 0.01 && !isFullyReceived
              const isManual        = payment.type === 'manual'

              return (
                <div
                  key={payment.key}
                  className={cn(
                    'bg-card border-l-4 border rounded-xl overflow-hidden',
                    isFullyReceived ? 'border-l-green-500' : 'border-l-amber-500'
                  )}
                >
                  <div className="px-4 py-3 space-y-3">

                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{payment.label}</p>
                        {payment.tenantName && (
                          <p className="text-xs text-muted-foreground truncate">{payment.tenantName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className="text-xs text-muted-foreground">{fmtDate(payment.paidAt)}</p>
                        <button
                          onClick={() => setMenuOpen(menuOpen === payment.key ? null : payment.key)}
                          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Amounts row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">
                          ${payment.amount.toFixed(2)} {methodLabel(payment.paymentMethod)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ${payment.subtotalAmount.toFixed(2)} {isManual ? 'total' : 'rent'}
                          {!isManual && payment.taxAmount > 0 ? ` · $${payment.taxAmount.toFixed(2)} HST` : ''}
                          {' · '}
                          <span className="font-semibold text-foreground">your cut: ${payment.adminShare.toFixed(2)}</span>
                        </p>
                        {isPartial && (
                          <p className="text-xs text-amber-600">
                            ${payment.totalReceived.toFixed(2)} received · ${payment.remaining.toFixed(2)} still owed
                          </p>
                        )}
                        {isFullyReceived && (
                          <p className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 size={11} /> Received ${payment.totalReceived.toFixed(2)}
                          </p>
                        )}
                      </div>

                      {!isFullyReceived && (
                        <button
                          onClick={() => { setPartialAmount(''); setAcceptModal(payment) }}
                          className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                          Record receipt
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ··· menu */}
                  {menuOpen === payment.key && (
                    <div className="border-t px-4 py-2.5 bg-muted/40 flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Remove this payment from the list?</p>
                      <div className="flex gap-4">
                        <button onClick={() => setMenuOpen(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                        <button onClick={() => hidePayment(payment)} className="text-xs font-medium text-destructive hover:text-destructive/80">Hide</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Hidden records toggle */}
        {!loading && hiddenPayments.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowHidden(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              {showHidden ? 'Hide' : `Show ${hiddenPayments.length} hidden record${hiddenPayments.length !== 1 ? 's' : ''}`}
            </button>
            {showHidden && (
              <div className="mt-3 space-y-2">
                {hiddenPayments.map(payment => (
                  <div key={payment.key} className="bg-muted/40 border border-dashed rounded-xl overflow-hidden opacity-60">
                    <div className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">{payment.label}</p>
                          {payment.tenantName && (
                            <p className="text-xs text-muted-foreground truncate">{payment.tenantName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p className="text-xs text-muted-foreground">{fmtDate(payment.paidAt)}</p>
                          <button
                            onClick={() => setMenuOpen(menuOpen === payment.key ? null : payment.key)}
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ${payment.amount.toFixed(2)} {methodLabel(payment.paymentMethod)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ${payment.subtotalAmount.toFixed(2)} {payment.type === 'manual' ? 'total' : 'rent'}
                        {payment.type !== 'manual' && payment.taxAmount > 0 ? ` · $${payment.taxAmount.toFixed(2)} HST` : ''}
                        {' · '}
                        <span className="font-semibold text-foreground">your cut: ${payment.adminShare.toFixed(2)}</span>
                      </p>
                    </div>
                    {menuOpen === payment.key && (
                      <div className="border-t px-4 py-2.5 bg-muted/40 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">Restore this payment?</p>
                        <div className="flex gap-4">
                          <button onClick={() => setMenuOpen(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                          <button onClick={() => unhidePayment(payment)} className="text-xs font-medium text-primary hover:text-primary/80">Unhide</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Accept modal */}
      <Sheet open={!!acceptModal} onOpenChange={v => { if (!v) { setAcceptModal(null); setPartialAmount('') } }}>
        <SheetContent side="bottom" className="max-h-[75vh]">
          <SheetHeader className="mb-4">
            <SheetTitle>Record payment received</SheetTitle>
          </SheetHeader>
          {acceptModal && (() => {
            const isManual = acceptModal.type === 'manual'
            return (
            <div className="space-y-4">
              <div className="rounded-xl border divide-y text-sm">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">{isManual ? 'Source' : 'Unit'}</span>
                  <span className="font-medium">{acceptModal.label}</span>
                </div>
                {acceptModal.tenantName && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">{isManual ? 'Note' : 'Tenant'}</span>
                    <span className="font-medium">{acceptModal.tenantName}</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">{isManual ? 'Cash received' : 'Tenant paid'}</span>
                  <span className="font-medium">${acceptModal.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Payment source</span>
                  <span className="font-medium">{methodLabel(acceptModal.paymentMethod)}</span>
                </div>
                {!isManual && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">Rent before tax</span>
                    <span className="font-medium">${acceptModal.subtotalAmount.toFixed(2)}</span>
                  </div>
                )}
                {!isManual && acceptModal.taxAmount > 0 && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">HST</span>
                    <span className="font-medium">${acceptModal.taxAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">{isManual ? 'Your 25% cut' : 'Your 25% of rent'}</span>
                  <span className="font-medium">${acceptModal.adminShare.toFixed(2)}</span>
                </div>
                {acceptModal.totalReceived > 0.01 && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">Already received</span>
                    <span className="font-medium text-green-600">${acceptModal.totalReceived.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-2.5 font-semibold">
                  <span>You are owed</span>
                  <span className="text-amber-600">${acceptModal.remaining.toFixed(2)}</span>
                </div>
              </div>

              <Button
                className="w-full gap-2"
                disabled={saving}
                onClick={() => recordReceived(acceptModal, acceptModal.remaining)}
              >
                <CheckCircle2 size={14} />
                {saving ? 'Saving…' : `Received full amount ($${acceptModal.remaining.toFixed(2)})`}
              </Button>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Received a partial amount instead?</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={partialAmount}
                      onChange={e => setPartialAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={saving || !partialAmount || Number(partialAmount) <= 0}
                    onClick={() => recordReceived(acceptModal, partialAmount)}
                  >
                    {saving ? 'Saving…' : 'Record partial'}
                  </Button>
                </div>
              </div>
            </div>
          )})()}
        </SheetContent>
      </Sheet>

      {/* Manual cash modal */}
      <Sheet open={manualModal} onOpenChange={v => {
        setManualModal(v)
        if (!v) {
          setManualAmount('')
          setManualNote('')
        }
      }}>
        <SheetContent side="bottom" className="max-h-[75vh]">
          <SheetHeader className="mb-4">
            <SheetTitle>Add cash payment</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="manual-cash-amount">Cash amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="manual-cash-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualAmount}
                  onChange={e => setManualAmount(e.target.value)}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="manual-cash-note">Note</label>
              <Input
                id="manual-cash-note"
                value={manualNote}
                onChange={e => setManualNote(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="rounded-xl border divide-y text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Cash amount</span>
                <span className="font-medium">${(Number.isFinite(manualAmountValue) && manualAmountValue > 0 ? manualAmountValue : 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Your 25% cut</span>
                <span className="font-semibold">${manualCut.toFixed(2)}</span>
              </div>
            </div>

            <Button
              className="w-full gap-2"
              disabled={saving || !Number.isFinite(manualAmountValue) || manualAmountValue <= 0}
              onClick={addManualPayment}
            >
              <Plus size={14} />
              {saving ? 'Saving…' : 'Add cash payment'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <PinModal
        open={markAllPinOpen}
        onClose={() => !markingAll && setMarkAllPinOpen(false)}
        onConfirm={markAllReceived}
        loading={markingAll}
        title="Mark all received"
        subtitle={`Confirm you received all ${pending.length} pending payment${pending.length !== 1 ? 's' : ''} ($${totalPending.toFixed(2)})`}
        icon={CheckCheck}
        pinLabel="Enter admin PIN"
        confirmLabel="Mark all received"
      />

      <PinModal
        open={!!markClientModal}
        onClose={() => !markingClient && setMarkClientModal(null)}
        onConfirm={markClientReceived}
        loading={markingClient}
        title="Mark client received"
        subtitle={markClientModal
          ? `Confirm ${markClientModal.payments.length} pending payment${markClientModal.payments.length !== 1 ? 's' : ''} from ${markClientModal.clientName} ($${markClientModal.total.toFixed(2)})`
          : ''}
        icon={UserCheck}
        pinLabel="Enter admin PIN"
        confirmLabel="Mark client received"
      />
    </div>
  )
}
