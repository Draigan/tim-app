import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { useIsAdmin } from '@/lib/useIsAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, ChevronRight, Pencil, Warehouse } from 'lucide-react'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'

const STORAGE_AREAS = [
  { value: 'none', label: 'Unassigned' },
  { value: 'up_top', label: 'Up Top' },
  { value: 'down_below', label: 'Down Below' },
]

function storageAreaLabel(area) {
  return STORAGE_AREAS.find(option => option.value === area)?.label ?? 'Unassigned'
}

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
  const [storageUnits, setStorageUnits] = useState([])
  const [showAddUnit, setShowAddUnit] = useState(false)
  const [newUnitNumber, setNewUnitNumber] = useState('')
  const [newUnitSize, setNewUnitSize] = useState('')
  const [newUnitNotes, setNewUnitNotes] = useState('')
  const [unitError, setUnitError] = useState('')
  const [savingUnit, setSavingUnit] = useState(false)
  const [confirmDeleteUnit, setConfirmDeleteUnit] = useState(null)
  const [editUnit, setEditUnit] = useState(null)
  const [editUnitNumber, setEditUnitNumber] = useState('')
  const [editUnitSize, setEditUnitSize] = useState('')
  const [editUnitArea, setEditUnitArea] = useState('none')
  const [editUnitNotes, setEditUnitNotes] = useState('')
  const [renameAsset, setRenameAsset] = useState(null)
  const [renameLabel, setRenameLabel] = useState('')
  const [renameSize, setRenameSize] = useState('')

  const fetchAll = useCallback(async () => {
    const [{ data: assetData }, { data: deployments }, { data: typeData }, { data: unitData }, { data: tenancyData }] = await Promise.all([
      supabase.from('assets').select('*, asset_types(name, icon)').eq('archived', false).order('label'),
      supabase.from('active_deployments').select('asset_id'),
      supabase.from('asset_types').select('*').order('name'),
      supabase.from('storage_units').select('id, unit_number, size, area, notes').order('unit_number'),
      supabase.from('storage_tenancies').select('unit_id, tenant_name').eq('storage_kind', 'fixed_unit').is('end_date', null),
    ])
    if (assetData) setAssets(assetData)
    if (deployments) setDeployedIds(new Set(deployments.map(d => d.asset_id)))
    if (typeData) setTypes(typeData)
    if (unitData) {
      const tenantByUnit = Object.fromEntries((tenancyData ?? []).map(t => [t.unit_id, t.tenant_name]))
      setStorageUnits(unitData.map(u => ({ ...u, tenant_name: tenantByUnit[u.id] ?? null })))
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(fetchAll, 0)
    return () => clearTimeout(timer)
  }, [fetchAll])
  useRealtime(['assets', 'asset_types', 'deployments', 'storage_units', 'storage_tenancies'], fetchAll)

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

  async function saveRename() {
    if (!renameLabel.trim()) { setRenameAsset(null); return }
    await supabase.from('assets').update({
      label: renameLabel.trim(),
      size: renameSize.trim() || null,
    }).eq('id', renameAsset.id)
    setRenameAsset(null)
    fetchAll()
  }

  async function archiveAsset() {
    setDeletingId(confirmDeleteAsset.id)
    await supabase.from('assets').update({ archived: true }).eq('id', confirmDeleteAsset.id)
    setDeletingId(null)
    setConfirmDeleteAsset(null)
    fetchAll()
  }

  async function addStorageUnit() {
    if (!newUnitNumber.trim()) return
    setSavingUnit(true)
    setUnitError('')
    const { error } = await supabase.from('storage_units').insert({
      unit_number: newUnitNumber.trim(),
      size: newUnitSize.trim() || null,
      notes: newUnitNotes.trim() || null,
    })
    setSavingUnit(false)
    if (error) {
      setUnitError(error.message)
      return
    }
    setNewUnitNumber('')
    setNewUnitSize('')
    setNewUnitNotes('')
    setShowAddUnit(false)
    fetchAll()
  }

  function openEditStorageUnit(unit) {
    setEditUnit(unit)
    setEditUnitNumber(unit.unit_number ?? '')
    setEditUnitSize(unit.size ?? '')
    setEditUnitArea(unit.area ?? 'none')
    setEditUnitNotes(unit.notes ?? '')
    setUnitError('')
  }

  async function saveStorageUnit() {
    if (!editUnit || !editUnitNumber.trim()) return
    setSavingUnit(true)
    setUnitError('')
    const { error } = await supabase.from('storage_units').update({
      unit_number: editUnitNumber.trim(),
      size: editUnitSize.trim() || null,
      area: editUnitArea === 'none' ? null : editUnitArea,
      notes: editUnitNotes.trim() || null,
    }).eq('id', editUnit.id)
    setSavingUnit(false)
    if (error) {
      setUnitError(error.message)
      return
    }
    setEditUnit(null)
    fetchAll()
  }

  async function deleteStorageUnit() {
    await supabase.from('storage_units').delete().eq('id', confirmDeleteUnit.id)
    setConfirmDeleteUnit(null)
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
        <h1 className="text-xl font-semibold">Asset Manager</h1>
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
                    <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => { setRenameLabel(asset.label); setRenameSize(asset.size ?? ''); setRenameAsset(asset) }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { setDeleteError(''); setConfirmDeleteAsset(asset) }}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
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
                <div className="flex items-center gap-3">
                  <button
                    title={type.is_storage ? 'Shown on Storage tab' : 'Not on Storage tab'}
                    className={`transition-colors ${type.is_storage ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={async () => {
                      await supabase.from('asset_types').update({ is_storage: !type.is_storage }).eq('id', type.id)
                      fetchAll()
                    }}
                  >
                    <Warehouse size={15} />
                  </button>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                    onClick={() => { setDeleteError(''); setConfirmDeleteType(type) }}
                    disabled={deletingId === type.id}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fixed Storage Units</p>
            <Button size="sm" variant="outline" onClick={() => { setNewUnitNumber(''); setNewUnitSize(''); setNewUnitNotes(''); setUnitError(''); setShowAddUnit(true) }}>
              <Plus size={14} />
              Add Unit
            </Button>
          </div>
          <div className="space-y-2">
            {storageUnits.map(unit => (
              <div key={unit.id} className="bg-card border rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{unit.unit_number}{unit.size ? ` · ${unit.size}` : ''}</p>
                  <p className="text-xs text-muted-foreground">
                    {unit.tenant_name ?? 'Vacant'} · {storageAreaLabel(unit.area)}
                  </p>
                  {unit.notes && <p className="text-xs text-muted-foreground mt-0.5">{unit.notes}</p>}
                </div>
                <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEditStorageUnit(unit)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteUnit(unit)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {storageUnits.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No storage units yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Rename asset dialog */}
      <Dialog open={!!renameAsset} onOpenChange={open => !open && setRenameAsset(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Name</p>
              <Input
                value={renameLabel}
                onChange={e => setRenameLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), saveRename())}
                autoFocus
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Size</p>
              <Input
                value={renameSize}
                onChange={e => setRenameSize(e.target.value)}
                placeholder="e.g. 10ft, 20x8"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), saveRename())}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setRenameAsset(null)}>Cancel</Button>
              <Button className="flex-1" onClick={saveRename} disabled={!renameLabel.trim()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete asset dialog */}
      <Dialog open={!!confirmDeleteAsset} onOpenChange={open => { if (!open) { setConfirmDeleteAsset(null); setDeleteError('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove "{confirmDeleteAsset?.label}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">This hides the asset from the app. All history is kept.</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => { setConfirmDeleteAsset(null); setDeleteError('') }}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={archiveAsset} disabled={!!deletingId}>
              {deletingId ? 'Removing…' : 'Remove'}
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

      <Dialog open={showAddUnit} onOpenChange={v => { if (!v) { setShowAddUnit(false); setUnitError('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Storage Unit</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Unit Number</p>
              <Input placeholder="A1" value={newUnitNumber} onChange={e => setNewUnitNumber(e.target.value)} autoFocus />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Size</p>
              <Input placeholder='e.g. 10x20, 8ft' value={newUnitSize} onChange={e => setNewUnitSize(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
              <Input placeholder="Location, access info…" value={newUnitNotes} onChange={e => setNewUnitNotes(e.target.value)} />
            </div>
            {unitError && <p className="text-sm text-destructive">{unitError}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddUnit(false)} disabled={savingUnit}>Cancel</Button>
              <Button className="flex-1" onClick={addStorageUnit} disabled={!newUnitNumber.trim() || savingUnit}>
                {savingUnit ? 'Adding…' : 'Add Unit'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editUnit} onOpenChange={open => { if (!open) { setEditUnit(null); setUnitError('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Storage Unit</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Unit Number</p>
              <Input
                value={editUnitNumber}
                onChange={e => setEditUnitNumber(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), saveStorageUnit())}
                autoFocus
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Size</p>
              <Input
                placeholder="e.g. 10x20, 8ft"
                value={editUnitSize}
                onChange={e => setEditUnitSize(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), saveStorageUnit())}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Area</p>
              <Select value={editUnitArea} onValueChange={setEditUnitArea}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORAGE_AREAS.map(area => (
                    <SelectItem key={area.value} value={area.value}>{area.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
              <Input
                placeholder="Location, access info…"
                value={editUnitNotes}
                onChange={e => setEditUnitNotes(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), saveStorageUnit())}
              />
            </div>
            {unitError && <p className="text-sm text-destructive">{unitError}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditUnit(null)} disabled={savingUnit}>Cancel</Button>
              <Button className="flex-1" onClick={saveStorageUnit} disabled={!editUnitNumber.trim() || savingUnit}>
                {savingUnit ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDeleteUnit} onOpenChange={open => !open && setConfirmDeleteUnit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete unit "{confirmDeleteUnit?.unit_number}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">This permanently removes the unit and all its payment history.</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteUnit(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={deleteStorageUnit}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
