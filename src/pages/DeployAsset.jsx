import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/mapbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, MapPin } from 'lucide-react'

export default function DeployAsset() {
  const { assetId } = useParams()
  const navigate = useNavigate()
  const [asset, setAsset] = useState(null)
  const [form, setForm] = useState({
    address: '', customer_name: '', customer_phone: '', expires_at: '', notes: ''
  })
  const [suggestions, setSuggestions] = useState([])
  const [selectedCoords, setSelectedCoords] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const geocodeTimer = useRef(null)

  useEffect(() => {
    supabase
      .from('assets')
      .select('*, asset_types(name)')
      .eq('id', assetId)
      .single()
      .then(({ data }) => { if (data) setAsset(data) })
  }, [assetId])

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
    setSaving(true)
    const { error } = await supabase.from('deployments').insert({
      asset_id: assetId,
      address: form.address,
      lat: selectedCoords.lat,
      lng: selectedCoords.lng,
      customer_name: form.customer_name || null,
      customer_phone: form.customer_phone || null,
      notes: form.notes || null,
      expires_at: form.expires_at || null,
      dropped_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    navigate('/')
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
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
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
          <Label htmlFor="customer_name">Customer Name</Label>
          <Input
            id="customer_name"
            placeholder="John Smith"
            value={form.customer_name}
            onChange={e => set('customer_name', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="customer_phone">Customer Phone</Label>
          <Input
            id="customer_phone"
            type="tel"
            placeholder="(555) 000-0000"
            value={form.customer_phone}
            onChange={e => set('customer_phone', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="expires_at">Expected Pick Up</Label>
          <input
            id="expires_at"
            type="date"
            value={form.expires_at}
            onChange={e => set('expires_at', e.target.value)}
            onClick={e => { try { e.target.showPicker() } catch {} }}
            className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer"
          />
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
