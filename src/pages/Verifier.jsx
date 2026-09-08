import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRealtime } from '@/lib/useRealtime'
import { CheckCircle2, Circle, Loader2, MapPin, Navigation } from 'lucide-react'
import { cn } from '@/lib/utils'

const DUMPSTER_TYPE = 'Dumpster'

function validCoordinate(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function mapsPoint(stop) {
  return stop.lat !== null && stop.lng !== null
    ? `${stop.lat},${stop.lng}`
    : stop.address
}

function routeKey(deployment) {
  const lat = validCoordinate(deployment.lat)
  const lng = validCoordinate(deployment.lng)
  if (lat !== null && lng !== null) {
    return `${lat.toFixed(6)},${lng.toFixed(6)}`
  }
  return deployment.address
}

function buildRouteStops(deployments) {
  const stops = new Map()

  for (const deployment of deployments) {
    const key = routeKey(deployment)
    const existing = stops.get(key)
    const assetLabel = [deployment.label, deployment.size].filter(Boolean).join(' · ')
    if (existing) {
      existing.count += 1
      if (assetLabel) existing.assets.push(assetLabel)
      continue
    }
    stops.set(key, {
      key,
      address: deployment.address,
      lat: validCoordinate(deployment.lat),
      lng: validCoordinate(deployment.lng),
      count: 1,
      assets: assetLabel ? [assetLabel] : [],
    })
  }

  return [...stops.values()].sort((a, b) => {
    if (a.lat !== null && b.lat !== null && a.lat !== b.lat) return b.lat - a.lat
    return a.address.localeCompare(b.address)
  })
}

function googleMapsRouteUrl(stops) {
  if (stops.length === 0) return ''
  const destination = stops[stops.length - 1]
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination: mapsPoint(destination),
  })

  if (stops.length > 1) {
    params.set('waypoints', stops.slice(0, -1).map(mapsPoint).join('|'))
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export default function Verifier() {
  const [assets, setAssets] = useState([])
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')
  const [confirmUnverify, setConfirmUnverify] = useState(null)

  const fetchAssets = useCallback(async () => {
    const [{ data, error: loadError }, { data: deploymentData, error: deploymentError }] = await Promise.all([
      supabase
        .from('assets')
        .select('id, label, size, notes, verified_at, verified_by, asset_types!inner(name)')
        .eq('archived', false)
        .eq('asset_types.name', DUMPSTER_TYPE)
        .order('label'),
      supabase
        .from('active_deployments')
        .select('id, asset_id, label, size, address, lat, lng, type_name')
        .eq('type_name', DUMPSTER_TYPE)
        .order('lat', { ascending: false }),
    ])

    if (data) setAssets(data)
    if (deploymentData) setDeployments(deploymentData)

    if (loadError || deploymentError) {
      setError(loadError?.message ?? deploymentError?.message)
    } else {
      setError('')
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAssets() }, [fetchAssets])
  useRealtime(['assets', 'deployments'], fetchAssets)

  function toggle(asset) {
    // Verifying is one tap. Undoing it is a deliberate act - these checks are the
    // record of what physically exists.
    if (asset.verified_at) {
      setConfirmUnverify(asset)
      return
    }
    applyToggle(asset, true)
  }

  async function applyToggle(asset, verifying) {
    setConfirmUnverify(null)
    setSavingId(asset.id)
    setError('')

    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    const patch = verifying
      ? {
          verified_at: new Date().toISOString(),
          verified_by: user?.user_metadata?.full_name ?? user?.email ?? null,
        }
      : { verified_at: null, verified_by: null }

    // Update on screen straight away — this gets tapped down a row of bins.
    setAssets(prev => prev.map(item => (item.id === asset.id ? { ...item, ...patch } : item)))

    const { error: saveError } = await supabase.from('assets').update(patch).eq('id', asset.id)
    if (saveError) {
      setError(saveError.message)
      fetchAssets()
    }
    setSavingId(null)
  }

  const verifiedCount = assets.filter(a => a.verified_at).length
  const routeStops = buildRouteStops(deployments)
  const routeUrl = googleMapsRouteUrl(routeStops)
  const deployedBinCount = deployments.length

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b flex-shrink-0">
        <h1 className="text-lg font-semibold">Verifier</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Check off each bin when you physically see it.
        </p>
        {!loading && (
          <p className="text-sm font-medium mt-2">
            {verifiedCount} of {assets.length} verified
            {assets.length > verifiedCount && (
              <span className="text-muted-foreground font-normal">
                {' · '}{assets.length - verifiedCount} unconfirmed
              </span>
            )}
          </p>
        )}
        {!loading && routeUrl && (
          <div className="mt-3 rounded-lg border bg-card p-3">
            <a href={routeUrl} target="_blank" rel="noopener noreferrer">
              <Button className="w-full">
                <Navigation size={16} />
                Open north-first Google Maps route
              </Button>
            </a>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin size={13} className="flex-shrink-0" />
              {routeStops.length} stop{routeStops.length === 1 ? '' : 's'}
              {deployedBinCount !== routeStops.length && ` · ${deployedBinCount} deployed bins`}
            </p>
          </div>
        )}
      </div>

      {error && <p className="px-4 py-2 text-sm text-destructive flex-shrink-0">{error}</p>}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No dumpster assets found.</p>
        ) : (
          assets.map(asset => {
            const verified = !!asset.verified_at
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => toggle(asset)}
                disabled={savingId === asset.id}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left hover:bg-accent',
                  verified && 'border-primary/50 bg-primary/5',
                )}
              >
                {savingId === asset.id ? (
                  <Loader2 size={22} className="flex-shrink-0 animate-spin text-muted-foreground" />
                ) : verified ? (
                  <CheckCircle2 size={22} className="flex-shrink-0 text-primary" />
                ) : (
                  <Circle size={22} className="flex-shrink-0 text-muted-foreground/50" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">
                    {asset.label}{asset.size ? ` · ${asset.size}` : ''}
                  </span>
                  {verified && (
                    <span className="block text-xs text-muted-foreground truncate">
                      Verified{asset.verified_by ? ` by ${asset.verified_by}` : ''}
                    </span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>

      <Dialog open={!!confirmUnverify} onOpenChange={open => !open && setConfirmUnverify(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unverify {confirmUnverify?.label}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">
            This marks it as no longer confirmed to exist. Only do this if you were wrong about
            seeing it.
          </p>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmUnverify(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-destructive hover:text-destructive"
              onClick={() => applyToggle(confirmUnverify, false)}
            >
              Unverify
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
