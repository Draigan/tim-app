import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { Search, X, Truck } from 'lucide-react'
import { useOnlineStatus } from '@/lib/useOnlineStatus'

export default function DeploySheet({ open, onClose }) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const isOnline = useOnlineStatus()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) { setQuery(''); return }
    setLoading(true)
    supabase.from('yard_assets').select('*').order('type_name').then(({ data }) => {
      if (data) setAssets(data)
      setLoading(false)
    })
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? assets.filter(a => [a.label, a.type_name, a.size, a.notes].some(f => f?.toLowerCase().includes(q)))
    : assets

  const grouped = filtered.reduce((acc, a) => {
    ;(acc[a.type_name] = acc[a.type_name] ?? []).push(a)
    return acc
  }, {})

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="bottom" className="max-h-[85vh] flex flex-col pb-8 focus:outline-none" onOpenAutoFocus={e => e.preventDefault()}>
        <SheetHeader className="pr-6 flex-shrink-0">
          <SheetTitle>Deploy Asset</SheetTitle>
        </SheetHeader>

        <div className="relative mt-3 flex-shrink-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search…"
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

        <div className="flex-1 overflow-y-auto mt-3 space-y-5">
          {!isOnline && (
            <p className="text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              Deployment requires an internet connection.
            </p>
          )}

          {loading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}

          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {q ? `No assets match "${query}"` : 'No assets in yard'}
            </p>
          )}

          {!loading && Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <p className="text-xs text-muted-foreground mb-2">{type} ({items.length})</p>
              <div className="space-y-2">
                {items.map(asset => (
                  <div key={asset.id} className="bg-card border rounded-xl p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{asset.label}</p>
                      {asset.size && <p className="text-sm text-muted-foreground">{asset.size}</p>}
                      {asset.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{asset.notes}</p>}
                    </div>
                    <Button size="sm" className="flex-shrink-0" disabled={!isOnline} onClick={() => { onClose(); navigate(`/deploy/${asset.id}`) }}>
                      <Truck size={14} />
                      Deploy
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
