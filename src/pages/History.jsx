import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { getMarkerColor } from '@/lib/utils'
import { Search, X, ChevronDown, ChevronUp, MapPin, User, Calendar, ClipboardList, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AssetBottomSheet from '@/components/AssetBottomSheet'

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

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">History</h1>
      </div>

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
                <button key={r.id} onClick={() => setSelected([flat])} className="w-full text-left bg-card border rounded-xl p-4 space-y-2 hover:bg-accent transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                      <span className="font-medium truncate">{r.assets?.label}</span>
                      <span className="text-muted-foreground text-sm flex-shrink-0">{r.assets?.asset_types?.name}</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {isActive ? 'Active' : 'Completed'}
                    </span>
                  </div>

                  <div className="space-y-1 ml-4">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin size={13} className="mt-0.5 flex-shrink-0" />
                      <span className="truncate">{r.address}</span>
                    </div>
                    {r.customer_name && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User size={13} className="flex-shrink-0" />
                        <span>{r.customer_name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar size={13} className="flex-shrink-0" />
                      <span>
                        {fmt(r.dropped_at)} → {r.picked_up_at ? fmt(r.picked_up_at) : 'Present'}
                        <span className="ml-1 text-xs">({duration(r.dropped_at, r.picked_up_at)})</span>
                      </span>
                    </div>
                    {r.notes && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <FileText size={13} className="mt-0.5 flex-shrink-0" />
                        <span>{r.notes}</span>
                      </div>
                    )}
                    {r.picked_up_by && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User size={13} className="flex-shrink-0" />
                        <span>Picked up by {r.picked_up_by}</span>
                      </div>
                    )}
                    {r.pickup_notes && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <ClipboardList size={13} className="mt-0.5 flex-shrink-0" />
                        <span>{r.pickup_notes}</span>
                      </div>
                    )}
                  </div>
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

      <AssetBottomSheet
        deployments={selected}
        onClose={() => setSelected(null)}
        onPickup={() => { fetchAll(); setSelected(null) }}
        readOnly={selected?.[0]?.picked_up_at != null}
      />
    </div>
  )
}
