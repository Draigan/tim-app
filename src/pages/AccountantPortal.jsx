import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, LogOut, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useAccess } from '@/lib/useAccess'
import { useRealtime } from '@/lib/useRealtime'
import { cn } from '@/lib/utils'
import {
  downloadCsvFile,
  isUnknownCustomer,
  loadOnlinePaymentRows,
  makeXeroInvoiceRows,
  money,
} from '@/lib/onlinePaymentsData'

// Cap the on-screen preview so a wide date range doesn't render thousands of
// rows; the download always contains everything.
const CSV_PREVIEW_LIMIT = 200

function showDatePicker(event) {
  try {
    event.target.showPicker()
  } catch {
    // Some browsers do not expose showPicker.
  }
}

function SummaryBox({ label, value, tone = 'default' }) {
  const toneClass = {
    default: 'border-primary/20 bg-primary/10 text-primary',
    green: 'border-green-500/20 bg-green-500/10 text-green-600',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
  }[tone]

  return (
    <div className={cn('rounded-lg border px-3 py-3', toneClass)}>
      <p className="text-base font-semibold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  )
}

export default function AccountantPortal() {
  const { isAccountant } = useAccess()
  const [dateFrom, setDateFrom] = useState(() => localStorage.getItem('accountantDateFrom') || '')
  const [dateTo, setDateTo] = useState(() => localStorage.getItem('accountantDateTo') || '')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [xeroAccountCode, setXeroAccountCode] = useState(() => localStorage.getItem('xeroAccountCode') || '')
  const [xeroTaxType, setXeroTaxType] = useState(() => localStorage.getItem('xeroTaxType') || '')
  const [signingOut, setSigningOut] = useState(false)

  // A top scrollbar mirrored to the table's own scroll, so the preview can be
  // scrolled horizontally without reaching the bottom of a tall table.
  const topScrollRef = useRef(null)
  const tableScrollRef = useRef(null)
  const [previewWidth, setPreviewWidth] = useState(0)

  // Click-and-drag to pan the preview horizontally (mouse only — touch pans
  // natively), so the whole area scrolls like it would on mobile.
  const dragRef = useRef({ active: false, startX: 0, startLeft: 0 })
  const [dragging, setDragging] = useState(false)

  const load = useCallback(async () => {
    // Nothing is shown until a date range is chosen.
    if (!dateFrom && !dateTo) {
      setRows([])
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await loadOnlinePaymentRows({ dateFrom, dateTo })
      setRows(data)
    } catch (err) {
      console.error('accountant portal load failed', err)
      setRows([])
      setError(err?.message || 'Could not load online payments.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    const timeout = window.setTimeout(load, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  useRealtime(['storage_payments', 'portable_storage_payments', 'storage_tenancies', 'portable_storage_rentals', 'storage_units', 'assets', 'customers'], load)

  // Remember the chosen range so it is restored on the next visit.
  useEffect(() => { localStorage.setItem('accountantDateFrom', dateFrom) }, [dateFrom])
  useEffect(() => { localStorage.setItem('accountantDateTo', dateTo) }, [dateTo])

  // The exported set matches the Online Payments page: drop unknown-customer rows.
  const exportRows = useMemo(() => rows.filter(row => !isUnknownCustomer(row)), [rows])

  // The exact rows that go into the CSV, for the on-screen preview.
  const csvRows = useMemo(
    () => makeXeroInvoiceRows(exportRows, { accountCode: xeroAccountCode, taxType: xeroTaxType }),
    [exportRows, xeroAccountCode, xeroTaxType],
  )

  // Keep the top scrollbar's width matched to the table, and re-measure when the
  // content or container changes.
  useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const measure = () => setPreviewWidth(el.scrollWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [csvRows, loading, rows.length])

  function syncScrollFromTop() {
    if (topScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft
    }
  }

  function syncScrollFromTable() {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft
    }
  }

  function onPreviewPointerDown(event) {
    if (event.pointerType !== 'mouse') return
    const el = tableScrollRef.current
    if (!el) return
    dragRef.current = { active: true, startX: event.clientX, startLeft: el.scrollLeft }
    el.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }

  function onPreviewPointerMove(event) {
    if (!dragRef.current.active) return
    const el = tableScrollRef.current
    if (!el) return
    el.scrollLeft = dragRef.current.startLeft - (event.clientX - dragRef.current.startX)
  }

  function onPreviewPointerUp(event) {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    tableScrollRef.current?.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }

  function updateXeroAccountCode(value) {
    setXeroAccountCode(value)
    localStorage.setItem('xeroAccountCode', value)
  }

  function updateXeroTaxType(value) {
    setXeroTaxType(value)
    localStorage.setItem('xeroTaxType', value)
  }

  // One entry per paid month, newest first, with per-month totals.
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    subtotal: sum.subtotal + row.subtotal,
    tax: sum.tax + row.tax,
    total: sum.total + row.total,
  }), { subtotal: 0, tax: 0, total: 0 }), [rows])

  const hasFilters = !!(dateFrom || dateTo)

  function clearFilters() {
    setDateFrom('')
    setDateTo('')
  }

  function rangeLabel() {
    if (!dateFrom && !dateTo) return 'all'
    return `${dateFrom || 'start'}-to-${dateTo || 'latest'}`
  }

  function buildRows(sourceRows) {
    return makeXeroInvoiceRows(sourceRows, { accountCode: xeroAccountCode, taxType: xeroTaxType })
  }

  function exportCsv() {
    if (exportRows.length === 0) return
    downloadCsvFile(`xero-invoices-${rangeLabel()}.csv`, buildRows(exportRows))
  }

  async function handleSignOut() {
    setSigningOut(true)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setSigningOut(false)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 border-b">
        <img src="/logo.webp" alt="Timberfell" className="h-8 w-auto logo-invert" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Tax</h1>
        </div>
        {isAccountant && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <LogOut size={14} />
            {signingOut ? 'Signing out...' : 'Sign out'}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <SummaryBox label="Payments" value={loading || !hasFilters ? '-' : rows.length.toLocaleString('en-CA')} />
          <SummaryBox label="Tax" value={loading || !hasFilters ? '-' : money(totals.tax)} tone="amber" />
          <SummaryBox label="Subtotal" value={loading || !hasFilters ? '-' : money(totals.subtotal)} />
          <SummaryBox label="Total" value={loading || !hasFilters ? '-' : money(totals.total)} tone="green" />
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">From date</p>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={event => setDateFrom(event.target.value)}
                onClick={showDatePicker}
                className="cursor-pointer"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">To date</p>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={event => setDateTo(event.target.value)}
                onClick={showDatePicker}
                className="cursor-pointer"
              />
            </div>
          </div>

          {hasFilters && (
            <div>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border bg-card px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="xero-account-code">Account code</label>
              <Input
                id="xero-account-code"
                value={xeroAccountCode}
                onChange={event => updateXeroAccountCode(event.target.value)}
                placeholder="e.g. 200"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="xero-tax-type">Tax type</label>
              <Input
                id="xero-tax-type"
                value={xeroTaxType}
                onChange={event => updateXeroTaxType(event.target.value)}
                placeholder="e.g. HST on Sales"
              />
            </div>
          </div>
          {(!xeroAccountCode || !xeroTaxType) && (
            <p className="text-xs text-amber-600">
              Set both codes so Xero can import the invoices.
            </p>
          )}

          <Button
            className="w-full gap-2"
            onClick={exportCsv}
            disabled={loading || exportRows.length === 0}
          >
            <Download size={14} />
            Download CSV
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 space-y-1">
            <ReceiptText size={24} className="mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">{hasFilters ? 'No online payments found' : 'Choose a date range'}</p>
            <p className="text-xs text-muted-foreground">
              {hasFilters ? 'Adjust the date range to check another period.' : 'Pick a From and To date to see records.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              <p className="text-xs text-muted-foreground">
                {exportRows.length} invoice{exportRows.length === 1 ? '' : 's'}
                {exportRows.length > CSV_PREVIEW_LIMIT ? ` · showing first ${CSV_PREVIEW_LIMIT}` : ''}
              </p>
            </div>
            <div
              ref={topScrollRef}
              onScroll={syncScrollFromTop}
              className="always-scrollbar"
            >
              <div style={{ width: previewWidth, height: 1 }} />
            </div>
            <div
              ref={tableScrollRef}
              onScroll={syncScrollFromTable}
              onPointerDown={onPreviewPointerDown}
              onPointerMove={onPreviewPointerMove}
              onPointerUp={onPreviewPointerUp}
              onPointerCancel={onPreviewPointerUp}
              className={cn('always-scrollbar rounded-lg border cursor-grab', dragging && 'cursor-grabbing select-none')}
            >
              <table className="text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b bg-muted/50 text-muted-foreground">
                    {csvRows[0].map((heading, index) => (
                      <th key={index} className="text-left font-medium px-2 py-1.5">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(1, CSV_PREVIEW_LIMIT + 1).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b last:border-0">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-1.5">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
