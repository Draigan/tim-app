import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Plus, ChevronRight, Truck, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { getMarkerColor } from '@/lib/utils'
import AssetBottomSheet from '@/components/AssetBottomSheet'
import { useRealtime } from '@/lib/useRealtime'
import { useIsAdmin } from '@/lib/useIsAdmin'

function match(q, ...fields) {
  return fields.some(f => f?.toLowerCase().includes(q))
}

export default function Inventory() {
  const [yardAssets, setYardAssets] = useState([])
  const [deployedAssets, setDeployedAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [deployedOpen, setDeployedOpen] = useState(true)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: yard }, { data: deployed }] = await Promise.all([
      supabase.from('yard_assets').select('*').order('created_at', { ascending: false }),
      supabase.from('active_deployments').select('*').order('dropped_at', { ascending: false }),
    ])
    if (yard) setYardAssets(yard)
    if (deployed) setDeployedAssets(deployed)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['deployments', 'assets', 'asset_types'], fetchAll)

  const q = query.trim().toLowerCase()

  function daysLeft(d) {
    if (!d.expires_at) return null
    return Math.ceil((new Date(d.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
  }

  const filteredDeployed = deployedAssets
    .filter(d => !q || match(q, d.label, d.type_name, d.address, d.customer_name, d.size))
    .sort((a, b) => {
      const da = daysLeft(a), db = daysLeft(b)
      if (da !== null && db !== null) return da - db
      if (da !== null) return -1
      if (db !== null) return 1
      return 0
    })
  const filteredYard = q ? yardAssets.filter(a => match(q, a.label, a.type_name, a.size, a.notes)) : yardAssets

  const grouped = filteredYard.reduce((acc, asset) => {
    const key = asset.type_name
    if (!acc[key]) acc[key] = []
    acc[key].push(asset)
    return acc
  }, {})

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Inventory</h1>
        {isAdmin && (
          <Button size="sm" onClick={() => navigate('/assets/new')}>
            <Plus size={16} />
            Add Asset
          </Button>
        )}
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search assets…"
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
          <>
            {filteredDeployed.length > 0 && (
              <div className="mb-6">
                <button
                  className="flex items-center justify-between w-full text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                  onClick={() => setDeployedOpen(v => !v)}
                >
                  <span>Deployed ({filteredDeployed.length})</span>
                  {deployedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {deployedOpen && (
                  <div className="space-y-2">
                    {filteredDeployed.map(dep => {
                      const dl = daysLeft(dep)
                      const expiryLabel = dl === null ? null : dl < 0 ? 'Expired' : dl === 0 ? 'Today' : `${dl}d left`
                      const isUrgent = dl !== null && dl <= 7
                      return (
                        <button
                          key={dep.id}
                          className="w-full text-left bg-card border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors"
                          onClick={() => setSelected([dep])}
                        >
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getMarkerColor(dep.expires_at) }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{dep.label}</span>
                              <span className="text-muted-foreground text-sm">{dep.type_name}</span>
                              {dep.size && <span className="text-muted-foreground text-sm">· {dep.size}</span>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{dep.address}</p>
                            {dep.customer_name && <p className="text-xs text-muted-foreground truncate">{dep.customer_name}</p>}
                          </div>
                          {expiryLabel
                            ? <span className={`text-xs font-medium flex-shrink-0 ${isUrgent ? 'text-destructive' : 'text-muted-foreground'}`}>{expiryLabel}</span>
                            : <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
                          }
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {filteredYard.length > 0 && (
              <>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  In Yard ({filteredYard.length})
                </h2>
                {Object.entries(grouped).map(([type, items]) => (
                  <div key={type} className="mb-5">
                    <h3 className="text-xs text-muted-foreground mb-2 ml-0.5">{type} ({items.length})</h3>
                    <div className="space-y-2">
                      {items.map(asset => (
                        <div key={asset.id} className="bg-card border rounded-xl p-4 flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{asset.label}</p>
                            {asset.size && <p className="text-sm text-muted-foreground">{asset.size}</p>}
                            {asset.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{asset.notes}</p>}
                          </div>
                          <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                            {isAdmin && (
                              <Button size="sm" onClick={() => navigate(`/deploy/${asset.id}`)}>
                                <Truck size={14} />
                                Deploy
                              </Button>
                            )}
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => navigate(`/assets/${asset.id}`)}>
                              <ChevronRight size={18} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {!loading && q && filteredDeployed.length === 0 && filteredYard.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-12">No assets match "{query}"</p>
            )}
          </>
        )}
      </div>

      <AssetBottomSheet
        deployments={selected}
        onClose={() => setSelected(null)}
        onPickup={() => { fetchAll(); setSelected(null) }}
      />
    </div>
  )
}
