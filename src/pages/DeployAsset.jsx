import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/mapbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, MapPin, TriangleAlert, X } from 'lucide-react'
import CustomerPicker from '@/components/CustomerPicker'

export default function DeployAsset() {
  const { assetId } = useParams()
  const navigate = useNavigate()
  const [asset, setAsset] = useState(null)
  const [reservations, setReservations] = useState([])
  const [form, setForm] = useState({ address: '', expires_at: '', notes: '' })
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [selectedCoords, setSelectedCoords] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const geocodeTimer = useRef(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('assets').select('*, asset_types(name)').eq('id', assetId).single(),
      supabase.from('reservations').select('*').eq('asset_id', assetId).gte('to_date', today).order('from_date'),
    ]).then(([{ data: a }, { data: r }]) => {
      if (a) setAsset(a)
      if (r) setReservations(r)
    })
  }, [assetId])

  useEffect(() => {
    if (!selectedCustomer?.address) return
    set('address', selectedCustomer.address)
    setSelectedCoords(null)
    geocodeAddress(selectedCustomer.address).then(results => {
      if (results[0]) setSelectedCoords({ lng: results[0].center[0], lat: results[0].center[1] })
    })
  }, [selectedCustomer?.id])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function handleAddressChange(value) {
    set('address', value)
    setSelectedCoords(null)
    clearTimeout(geocodeTimer.current)
    if (value.length < 4) { setSuggestions([]); return }
    geocodeTimer.current = setTimeout(async () => {
      const results = await geocodeAddress(value)
      setSuggestions(results)
    }, 350)
  }

  function selectSuggestion(feature) {
    set('address', feature.place_name)
    setSelectedCoords({ lng: feature.center[0], lat: feature.center[1] })
    setSuggestions([])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedCoords) { setError('Please select an address from the suggestions.'); return }
    if (!form.address.trim()) { setError('Address is required.'); return }
    if (!selectedCustomer) { setError('Please select or create a customer.'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('deployments').insert({
      asset_id: assetId,
      address: form.address,
      lat: selectedCoords.lat,
      lng: selectedCoords.lng,
      customer_id: selectedCustomer.id,
      customer_name: selectedCustomer.name || null,
      customer_phone: selectedCustomer.phone || null,
      notes: form.notes || null,
      expires_at: form.expires_at || null,
      dropped_at: new Date().toISOString(),
      deployed_by: user?.user_metadata?.full_name ?? user?.email ?? null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    const today = new Date().toISOString().slice(0, 10)
    await supabase.from('reservations').delete().eq('asset_id', assetId).lte('from_date', today).gte('to_date', today)

    // Notify other users about the deployment (fire-and-forget)
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const label = asset ? `${asset.label}${asset.size ? ` ${asset.size}` : ''}` : 'Asset'
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${label} deployed`,
          body: form.address + (selectedCustomer?.name ? ` · ${selectedCustomer.name}` : ''),
          url: '/',
          exclude_user_id: session.user.id,
        }),
      }).catch(() => {})
    }

    navigate('/', { state: { flyTo: [selectedCoords.lng, selectedCoords.lat] } })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-semibold">Deploy Asset</h1>
          {asset && (
            <p className="text-sm text-muted-foreground">
              {asset.label} · {asset.asset_types.name}{asset.size ? ` · ${asset.size}` : ''}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        {reservations.length > 0 && (() => {
          const next = reservations[0]
          const daysUntil = Math.ceil((new Date(next.from_date + 'T00:00:00') - new Date()) / 86400000)
          const conflict = form.expires_at && form.expires_at >= next.from_date
          return (
            <div className={`flex items-start gap-3 rounded-xl p-4 text-sm ${conflict ? 'bg-destructive/10 border border-destructive/40 text-destructive' : 'bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-400'}`}>
              <TriangleAlert size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {conflict ? 'Pickup date conflicts with reservation' : `Reserved in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}
                </p>
                <p className="text-xs mt-0.5 opacity-80">
                  {next.from_date} → {next.to_date}{next.customer_name ? ` · ${next.customer_name}` : ''}
                </p>
              </div>
            </div>
          )
        })()}

        <div className="space-y-2">
          <Label>Customer</Label>
          <CustomerPicker value={selectedCustomer} onChange={setSelectedCustomer} />
          {selectedCustomer && (
            <div className="space-y-2 pt-1">
              {selectedCustomer.phone && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Phone</p>
                  <Input value={selectedCustomer.phone} readOnly className="text-muted-foreground" />
                </div>
              )}
              {selectedCustomer.email && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Email</p>
                  <Input value={selectedCustomer.email} readOnly className="text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Deployment Address</Label>
          <div className="relative">
            <Input
              id="address"
              placeholder="Start typing an address…"
              value={form.address}
              onChange={e => handleAddressChange(e.target.value)}
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    type="button"
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
          {selectedCoords && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <MapPin size={12} /> Location confirmed
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="expires_at">Expected Pick Up</Label>
          <div className="flex items-center gap-2">
            <input
              id="expires_at"
              type="date"
              value={form.expires_at}
              onChange={e => set('expires_at', e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="flex-1 border border-input rounded-lg px-3 py-2 text-sm bg-background"
            />
            {form.expires_at && (
              <button type="button" onClick={() => set('expires_at', '')} className="text-muted-foreground hover:text-destructive transition-colors">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            placeholder="Placement instructions, contact preferences…"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Deploying…' : 'Deploy Asset'}
        </Button>
      </form>
    </div>
  )
}
