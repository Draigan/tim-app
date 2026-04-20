import { useState, useRef, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/mapbox'
import { getMarkerColor, formatPhone } from '@/lib/utils'
import { Phone, MapPin, Calendar, User, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function expiryBadge(expiresAt) {
  if (!expiresAt) return { label: 'No expiry set', variant: 'secondary' }
  const daysLeft = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return { label: 'Expired', variant: 'destructive' }
  if (daysLeft === 0) return { label: 'Expires today', variant: 'destructive' }
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, variant: 'warning' }
  return { label: `${daysLeft}d left`, variant: 'success' }
}

function UpdateDialog({ deployment, open, onOpenChange, onSaved }) {
  const [address, setAddress] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [selectedCoords, setSelectedCoords] = useState(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (open) {
      setAddress(deployment.address ?? '')
      setSelectedCoords({ lng: deployment.lng, lat: deployment.lat })
      setCustomerName(deployment.customer_name ?? '')
      setCustomerPhone(deployment.customer_phone ?? '')
      setExpiresAt(deployment.expires_at ?? '')
      setNotes(deployment.notes ?? '')
      setSuggestions([])
    }
  }, [open, deployment])

  function handleAddressChange(value) {
    setAddress(value)
    setSelectedCoords(null)
    clearTimeout(timer.current)
    if (value.length < 4) { setSuggestions([]); return }
    timer.current = setTimeout(async () => {
      const results = await geocodeAddress(value)
      setSuggestions(results)
    }, 350)
  }

  function selectSuggestion(feature) {
    setAddress(feature.place_name)
    setSelectedCoords({ lng: feature.center[0], lat: feature.center[1] })
    setSuggestions([])
  }

  async function handleSave() {
    if (!selectedCoords) return
    setSaving(true)
    const addressChanged = address !== deployment.address
    const now = new Date().toISOString()

    if (addressChanged) {
      await supabase.from('deployments').update({ picked_up_at: now }).eq('id', deployment.id)
      await supabase.from('deployments').insert({
        asset_id: deployment.asset_id,
        address,
        lat: selectedCoords.lat,
        lng: selectedCoords.lng,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        notes: notes || null,
        expires_at: expiresAt || null,
        dropped_at: now,
      })
    } else {
      await supabase.from('deployments').update({
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        expires_at: expiresAt || null,
        notes: notes || null,
      }).eq('id', deployment.id)
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update {deployment.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Address</p>
            <div className="relative">
              <Input
                placeholder="Start typing an address…"
                value={address}
                onChange={e => handleAddressChange(e.target.value)}
                autoComplete="off"
              />
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
            {address !== deployment.address && selectedCoords && (
              <p className="text-xs text-green-600 flex items-center gap-1 mt-1"><MapPin size={12} /> New location confirmed — history will be preserved</p>
            )}
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
            <p className="text-xs text-muted-foreground mb-1.5">Expected Pick Up</p>
            <input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              onClick={e => { try { e.target.showPicker() } catch {} }}
              className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Placement instructions…" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !selectedCoords}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SingleAsset({ deployment, onBack, onClose, onPickup, readOnly = false }) {
  const navigate = useNavigate()
  const [showUpdate, setShowUpdate] = useState(false)
  const badge = expiryBadge(deployment.expires_at)

  async function handlePickup() {
    await supabase.from('deployments').update({ picked_up_at: new Date().toISOString() }).eq('id', deployment.id)
    onPickup()
  }

  return (
    <>
      <SheetHeader className="pr-6">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-1 hover:text-foreground w-fit">
            <ChevronLeft size={16} /> All assets here
          </button>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getMarkerColor(deployment.expires_at) }} />
          <SheetTitle>{deployment.label}</SheetTitle>
          <span className="text-muted-foreground text-sm">{deployment.type_name}</span>
          {deployment.size && <span className="text-muted-foreground text-sm">· {deployment.size}</span>}
        </div>
        <Badge variant={badge.variant} className="w-fit mt-1">{badge.label}</Badge>
      </SheetHeader>

      <div className="mt-5 space-y-3">
        <div className="flex items-start gap-3">
          <MapPin size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
          <span className="text-sm">{deployment.address}</span>
        </div>
        {deployment.customer_name && (
          <div className="flex items-center gap-3">
            <User size={16} className="text-muted-foreground flex-shrink-0" />
            <span className="text-sm">{deployment.customer_name}</span>
          </div>
        )}
        {deployment.customer_phone && (
          <a href={`tel:${deployment.customer_phone}`} className="flex items-center gap-3 text-primary">
            <Phone size={16} className="flex-shrink-0" />
            <span className="text-sm">{formatPhone(deployment.customer_phone)}</span>
          </a>
        )}
        {deployment.expires_at && (
          <div className="flex items-center gap-3">
            <Calendar size={16} className="text-muted-foreground flex-shrink-0" />
            <span className="text-sm">Expires {new Date(deployment.expires_at + 'T00:00:00').toLocaleDateString()}</span>
          </div>
        )}
        {deployment.notes && (
          <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">{deployment.notes}</p>
        )}
      </div>

      <div className="mt-6 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {!readOnly && deployment.lng && (
            <Button variant="outline" onClick={() => { onClose(); navigate('/', { state: { flyTo: [deployment.lng, deployment.lat] } }) }}>
              View on Map
            </Button>
          )}
          <Button variant="outline" onClick={() => { onClose(); navigate(`/assets/${deployment.asset_id}`) }}>
            View Asset
          </Button>
          {!readOnly && (
            <Button variant="outline" onClick={() => setShowUpdate(true)}>
              Update
            </Button>
          )}
        </div>
        {!readOnly && (
          <Button variant="destructive" className="w-full" onClick={handlePickup}>
            Pick Up
          </Button>
        )}
      </div>

      {!readOnly && (
        <UpdateDialog
          deployment={deployment}
          open={showUpdate}
          onOpenChange={setShowUpdate}
          onSaved={() => { setShowUpdate(false); onPickup() }}
        />
      )}
    </>
  )
}

export default function AssetBottomSheet({ deployments, onClose, onPickup, readOnly = false }) {
  const [focused, setFocused] = useState(null)

  const isOpen = !!deployments?.length
  const isMulti = deployments?.length > 1
  const showList = isMulti && !focused
  const current = focused ?? (!isMulti ? deployments?.[0] : null)

  function handleOpenChange(open) {
    if (!open) { setFocused(null); onClose() }
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto pb-8">
        {showList && (
          <>
            <SheetHeader className="pr-6">
              <SheetTitle>{deployments[0].address}</SheetTitle>
              <p className="text-sm text-muted-foreground">{deployments.length} assets at this location</p>
            </SheetHeader>
            <div className="mt-4 space-y-2">
              {deployments.map(dep => (
                <button
                  key={dep.id}
                  className="w-full text-left border rounded-xl p-4 hover:bg-accent transition-colors"
                  onClick={() => setFocused(dep)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getMarkerColor(dep.expires_at) }} />
                    <span className="font-medium">{dep.label}</span>
                    <span className="text-muted-foreground text-sm">{dep.type_name}</span>
                    {dep.size && <span className="text-muted-foreground text-sm">· {dep.size}</span>}
                  </div>
                  {dep.customer_name && <p className="text-sm text-muted-foreground mt-1 ml-5">{dep.customer_name}</p>}
                </button>
              ))}
            </div>
          </>
        )}

        {current && (
          <SingleAsset
            deployment={current}
            onBack={isMulti ? () => setFocused(null) : null}
            onClose={onClose}
            onPickup={() => { setFocused(null); onPickup() }}
            readOnly={readOnly}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
