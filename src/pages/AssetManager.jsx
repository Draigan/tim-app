import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { useIsAdmin } from '@/lib/useIsAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, ChevronRight, ArrowLeft } from 'lucide-react'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'

export default function AssetManager() {
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [assets, setAssets] = useState([])
  const [deployedIds, setDeployedIds] = useState(new Set())
  const [types, setTypes] = useState([])
  const [showAddType, setShowAddType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('box')
  const [confirmDeleteType, setConfirmDeleteType] = useState(null)
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const fetchAll = useCallback(async () => {
    const [{ data: assetData }, { data: deployments }, { data: typeData }] = await Promise.all([
      supabase.from('assets').select('*, asset_types(name, icon)').order('label'),
      supabase.from('active_deployments').select('asset_id'),
      supabase.from('asset_types').select('*').order('name'),
    ])
    if (assetData) setAssets(assetData)
    if (deployments) setDeployedIds(new Set(deployments.map(d => d.asset_id)))
    if (typeData) setTypes(typeData)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['assets', 'asset_types', 'deployments'], fetchAll)

  async function addType() {
    if (!newTypeName.trim()) return
    await supabase.from('asset_types').insert({ name: newTypeName.trim(), icon: newTypeIcon })
    setNewTypeName('')
    setNewTypeIcon('box')
    setShowAddType(false)
    fetchAll()
  }

  async function deleteType() {
    setDeletingId(confirmDeleteType.id)
    setDeleteError('')
    const { error } = await supabase.from('asset_types').delete().eq('id', confirmDeleteType.id)
    setDeletingId(null)
    if (error) {
      setDeleteError('This type is still used by one or more assets. Remove or retype those assets first.')
      return
    }
    setConfirmDeleteType(null)
    fetchAll()
  }

  async function deleteAsset() {
    setDeletingId(confirmDeleteAsset.id)
    const { error } = await supabase.from('assets').delete().eq('id', confirmDeleteAsset.id)
    setDeletingId(null)
    if (error) {
      setDeleteError('Could not delete this asset. It may have active deployments or history.')
      return
    }
    setConfirmDeleteAsset(null)
    fetchAll()
  }

  const grouped = assets.reduce((acc, asset) => {
    const key = asset.asset_types?.name ?? 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(asset)
    return acc
  }, {})

  if (!isAdmin) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Not available</div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground -ml-1">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold">Asset Manager</h1>
        </div>
        <Button size="sm" onClick={() => navigate('/assets/new', { state: { from: '/asset-manager' } })}>
          <Plus size={16} />
          Add Asset
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-6">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            All Assets ({assets.length})
          </p>
          {Object.entries(grouped).map(([typeName, items]) => (
            <div key={typeName} className="mb-4">
              <p className="text-xs text-muted-foreground mb-2">{typeName} ({items.length})</p>
              <div className="space-y-2">
                {items.map(asset => (
                  <div key={asset.id} className="bg-card border rounded-xl px-4 py-3 flex items-center justify-between">
                    <button onClick={() => navigate(`/assets/${asset.id}`)} className="flex-1 min-w-0 text-left flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{asset.label}</p>
                        {asset.size && <p className="text-xs text-muted-foreground">{asset.size}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs ${deployedIds.has(asset.id) ? 'text-primary' : 'text-muted-foreground'}`}>
                          {deployedIds.has(asset.id) ? 'Deployed' : 'In Yard'}
                        </span>
                        <ChevronRight size={16} className="text-muted-foreground" />
                      </div>
                    </button>
                    <button
                      onClick={() => { setDeleteError(''); setConfirmDeleteAsset(asset) }}
                      className="ml-3 flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Asset Types</p>
            <Button size="sm" variant="outline" onClick={() => setShowAddType(true)}>
              <Plus size={14} />
              Add Type
            </Button>
          </div>
          <div className="space-y-2">
            {types.map(type => (
              <div key={type.id} className="flex items-center justify-between bg-card border rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  {type.icon && <img src={iconImgUrl(type.icon, 18)} width="18" height="18" alt={type.name} />}
                  <span className="text-sm font-medium">{type.name}</span>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  onClick={() => { setDeleteError(''); setConfirmDeleteType(type) }}
                  disabled={deletingId === type.id}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delete asset dialog */}
      <Dialog open={!!confirmDeleteAsset} onOpenChange={open => { if (!open) { setConfirmDeleteAsset(null); setDeleteError('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete "{confirmDeleteAsset?.label}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">This permanently removes the asset and cannot be undone.</p>
          {deleteError && <p className="text-sm text-destructive mt-2">{deleteError}</p>}
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => { setConfirmDeleteAsset(null); setDeleteError('') }}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={deleteAsset} disabled={!!deletingId}>
              {deletingId ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete type dialog */}
      <Dialog open={!!confirmDeleteType} onOpenChange={open => { if (!open) { setConfirmDeleteType(null); setDeleteError('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete "{confirmDeleteType?.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">This will remove the type permanently.</p>
          {deleteError && <p className="text-sm text-destructive mt-2">{deleteError}</p>}
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => { setConfirmDeleteType(null); setDeleteError('') }}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={deleteType} disabled={!!deletingId}>
              {deletingId ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add type dialog */}
      <Dialog open={showAddType} onOpenChange={setShowAddType}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Asset Type</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <Input
              placeholder="Type name…"
              value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addType())}
              autoFocus
            />
            <div>
              <p className="text-sm text-muted-foreground mb-2">Icon</p>
              <div className="grid grid-cols-6 gap-1">
                {ICON_OPTIONS.map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setNewTypeIcon(key)} title={label}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${newTypeIcon === key ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-accent'}`}>
                    <img src={iconImgUrl(key)} width="20" height="20" alt={label} />
                    <span className="text-[9px] text-muted-foreground leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddType(false)}>Cancel</Button>
              <Button className="flex-1" onClick={addType} disabled={!newTypeName.trim()}>Add Type</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
