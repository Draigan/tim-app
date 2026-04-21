import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Truck, MapPin, Calendar, User, Phone, Pencil, BookMarked, Trash2 } from 'lucide-react'
import { formatPhone } from '@/lib/utils'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'
import { geocodeAddress } from '@/lib/mapbox'
import { useIsAdmin } from '@/lib/useIsAdmin'

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ReserveDialog({ assetId, open, onOpenChange, onSaved }) {
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const geocodeTimer = useRef(null)

  useEffect(() => {
    if (open) { setCustomerName(''); setCustomerPhone(''); setAddress(''); setSuggestions([]); setFromDate(''); setToDate(''); setNotes('') }
  }, [open])

  function handleAddressChange(value) {
    setAddress(value)
    clearTimeout(geocodeTimer.current)
    if (value.length < 4) { setSuggestions([]); return }
    geocodeTimer.current = setTimeout(async () => {
      const results = await geocodeAddress(value)
      setSuggestions(results)
    }, 350)
  }

  function selectSuggestion(feature) {
    setAddress(feature.place_name)
    setSuggestions([])
  }

  async function handleSave() {
    setSaving(true)
    await supabase.from('reservations').insert({
      asset_id: assetId,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      address: address || null,
      from_date: fromDate,
      to_date: toDate,
      notes: notes || null,
    })
    setSaving(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Reservation</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">From</p>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                onClick={e => { try { e.target.showPicker() } catch {} }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">To</p>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                onClick={e => { try { e.target.showPicker() } catch {} }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer" />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Customer Name</p>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="John Smith" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Customer Phone</p>
            <Input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(555) 000-0000" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Address</p>
            <div className="relative">
              <Input value={address} onChange={e => handleAddressChange(e.target.value)} placeholder="123 Main St, City…" autoComplete="off" />
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden">
                  {suggestions.map(s => (
                    <button key={s.id} type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent flex items-start gap-2"
                      onClick={() => selectSuggestion(s)}
                    >
                      <MapPin size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Event details, placement notes…" rows={2} />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !fromDate || !toDate}>
              {saving ? 'Saving…' : 'Reserve'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

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
  const [typeIcon, setTypeIcon] = useState('')
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
      setTypeIcon(asset.type_icon ?? '')
    }
  }, [open, asset])

  // sync icon when type changes
  function handleTypeChange(id) {
    setTypeId(id)
    const t = types.find(t => t.id === id)
    if (t) setTypeIcon(t.icon ?? '')
  }

  async function handleSave() {
    setSaving(true)
    await Promise.all([
      supabase.from('assets').update({
        label: label.trim(),
        size: size || null,
        asset_type_id: typeId,
        notes: notes || null,
      }).eq('id', asset.id),
      typeId && typeIcon
        ? supabase.from('asset_types').update({ icon: typeIcon }).eq('id', typeId)
        : Promise.resolve(),
    ])
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
            <Select value={typeId} onValueChange={handleTypeChange}>
              <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>
                {types.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Icon</p>
            <div className="grid grid-cols-6 gap-1">
              {ICON_OPTIONS.map(({ key, label: iconLabel }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTypeIcon(key)}
                  title={iconLabel}
                  className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${typeIcon === key ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-accent'}`}
                >
                  <img src={iconImgUrl(key)} width="20" height="20" alt={iconLabel} />
                  <span className="text-[9px] text-muted-foreground leading-tight text-center">{iconLabel}</span>
                </button>
              ))}
            </div>
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
  const isAdmin = useIsAdmin()
  const [asset, setAsset] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [showReserve, setShowReserve] = useState(false)
  const [confirmDeleteRes, setConfirmDeleteRes] = useState(null)

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const [{ data: assetData }, { data: depData }, { data: resData }] = await Promise.all([
      supabase.from('assets').select('*, asset_types(name)').eq('id', id).single(),
      supabase.from('deployments').select('*').eq('asset_id', id).order('dropped_at', { ascending: false }),
      supabase.from('reservations').select('*').eq('asset_id', id).gte('to_date', today).order('from_date'),
    ])
    if (assetData) setAsset(assetData)
    if (depData) setDeployments(depData)
    if (resData) setReservations(resData)
    setLoading(false)
  }

  async function deleteReservation(resId) {
    await supabase.from('reservations').delete().eq('id', resId)
    load()
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
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-xl font-semibold truncate">{asset.label}</h1>
            {isAdmin && (
              <button onClick={() => setShowEdit(true)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <Pencil size={14} />
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {asset.asset_types.name}{asset.size ? ` · ${asset.size}` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowReserve(true)}>
              <BookMarked size={14} />
              Reserve
            </Button>
          )}
          {!activeDeployment && (
            <Button size="sm" onClick={() => navigate(`/deploy/${asset.id}`)}>
              <Truck size={14} />
              Deploy
            </Button>
          )}
        </div>
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

        {reservations.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Upcoming Reservations ({reservations.length})
            </h2>
            <div className="space-y-2">
              {reservations.map(res => {
                const daysUntil = Math.ceil((new Date(res.from_date + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24))
                const soon = daysUntil <= 7
                return (
                  <div key={res.id} className={`border rounded-xl p-4 space-y-2 text-sm ${soon ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className={soon ? 'text-amber-500' : 'text-muted-foreground'} />
                        <span className={`font-medium ${soon ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                          {fmtDate(res.from_date)} → {fmtDate(res.to_date)}
                        </span>
                      </div>
                      {isAdmin && (
                        <button onClick={() => setConfirmDeleteRes(res)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {res.customer_name && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <User size={13} className="flex-shrink-0" />
                        <span>{res.customer_name}</span>
                      </div>
                    )}
                    {res.customer_phone && (
                      <a href={`tel:${res.customer_phone}`} className="flex items-center gap-2 text-primary">
                        <Phone size={13} className="flex-shrink-0" />
                        <span>{formatPhone(res.customer_phone)}</span>
                      </a>
                    )}
                    {res.address && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin size={13} className="flex-shrink-0 mt-0.5" />
                        <span>{res.address}</span>
                      </div>
                    )}
                    {res.notes && (
                      <p className="text-muted-foreground bg-muted rounded-lg p-2.5">{res.notes}</p>
                    )}
                  </div>
                )
              })}
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
      <ReserveDialog
        assetId={asset.id}
        open={showReserve}
        onOpenChange={setShowReserve}
        onSaved={() => { setShowReserve(false); load() }}
      />
      <Dialog open={!!confirmDeleteRes} onOpenChange={v => { if (!v) setConfirmDeleteRes(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Reservation?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">
            {confirmDeleteRes && `${fmtDate(confirmDeleteRes.from_date)} → ${fmtDate(confirmDeleteRes.to_date)}${confirmDeleteRes.customer_name ? ` · ${confirmDeleteRes.customer_name}` : ''}`}
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteRes(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={() => { deleteReservation(confirmDeleteRes.id); setConfirmDeleteRes(null) }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
