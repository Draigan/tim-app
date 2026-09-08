import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Printer, RefreshCw, Search, AlertTriangle, CreditCard, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import PinModal from '@/components/PinModal'
import {
  loadOnlinePaymentRows,
  fmtDate,
  localDateStr,
  isUnknownCustomer,
  isTestBookingRow,
} from '@/lib/onlinePaymentsData'
import {
  SELLER,
  HST_REGISTRATION_NUMBER,
  TERMS_NOTE,
  addressLines,
  billToFromSources,
  buildInvoice,
  fetchStripeBillingDetails,
  groupRowsByCustomer,
  invoiceNumberFor,
  saveBillingIdentity,
} from '@/lib/invoices'

// Invoices are built from our own payment records — those are the only place
// the HST split exists, since we add tax before handing Stripe a single total.
// The "Bill to" block is pulled from Stripe, because the cardholder name and
// billing address Stripe holds are usually more accurate (and more correct for
// a tax invoice) than the contact we have on file.

function cad(value) {
  const amount = Number(value) || 0
  return `CA$${amount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function longDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })
}

function startOfYearStr() {
  return `${new Date().getFullYear()}-01-01`
}

function taxRateLabel(entry) {
  if (!entry.rate) return entry.label
  return `${entry.label} (${(entry.rate * 100).toFixed(entry.rate * 100 % 1 === 0 ? 0 : 2)}%)`
}

export default function Invoices() {
  const navigate = useNavigate()
  // Same gate and same PIN as Online Payments: it is the same tax data.
  const [sectionUnlocked, setSectionUnlocked] = useState(
    () => sessionStorage.getItem('onlinePaymentsUnlocked') === '1'
  )

  const [dateFrom, setDateFrom] = useState(startOfYearStr)
  const [dateTo, setDateTo] = useState(() => localDateStr())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const [invoiceNumberOverride, setInvoiceNumberOverride] = useState(null)
  const [issueDate, setIssueDate] = useState(() => localDateStr())

  const [billTo, setBillTo] = useState({ name: '', address: '', email: '', phone: '' })
  const billToEdited = useRef(false)
  const [stripeDetails, setStripeDetails] = useState(null)
  const [stripeLoading, setStripeLoading] = useState(false)
  const [stripeError, setStripeError] = useState('')

  // The billing identity stored against the selected customer, so the fields can
  // tell "already saved" apart from "edited but not saved yet".
  const [savedBilling, setSavedBilling] = useState({ name: '', address: '' })
  const [billingSaving, setBillingSaving] = useState(false)
  const [billingError, setBillingError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setRows(await loadOnlinePaymentRows({ dateFrom, dateTo }))
    } catch (error) {
      setLoadError(error.message ?? 'Could not load payments')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (sectionUnlocked) load()
  }, [sectionUnlocked, load])

  const customers = useMemo(() => {
    const billable = rows.filter(row => !isUnknownCustomer(row) && !isTestBookingRow(row))
    const groups = groupRowsByCustomer(billable)
    const search = query.trim().toLowerCase()
    if (!search) return groups
    return groups.filter(group =>
      group.name.toLowerCase().includes(search) || (group.email ?? '').toLowerCase().includes(search)
    )
  }, [rows, query])

  const selected = useMemo(
    () => customers.find(group => group.key === selectedKey) ?? null,
    [customers, selectedKey]
  )

  const selectedRows = useMemo(
    () => (selected ? selected.rows.filter(row => selectedIds.has(row.id)) : []),
    [selected, selectedIds]
  )

  const invoice = useMemo(() => buildInvoice(selectedRows), [selectedRows])

  // Both fields match what is on file, so there is nothing to save.
  const billingStored = Boolean(savedBilling.name)
    && billTo.name.trim() === savedBilling.name
    && billTo.address.trim() === savedBilling.address

  // Derived, not stored: a given customer + selection always yields the same
  // number, so reprinting one invoice never mints a second number for one sale.
  // Typing in the field pins an override until the selection changes.
  const autoInvoiceNumber = useMemo(
    () => (selected && selectedRows.length
      ? invoiceNumberFor(selected.key, selectedRows.map(row => row.id))
      : ''),
    [selected, selectedRows]
  )
  const invoiceNumber = invoiceNumberOverride ?? autoInvoiceNumber

  // Chrome and Safari name a print-to-PDF file after the document title, so the
  // invoice number becomes the filename and cannot drift from the number on the
  // sheet. Captured once, since each run would otherwise restore the previous
  // invoice's title rather than the app's.
  const baseTitle = useRef(typeof document === 'undefined' ? '' : document.title)
  useEffect(() => {
    const base = baseTitle.current
    if (invoiceNumber) document.title = `Invoice-${invoiceNumber}`
    return () => { document.title = base }
  }, [invoiceNumber])

  const pullFromStripe = useCallback(async (customerId, stored = { name: '', address: '' }) => {
    if (!customerId) {
      setStripeError('This customer is not linked to a Stripe record, so there is nothing to pull.')
      return
    }
    setStripeLoading(true)
    setStripeError('')
    try {
      const details = await fetchStripeBillingDetails(customerId)
      setStripeDetails(details)
      if (!billToEdited.current) {
        const resolved = billToFromSources({
          stripe: details,
          fallback: null,
          billingName: stored.name,
          billingAddress: stored.address,
        })
        setBillTo(current => ({
          name: resolved.name || current.name,
          address: resolved.addressLines.length ? resolved.addressLines.join('\n') : current.address,
          email: resolved.email || current.email,
          phone: resolved.phone || current.phone,
        }))
      }
    } catch (error) {
      setStripeDetails(null)
      setStripeError(error.message ?? 'Could not reach Stripe')
    } finally {
      setStripeLoading(false)
    }
  }, [])

  function selectCustomer(group) {
    setSelectedKey(group.key)
    setSelectedIds(new Set(group.rows.map(row => row.id)))
    setInvoiceNumberOverride(null)
    billToEdited.current = false
    setStripeDetails(null)
    setStripeError('')
    const stored = { name: group.billingName ?? '', address: group.billingAddress ?? '' }
    setSavedBilling(stored)
    setBillingError('')
    setBillTo({
      name: stored.name || (group.name === 'Unknown customer' ? '' : group.name),
      address: addressLines(stored.address || group.address).join('\n'),
      email: group.email ?? '',
      phone: group.phone ?? '',
    })
    if (group.customerId) pullFromStripe(group.customerId, stored)
  }

  // Saved on blur rather than behind a button: an edited Bill-to field reads as
  // saved whether or not anything was pressed, and losing it on refresh is
  // worse than storing a name that later needs changing. Only fires once the
  // field has actually been typed in, so a value Stripe filled in is never
  // frozen as an override.
  function storeBillingIdentityOnBlur() {
    if (!selected?.customerId || !billToEdited.current || billingSaving) return
    if (billTo.name.trim() === savedBilling.name && billTo.address.trim() === savedBilling.address) return
    storeBillingIdentity()
  }

  // Remembered against the customer so the next invoice starts here, ahead of
  // anything Stripe reports.
  async function storeBillingIdentity() {
    if (!selected?.customerId) return
    const stored = { name: billTo.name.trim(), address: billTo.address.trim() }
    setBillingSaving(true)
    setBillingError('')
    try {
      await saveBillingIdentity(selected.customerId, stored)
      setSavedBilling(stored)
      setRows(current => current.map(row => (
        row.customerId === selected.customerId
          ? { ...row, billingName: stored.name, billingAddress: stored.address }
          : row
      )))
    } catch (error) {
      setBillingError(error.message ?? 'Could not save the billing details')
    } finally {
      setBillingSaving(false)
    }
  }

  function toggleRow(id) {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateBillTo(field, value) {
    billToEdited.current = true
    setBillTo(current => ({ ...current, [field]: value }))
  }

  async function unlockInvoices(pin) {
    if (pin !== '4321') return { error: 'Incorrect PIN' }
    sessionStorage.setItem('onlinePaymentsUnlocked', '1')
    setSectionUnlocked(true)
    return { ok: true }
  }

  if (!sectionUnlocked) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
          <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Invoices</h1>
            <p className="text-xs text-muted-foreground">Tax invoices for paid charges</p>
          </div>
        </div>
        <div className="flex-1" />
        <PinModal
          open
          onClose={() => navigate('/settings')}
          onConfirm={unlockInvoices}
          title="Invoices"
          subtitle="Enter PIN to access tax invoices"
          icon={FileText}
          pinLabel="Enter admin PIN"
          confirmLabel="Enter"
        />
      </div>
    )
  }

  const billToAddressLines = billTo.address.split('\n').map(line => line.trim()).filter(Boolean)
  const paidOn = longDate(invoice.lastPaidAt)
  const canPrint = selectedRows.length > 0

  return (
    <div className="h-full flex flex-col print-flow">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b print-hide">
        <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Invoices</h1>
          <p className="text-xs text-muted-foreground">Tax invoices for paid charges</p>
        </div>
        <div className="ml-auto">
          <Button size="sm" className="gap-1.5" onClick={() => window.print()} disabled={!canPrint}>
            <Printer size={14} />
            Print / PDF
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto print-flow">
        <div className="px-4 py-4 space-y-4 print-hide">
          {!HST_REGISTRATION_NUMBER && (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <p>
                No GST/HST registration number is set. Add it to
                {' '}<code className="font-mono">HST_REGISTRATION_NUMBER</code> in
                {' '}<code className="font-mono">src/lib/invoices.js</code>. Without it the customer
                cannot claim an input tax credit for the HST on this invoice.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Paid from</span>
              <Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Paid to</span>
              <Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
            </label>
          </div>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              className="pl-9"
              placeholder="Search customer"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>

          {loadError && (
            <p className="text-sm text-destructive">{loadError}</p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading payments...</p>
          ) : (
            <div className="space-y-1.5">
              {customers.length === 0 && (
                <p className="text-sm text-muted-foreground">No taxed payments in this date range.</p>
              )}
              {customers.map(group => {
                const total = group.rows.reduce((sum, row) => sum + row.total, 0)
                const active = group.key === selectedKey
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => selectCustomer(group)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      active ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm truncate">{group.name}</span>
                      <span className="ml-auto text-sm tabular-nums">{cad(total)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {group.rows.length} payment{group.rows.length === 1 ? '' : 's'}
                      {group.email ? ` · ${group.email}` : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          )}

          {selected && (
            <div className="space-y-4 border-t pt-4">
              <div>
                <h2 className="text-sm font-semibold mb-2">Charges on this invoice</h2>
                <div className="space-y-1.5">
                  {selected.rows.map(row => (
                    <label
                      key={row.id}
                      className="flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--color-primary)]"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="text-sm truncate">{row.itemLabel}</span>
                          <span className="ml-auto text-sm tabular-nums">{cad(row.total)}</span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {row.periodDisplay || '-'} · paid {fmtDate(row.paidAt)} · {cad(row.tax)} {row.taxLabel}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Bill to</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto gap-1.5 h-7 text-xs"
                    disabled={stripeLoading || !selected.customerId}
                    onClick={() => { billToEdited.current = false; pullFromStripe(selected.customerId, savedBilling) }}
                  >
                    <RefreshCw size={12} className={stripeLoading ? 'animate-spin' : ''} />
                    Pull from Stripe
                  </Button>
                </div>

                {stripeError && <p className="text-xs text-amber-600 dark:text-amber-400">{stripeError}</p>}
                {stripeDetails?.card?.last4 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CreditCard size={13} />
                    Stripe card on file: {stripeDetails.card.brand} ending {stripeDetails.card.last4}
                    {stripeDetails.card.name ? ` · ${stripeDetails.card.name}` : ''}
                  </p>
                )}

                <Input
                  placeholder="Billed-to name"
                  value={billTo.name}
                  onChange={event => updateBillTo('name', event.target.value)}
                  onBlur={storeBillingIdentityOnBlur}
                />
                <Textarea
                  rows={4}
                  placeholder={'Address line 1\nCity Province Postal\nCountry'}
                  value={billTo.address}
                  onChange={event => updateBillTo('address', event.target.value)}
                  onBlur={storeBillingIdentityOnBlur}
                />
                {selected.customerId && (
                  billingStored ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Check size={13} className="text-primary" />
                      Saved for {selected.name} — future invoices start here, ahead of Stripe.
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs"
                      disabled={billingSaving || !billTo.name.trim()}
                      onClick={storeBillingIdentity}
                    >
                      {billingSaving ? 'Saving...' : `Save as the billing name for ${selected.name}`}
                    </Button>
                  )
                )}
                {billingError && <p className="text-xs text-destructive">{billingError}</p>}
                <Input
                  placeholder="Email"
                  value={billTo.email}
                  onChange={event => updateBillTo('email', event.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Invoice number</span>
                  <Input
                    value={invoiceNumber}
                    onChange={event => setInvoiceNumberOverride(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Date of issue</span>
                  <Input type="date" value={issueDate} onChange={event => setIssueDate(event.target.value)} />
                </label>
              </div>
            </div>
          )}
        </div>

        {canPrint && (
          <div className="px-4 pb-8 print-sheet-wrap">
            <div className="invoice-sheet">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-[26px] leading-none font-semibold tracking-tight">Invoice</h2>
                <img src="/logo.webp" alt="Timberfell" className="h-7 w-auto" />
              </div>

              <dl className="mt-7 space-y-0.5 text-[11px]">
                <div className="flex gap-3">
                  <dt className="w-28 font-semibold">Invoice number</dt>
                  <dd className="font-mono">{invoiceNumber}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-28 font-semibold">Date of issue</dt>
                  <dd>{longDate(issueDate.length === 10 ? `${issueDate}T12:00:00` : issueDate)}</dd>
                </div>
                {paidOn && (
                  <div className="flex gap-3">
                    <dt className="w-28 font-semibold">Date paid</dt>
                    <dd>{paidOn}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-7 grid grid-cols-2 gap-6 text-[11px] leading-[1.5]">
                <div>
                  <p className="font-semibold">{SELLER.name}</p>
                  {SELLER.addressLines.map(line => <p key={line}>{line}</p>)}
                  {SELLER.phone && <p>{SELLER.phone}</p>}
                  {SELLER.email && <p>{SELLER.email}</p>}
                  {HST_REGISTRATION_NUMBER && <p className="mt-1">HST No. {HST_REGISTRATION_NUMBER}</p>}
                </div>
                <div>
                  <p className="font-semibold">Bill to</p>
                  {billTo.name && <p>{billTo.name}</p>}
                  {billToAddressLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
                  {billTo.email && <p>{billTo.email}</p>}
                </div>
              </div>

              <p className="mt-7 text-[17px] font-semibold">
                {cad(invoice.total)} paid{paidOn ? ` on ${paidOn}` : ''}
              </p>

              <table className="mt-6 w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-neutral-300">
                    <th className="py-1.5 text-left font-normal">Description</th>
                    <th className="py-1.5 text-right font-normal w-12">Qty</th>
                    <th className="py-1.5 text-right font-normal w-24">Unit price</th>
                    <th className="py-1.5 text-right font-normal w-24">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map(line => (
                    <tr key={line.id}>
                      <td className="py-1.5 pr-3 align-top">{line.description}</td>
                      <td className="py-1.5 text-right align-top tabular-nums">{line.quantity}</td>
                      <td className="py-1.5 text-right align-top tabular-nums">{cad(line.unitPrice)}</td>
                      <td className="py-1.5 text-right align-top tabular-nums">{cad(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} />
                    <td className="pt-3 text-left border-t border-neutral-300">Subtotal</td>
                    <td className="pt-3 text-right tabular-nums border-t border-neutral-300">{cad(invoice.subtotal)}</td>
                  </tr>
                  {invoice.taxLines.map(entry => (
                    <tr key={`${entry.label}-${entry.rate}`}>
                      <td colSpan={2} />
                      <td className="py-0.5 text-left">{taxRateLabel(entry)}</td>
                      <td className="py-0.5 text-right tabular-nums">{cad(entry.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} />
                    <td className="pt-1 text-left border-t border-neutral-300">Total</td>
                    <td className="pt-1 text-right tabular-nums border-t border-neutral-300">{cad(invoice.total)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td colSpan={2} />
                    <td className="pt-1 text-left">Amount paid</td>
                    <td className="pt-1 text-right tabular-nums">{cad(invoice.total)}</td>
                  </tr>
                </tfoot>
              </table>

              <p className="mt-8 text-[10px]">{TERMS_NOTE}</p>

              <p className="invoice-footer text-[9px]">
                {invoiceNumber} · {cad(invoice.total)} paid{paidOn ? ` on ${paidOn}` : ''}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
