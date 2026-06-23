import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { getMarkerColor, formatPhone } from '@/lib/utils'
import { Search, X, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AssetBottomSheet from '@/components/AssetBottomSheet'

function fmtPeriod(label) {
  if (!label || !/^\d{4}-\d{2}$/.test(label)) return label || ''
  const [y, m] = label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

const CUSTOMER_STORAGE_TYPE_LABELS = { boat: 'Boat', trailer: 'Trailer', rv: 'RV', custom: 'Custom' }

function storageRecordLabel(record) {
  if (record?.storage_kind !== 'customer_item') {
    return record?.storage_units?.unit_number ? `Unit ${record.storage_units.unit_number}` : 'Storage'
  }
  const type = record.item_type === 'custom'
    ? record.custom_item_type || 'Custom'
    : CUSTOMER_STORAGE_TYPE_LABELS[record.item_type] ?? 'Storage'
  return record.item_label ? `${type} ${record.item_label}` : type
}

function storageRecordPath(record) {
  return record?.storage_kind === 'customer_item'
    ? `/storage/customer/${record.id}/billing`
    : record?.storage_units?.id ? `/storage/${record.storage_units.id}/billing` : null
}

function duration(droppedAt, pickedUpAt) {
  const end = pickedUpAt ? new Date(pickedUpAt) : new Date()
  const days = Math.round((end - new Date(droppedAt)) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Less than a day'
  return `${days} day${days === 1 ? '' : 's'}`
}

function fmt(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function History() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('deployments') // 'deployments' | 'sms' | 'reviews' | 'storage'

  // Deployments state
  const [records, setRecords] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [selected, setSelected] = useState(null)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // SMS log state
  const [smsLogs, setSmsLogs] = useState([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsQuery, setSmsQuery] = useState('')

  // Reviews log state
  const [reviews, setReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsQuery, setReviewsQuery] = useState('')

  // Storage history state
  const [storageRecords, setStorageRecords] = useState([])
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageQuery, setStorageQuery] = useState('')

  const PAGE = 50

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: deps }, { data: assetTypes }] = await Promise.all([
      supabase
        .from('deployments')
        .select('*, assets(label, size, asset_types(name))')
        .order('dropped_at', { ascending: false })
        .range(0, PAGE - 1),
      supabase.from('asset_types').select('id, name').order('name'),
    ])
    if (deps) { setRecords(deps); setHasMore(deps.length === PAGE) }
    if (assetTypes) setTypes(assetTypes)
    setLoading(false)
  }, [])

  const fetchSmsLogs = useCallback(async () => {
    setSmsLoading(true)
    const { data } = await supabase
      .from('sms_reminder_log')
      .select('*')
      .order('sent_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setSmsLogs(data)
    setSmsLoading(false)
  }, [])

  useEffect(() => {
    if (activeTab === 'sms' && smsLogs.length === 0) fetchSmsLogs()
  }, [activeTab, fetchSmsLogs, smsLogs.length])

  const fetchReviews = useCallback(async () => {
    setReviewsLoading(true)
    const { data } = await supabase
      .from('deployments')
      .select('id, customer_name, address, review_requested_at, assets(label, asset_types(name))')
      .not('review_requested_at', 'is', null)
      .order('review_requested_at', { ascending: false })
      .limit(200)
    if (data) setReviews(data)
    setReviewsLoading(false)
  }, [])

  useEffect(() => {
    if (activeTab === 'reviews' && reviews.length === 0) fetchReviews()
  }, [activeTab, fetchReviews, reviews.length])

  const fetchStorageHistory = useCallback(async () => {
    setStorageLoading(true)
    const { data } = await supabase
      .from('storage_tenancies')
      .select('id, storage_kind, item_type, custom_item_type, item_label, move_in_date, end_date, monthly_rate, paid_through_date, tenant_name, customers(name), storage_units(id, unit_number), storage_payments(period_label, amount, paid_at)')
      .order('end_date', { ascending: false, nullsFirst: true })
    if (data) setStorageRecords(data)
    setStorageLoading(false)
  }, [])

  useEffect(() => {
    if (activeTab === 'storage' && storageRecords.length === 0) fetchStorageHistory()
  }, [activeTab, fetchStorageHistory, storageRecords.length])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    const { data } = await supabase
      .from('deployments')
      .select('*, assets(label, size, asset_types(name))')
      .order('dropped_at', { ascending: false })
      .range(records.length, records.length + PAGE - 1)
    if (data) { setRecords(r => [...r, ...data]); setHasMore(data.length === PAGE) }
    setLoadingMore(false)
  }, [records.length])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['deployments'], fetchAll)

  const q = query.trim().toLowerCase()
  const filtered = records.filter(r => {
    const label = r.assets?.label ?? ''
    const type = r.assets?.asset_types?.name ?? ''
    const customer = r.customer_name ?? ''
    const address = r.address ?? ''

    if (q && ![label, type, customer, address].some(f => f.toLowerCase().includes(q))) return false
    if (statusFilter === 'active' && r.picked_up_at) return false
    if (statusFilter === 'completed' && !r.picked_up_at) return false
    if (typeFilter !== 'all' && type !== typeFilter) return false
    if (dateFrom && new Date(r.dropped_at) < new Date(dateFrom)) return false
    if (dateTo && new Date(r.dropped_at) > new Date(dateTo + 'T23:59:59')) return false
    return true
  })

  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || dateFrom || dateTo

  function clearFilters() {
    setStatusFilter('all')
    setTypeFilter('all')
    setDateFrom('')
    setDateTo('')
  }

  const filteredSms = smsLogs.filter(log => {
    if (!smsQuery.trim()) return true
    const q = smsQuery.trim().toLowerCase()
    return [log.phone, log.message].some(f => f?.toLowerCase().includes(q))
  })

  const filteredReviews = reviews.filter(r => {
    if (!reviewsQuery.trim()) return true
    const q = reviewsQuery.trim().toLowerCase()
    return [r.customer_name, r.address, r.assets?.label].some(f => f?.toLowerCase().includes(q))
  })

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">History</h1>
      </div>

      <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
        {[['deployments', 'Deployments'], ['storage', 'Storage'], ['sms', 'SMS'], ['reviews', 'Reviews']].map(([val, label]) => (
          <button key={val} onClick={() => setActiveTab(val)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${activeTab === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'deployments' && (
        <>
          <div className="px-4 pb-2 space-y-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Search by asset, customer, address…"
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

            <button
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowFilters(v => !v)}
            >
              {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Filters
              {hasFilters && <span className="ml-1 w-2 h-2 rounded-full bg-primary inline-block" />}
            </button>

            {showFilters && (
              <div className="space-y-3 pt-1">
                <div className="flex gap-2">
                  {['all', 'active', 'completed'].map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:text-foreground'}`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Asset Type</p>
                  <select
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="all">All types</option>
                    {types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1.5">From</p>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      onClick={e => { try { e.target.showPicker() } catch {} }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1.5">To</p>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      onClick={e => { try { e.target.showPicker() } catch {} }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                    />
                  </div>
                </div>

                {hasFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {loading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

            {!loading && filtered.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-16">No records found</p>
            )}

            {!loading && (
              <div className="space-y-2 pb-2">
                {filtered.map(r => {
                  const isActive = !r.picked_up_at
                  const dot = isActive ? getMarkerColor(r.expires_at) : '#9ca3af'
                  const flat = {
                    ...r,
                    label: r.assets?.label,
                    size: r.assets?.size,
                    type_name: r.assets?.asset_types?.name,
                  }
                  return (
                    <button key={r.id} onClick={() => setSelected([flat])} className="w-full text-left bg-card border rounded-xl p-4 hover:bg-accent transition-colors space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: dot }} />
                            <span className="font-semibold truncate">{r.assets?.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 ml-4">{r.assets?.asset_types?.name}{r.assets?.size ? ` · ${r.assets.size}` : ''}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {isActive ? 'Active' : 'Completed'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium truncate">{r.address}</p>
                        {r.customer_name && <p className="text-sm text-muted-foreground">{r.customer_name}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{fmt(r.dropped_at)}</span>
                        <span>→</span>
                        <span>{r.picked_up_at ? fmt(r.picked_up_at) : 'Present'}</span>
                        <span className="text-muted-foreground/50">· {duration(r.dropped_at, r.picked_up_at)}</span>
                      </div>
                      {(r.notes || r.pickup_notes) && (
                        <div className="space-y-1">
                          {r.notes && <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">{r.notes}</p>}
                          {r.pickup_notes && <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">Pickup: {r.pickup_notes}</p>}
                        </div>
                      )}
                      {(r.deployed_by || r.picked_up_by) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground/70 border-t border-border/50 pt-2">
                          {r.deployed_by && <span>Deployed by {r.deployed_by}</span>}
                          {r.picked_up_by && <span>Picked up by {r.picked_up_by}</span>}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {!loading && hasMore && !q && statusFilter === 'all' && typeFilter === 'all' && !dateFrom && !dateTo && (
              <Button variant="outline" className="w-full mt-2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        </>
      )}

      {activeTab === 'sms' && (
        <>
          <div className="px-4 pb-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Search by phone or message…"
                value={smsQuery}
                onChange={e => setSmsQuery(e.target.value)}
                className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {smsQuery && (
                <button onClick={() => setSmsQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {smsLoading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

            {!smsLoading && filteredSms.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-16">No SMS reminders sent yet</p>
            )}

            {!smsLoading && (
              <div className="space-y-2 pb-2">
                {filteredSms.map(log => (
                  <div key={log.id} className="bg-card border rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{formatPhone(log.phone)}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {log.unit_type === 'fixed' ? 'Fixed unit' : 'Portable'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{fmt(log.sent_date)}</span>
                      {log.days_overdue === 0
                        ? <span className="text-amber-500">Due today</span>
                        : <span className="text-destructive">{log.days_overdue} day{log.days_overdue !== 1 ? 's' : ''} overdue</span>
                      }
                    </div>
                    {log.message && <p className="text-xs text-muted-foreground line-clamp-2">{log.message}</p>}
                  </div>
                ))}
              </div>
            )}

            {!smsLoading && filteredSms.length > 0 && (
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={fetchSmsLogs} disabled={smsLoading}>
                Refresh
              </Button>
            )}
          </div>
        </>
      )}

      {activeTab === 'reviews' && (
        <>
          <div className="px-4 pb-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Search by customer, asset, address…"
                value={reviewsQuery}
                onChange={e => setReviewsQuery(e.target.value)}
                className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {reviewsQuery && (
                <button onClick={() => setReviewsQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {reviewsLoading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

            {!reviewsLoading && filteredReviews.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-16">No review requests sent yet</p>
            )}

            {!reviewsLoading && (
              <div className="space-y-2 pb-2">
                {filteredReviews.map(r => (
                  <div key={r.id} className="bg-card border rounded-xl p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">{r.customer_name || 'Unknown customer'}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{fmt(r.review_requested_at)}</span>
                    </div>
                    {r.assets?.label && (
                      <p className="text-xs text-muted-foreground">
                        {r.assets.label}{r.assets.asset_types?.name ? ` · ${r.assets.asset_types.name}` : ''}
                      </p>
                    )}
                    {r.address && <p className="text-xs text-muted-foreground truncate">{r.address}</p>}
                  </div>
                ))}
              </div>
            )}

            {!reviewsLoading && filteredReviews.length > 0 && (
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={fetchReviews} disabled={reviewsLoading}>
                Refresh
              </Button>
            )}
          </div>
        </>
      )}

      {activeTab === 'storage' && (
        <>
          <div className="px-4 pb-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Search by unit or tenant…"
                value={storageQuery}
                onChange={e => setStorageQuery(e.target.value)}
                className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {storageQuery && (
                <button onClick={() => setStorageQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {storageLoading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

            {!storageLoading && storageRecords.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-16">No storage history yet</p>
            )}

            {!storageLoading && (() => {
              const q = storageQuery.trim().toLowerCase()
              const filtered = storageRecords.filter(t => {
                if (!q) return true
                const name = t.customers?.name || t.tenant_name || ''
                const label = storageRecordLabel(t)
                return [name, label].some(f => f.toLowerCase().includes(q))
              })
              return (
                <div className="space-y-2 pb-2">
                  {filtered.map(t => {
                    const isActive = !t.end_date
                    const name = t.customers?.name || t.tenant_name
                    const storagePath = storageRecordPath(t)
                    const payments = t.storage_payments ?? []
                    const lastPeriod = [...payments].sort((a, b) => (b.period_label || '').localeCompare(a.period_label || ''))[0]?.period_label
                    return (
                      <button
                        key={t.id}
                        onClick={() => storagePath && navigate(storagePath)}
                        className="w-full text-left bg-card border rounded-xl p-4 hover:bg-accent transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{storageRecordLabel(t)}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-green-500/10 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                              {isActive ? 'Active' : 'Ended'}
                            </span>
                          </div>
                          <ChevronRight size={15} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                        </div>
                        {name && <p className="text-sm text-muted-foreground">{name}</p>}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                          {t.monthly_rate && <span>${t.monthly_rate}/mo</span>}
                          <span>{fmt(t.move_in_date)} → {t.end_date ? fmt(t.end_date) : 'Present'}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                          <span>{payments.length} payment{payments.length !== 1 ? 's' : ''}{lastPeriod ? ` · last: ${fmtPeriod(lastPeriod)}` : ''}</span>
                          {isActive && t.paid_through_date && (
                            <span className="text-green-600">Paid through {fmt(t.paid_through_date)}</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {filtered.length === 0 && q && (
                    <p className="text-muted-foreground text-sm text-center mt-16">No results for "{storageQuery}"</p>
                  )}
                </div>
              )
            })()}
          </div>
        </>
      )}

      <AssetBottomSheet
        deployments={selected}
        onClose={() => setSelected(null)}
        onPickup={() => { fetchAll(); setSelected(null) }}
        readOnly={selected?.[0]?.picked_up_at != null}
      />
    </div>
  )
}
