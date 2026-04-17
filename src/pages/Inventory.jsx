import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Plus, ChevronRight, Truck } from 'lucide-react'

export default function Inventory() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchYardAssets()
  }, [])

  async function fetchYardAssets() {
    setLoading(true)
    const { data } = await supabase.from('yard_assets').select('*').order('created_at', { ascending: false })
    if (data) setAssets(data)
    setLoading(false)
  }

  const grouped = assets.reduce((acc, asset) => {
    const key = asset.type_name
    if (!acc[key]) acc[key] = []
    acc[key].push(asset)
    return acc
  }, {})

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Yard Inventory</h1>
        <Button size="sm" onClick={() => navigate('/assets/new')}>
          <Plus size={16} />
          Add Asset
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && <p className="text-muted-foreground text-sm mt-8 text-center">Loading…</p>}

        {!loading && assets.length === 0 && (
          <div className="text-center mt-16 space-y-2">
            <p className="text-muted-foreground text-sm">No assets in yard</p>
            <Button variant="outline" size="sm" onClick={() => navigate('/assets/new')}>
              Add your first asset
            </Button>
          </div>
        )}

        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="mb-5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {type} ({items.length})
            </h2>
            <div className="space-y-2">
              {items.map(asset => (
                <div key={asset.id} className="bg-card border rounded-xl p-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{asset.label}</p>
                    {asset.size && <p className="text-sm text-muted-foreground">{asset.size}</p>}
                    {asset.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{asset.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => navigate(`/deploy/${asset.id}`)}
                    >
                      <Truck size={14} />
                      Deploy
                    </Button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => navigate(`/assets/${asset.id}`)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
