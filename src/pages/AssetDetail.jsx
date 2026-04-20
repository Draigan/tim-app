import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Truck, MapPin, Calendar, User, Phone, Pencil } from 'lucide-react'
import { formatPhone } from '@/lib/utils'

function statusBadge(dep) {
  if (dep.picked_up_at) return { label: 'Returned', variant: 'secondary' }
  if (!dep.expires_at) return { label: 'Deployed', variant: 'default' }
  const daysLeft = Math.ceil((new Date(dep.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return { label: 'Expired', variant: 'destructive' }
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, variant: 'warning' }
  return { label: 'Active', variant: 'success' }
}

function duration(droppedAt, pickedUpAt) {
  const end = pickedUpAt ? new Date(pickedUpAt) : new Date()
  const days = Math.round((end - new Date(droppedAt)) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Less than a day'
  return `${days} day${days === 1 ? '' : 's'}`
}

function EditAssetDialog({ asset, open, onOpenChange, onSaved }) {
  const [types, setTypes] = useState([])
  const [label, setLabel] = useState('')
  const [size, setSize] = useState('')
  const [typeId, setTypeId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('asset_types').select('*').order('name').then(({ data }) => {
      if (data) setTypes(data)
    })
  }, [])

  useEffect(() => {
    if (open) {
      setLabel(asset.label ?? '')
      setSize(asset.size ?? '')
      setTypeId(asset.asset_type_id ?? '')
      setNotes(asset.notes ?? '')
    }
  }, [open, asset])

  async function handleSave() {
    setSaving(true)
    await supabase.from('assets').update({
      label: label.trim(),
      size: size || null,
      asset_type_id: typeId,
      notes: notes || null,
    }).eq('id', asset.id)
    setSaving(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Type</p>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>
                {types.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Label / ID</p>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. BIN-04" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Size</p>
            <Input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 20yd" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !label.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function AssetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [asset, setAsset] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

  async function load() {
    const [{ data: assetData }, { data: depData }] = await Promise.all([
      supabase.from('assets').select('*, asset_types(name)').eq('id', id).single(),
      supabase.from('deployments').select('*').eq('asset_id', id).order('dropped_at', { ascending: false }),
    ])
    if (assetData) setAsset(assetData)
    if (depData) setDeployments(depData)
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

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
        <button onClick={() => setShowEdit(true)} className="text-muted-foreground hover:text-foreground mr-1">
          <Pencil size={17} />
        </button>
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate pr-2">{dep.address}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  {dep.customer_name && (
                    <p className="text-muted-foreground">{dep.customer_name}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>{new Date(dep.dropped_at).toLocaleDateString()}</span>
                    <span>→</span>
                    <span>{dep.picked_up_at ? new Date(dep.picked_up_at).toLocaleDateString() : 'Present'}</span>
                    <span className="text-muted-foreground/60">· {duration(dep.dropped_at, dep.picked_up_at)}</span>
                  </div>
                  {dep.notes && (
                    <p className="text-muted-foreground bg-muted rounded-lg p-2.5">{dep.notes}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <EditAssetDialog
        asset={asset}
        open={showEdit}
        onOpenChange={setShowEdit}
        onSaved={() => { setShowEdit(false); load() }}
      />
    </div>
  )
}
