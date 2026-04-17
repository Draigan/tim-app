import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Truck, MapPin, Calendar, User, Phone } from 'lucide-react'
import { formatPhone } from '@/lib/utils'

function statusBadge(dep) {
  if (dep.picked_up_at) return { label: 'Returned', variant: 'secondary' }
  if (!dep.expires_at) return { label: 'Deployed', variant: 'default' }
  const daysLeft = Math.ceil((new Date(dep.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return { label: 'Expired', variant: 'destructive' }
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, variant: 'warning' }
  return { label: 'Active', variant: 'success' }
}

export default function AssetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [asset, setAsset] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: assetData }, { data: depData }] = await Promise.all([
        supabase.from('assets').select('*, asset_types(name)').eq('id', id).single(),
        supabase.from('deployments').select('*').eq('asset_id', id).order('created_at', { ascending: false }),
      ])
      if (assetData) setAsset(assetData)
      if (depData) setDeployments(depData)
      setLoading(false)
    }
    load()
  }, [id])

  const activeDeployment = deployments.find(d => !d.picked_up_at)

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>
  if (!asset) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Asset not found</div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{asset.label}</h1>
          <p className="text-sm text-muted-foreground">
            {asset.asset_types.name}{asset.size ? ` · ${asset.size}` : ''}
          </p>
        </div>
        {!activeDeployment && (
          <Button size="sm" onClick={() => navigate(`/deploy/${asset.id}`)}>
            <Truck size={14} />
            Deploy
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        {asset.notes && (
          <div className="bg-muted rounded-xl p-4">
            <p className="text-sm text-muted-foreground">{asset.notes}</p>
          </div>
        )}

        {activeDeployment && (
          <div className="bg-card border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Currently Deployed</h2>
              <Badge variant="success">Active</Badge>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <MapPin size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <span>{activeDeployment.address}</span>
              </div>
              {activeDeployment.customer_name && (
                <div className="flex items-center gap-2">
                  <User size={14} className="text-muted-foreground flex-shrink-0" />
                  <span>{activeDeployment.customer_name}</span>
                </div>
              )}
              {activeDeployment.customer_phone && (
                <a href={`tel:${activeDeployment.customer_phone}`} className="flex items-center gap-2 text-primary">
                  <Phone size={14} className="flex-shrink-0" />
                  <span>{formatPhone(activeDeployment.customer_phone)}</span>
                </a>
              )}
              {activeDeployment.expires_at && (
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-muted-foreground flex-shrink-0" />
                  <span>Expires {new Date(activeDeployment.expires_at + 'T00:00:00').toLocaleDateString()}</span>
                </div>
              )}
              {activeDeployment.notes && (
                <p className="text-muted-foreground bg-muted rounded-lg p-3 mt-1">{activeDeployment.notes}</p>
              )}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Deployment History ({deployments.length})
          </h2>
          {deployments.length === 0 && (
            <p className="text-sm text-muted-foreground">Never deployed.</p>
          )}
          <div className="space-y-2">
            {deployments.map(dep => {
              const badge = statusBadge(dep)
              return (
                <div key={dep.id} className="border rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate pr-2">{dep.address}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  {dep.customer_name && (
                    <p className="text-muted-foreground">{dep.customer_name}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Dropped {new Date(dep.dropped_at).toLocaleDateString()}</span>
                    {dep.picked_up_at && (
                      <span>· Picked up {new Date(dep.picked_up_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
