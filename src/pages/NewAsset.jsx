import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowLeft, Plus } from 'lucide-react'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'

export default function NewAsset() {
  const navigate = useNavigate()
  const [types, setTypes] = useState([])
  const [form, setForm] = useState({ asset_type_id: '', size: '', label: '', notes: '' })
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('box')
  const [showNewType, setShowNewType] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('asset_types').select('*').order('name').then(({ data }) => {
      if (data) setTypes(data)
    })
  }, [])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function addNewType() {
    if (!newTypeName.trim()) return
    const { data, error } = await supabase
      .from('asset_types')
      .insert({ name: newTypeName.trim(), icon: newTypeIcon })
      .select()
      .single()
    if (!error && data) {
      setTypes(t => [...t, data].sort((a, b) => a.name.localeCompare(b.name)))
      set('asset_type_id', data.id)
      setShowNewType(false)
      setNewTypeName('')
      setNewTypeIcon('box')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_type_id || !form.label.trim()) {
      setError('Type and label are required.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('assets').insert({
      asset_type_id: form.asset_type_id,
      size: form.size || null,
      label: form.label.trim(),
      notes: form.notes || null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    navigate('/inventory')
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold">Add Asset</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        <div className="space-y-2">
          <Label>Type</Label>
          <div className="flex gap-2">
            <Select value={form.asset_type_id} onValueChange={v => { if (v === '__new__') { setShowNewType(true) } else { set('asset_type_id', v) } }}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {types.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
                <SelectItem value="__new__" className="text-primary font-medium">
                  <span className="flex items-center gap-1.5"><Plus size={13} /> New type…</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="icon" onClick={() => setShowNewType(true)}>
              <Plus size={16} />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="label">Label / ID</Label>
          <Input
            id="label"
            placeholder="e.g. BIN-04"
            value={form.label}
            onChange={e => set('label', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="size">Size</Label>
          <Input
            id="size"
            placeholder="e.g. 20yd, 40ft"
            value={form.size}
            onChange={e => set('size', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            placeholder="Any notes about this unit…"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Saving…' : 'Add to Inventory'}
        </Button>
      </form>

      <Dialog open={showNewType} onOpenChange={setShowNewType}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Asset Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <Input
              placeholder="Type name…"
              value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addNewType())}
              autoFocus
            />
            <div>
              <p className="text-sm text-muted-foreground mb-2">Icon</p>
              <div className="grid grid-cols-6 gap-1">
                {ICON_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewTypeIcon(key)}
                    title={label}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${newTypeIcon === key ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-accent'}`}
                  >
                    <img src={iconImgUrl(key)} width="20" height="20" alt={label} />
                    <span className="text-[9px] text-muted-foreground leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowNewType(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={addNewType}>
                Add Type
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
