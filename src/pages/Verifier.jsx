import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRealtime } from '@/lib/useRealtime'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const DUMPSTER_TYPE = 'Dumpster'

export default function Verifier() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')
  const [confirmUnverify, setConfirmUnverify] = useState(null)

  const fetchAssets = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('assets')
      .select('id, label, size, notes, verified_at, verified_by, asset_types!inner(name)')
      .eq('archived', false)
      .eq('asset_types.name', DUMPSTER_TYPE)
      .order('label')

    if (loadError) {
      setError(loadError.message)
    } else {
      setError('')
      setAssets(data ?? [])
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAssets() }, [fetchAssets])
  useRealtime(['assets'], fetchAssets)

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
