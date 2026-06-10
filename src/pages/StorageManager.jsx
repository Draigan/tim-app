import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useIsAdmin } from '@/lib/useIsAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, ArrowLeft, Pencil } from 'lucide-react'
import { formatPhone, formatPhoneInput } from '@/lib/utils'

const EMPTY_FORM = {
  unit_number: '', tenant_name: '', tenant_phone: '',
  monthly_rate: '', billing_day: '', payment_frequency: 'monthly',
  move_in_date: '', notes: '',
}

const FREQ_LABELS = { monthly: 'Monthly', weekly: 'Weekly', one_time: 'One-time', other: 'Other' }

export default function StorageManager() {
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [units, setUnits] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editUnit, setEditUnit] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const fetchUnits = useCallback(async () => {
    const { data } = await supabase.from('storage_units').select('*').order('unit_number')
    if (data) setUnits(data)
  }, [])

  useEffect(() => { fetchUnits() }, [fetchUnits])

  function openAdd() {
    setEditUnit(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(unit) {
    setEditUnit(unit)
    setForm({
      unit_number:       unit.unit_number       ?? '',
      tenant_name:       unit.tenant_name       ?? '',
      tenant_phone:      formatPhone(unit.tenant_phone ?? ''),
      monthly_rate:      unit.monthly_rate      ?? '',
      billing_day:       unit.billing_day       ?? '',
      payment_frequency: unit.payment_frequency ?? 'monthly',
      move_in_date:      unit.move_in_date      ?? '',
      notes:             unit.notes             ?? '',
    })
    setShowForm(true)
  }

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.unit_number.trim()) return
    setSaving(true)
    const payload = {
      unit_number:       form.unit_number.trim(),
      tenant_name:       form.tenant_name.trim()  || null,
      tenant_phone:      form.tenant_phone.trim() || null,
      monthly_rate:      form.monthly_rate        ? Number(form.monthly_rate)  : null,
      billing_day:       form.billing_day         ? Number(form.billing_day)   : null,
      payment_frequency: form.payment_frequency   || null,
      move_in_date:      form.move_in_date        || null,
      notes:             form.notes.trim()        || null,
    }
    if (editUnit) {
      await supabase.from('storage_units').update(payload).eq('id', editUnit.id)
    } else {
      await supabase.from('storage_units').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    fetchUnits()
  }

  async function handleDelete() {
    setDeleting(true)
    await supabase.from('storage_units').delete().eq('id', confirmDelete.id)
    setDeleting(false)
    setConfirmDelete(null)
    fetchUnits()
  }

  if (!isAdmin) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Not available</div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/settings')} className="text-muted-foreground hover:text-foreground -ml-1">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold">Storage Manager</h1>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus size={16} />
          Add Unit
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Fixed Units ({units.length})
        </p>
        {units.length === 0 && (
          <p className="text-muted-foreground text-sm text-center mt-12">No storage units yet</p>
        )}
        <div className="space-y-2">
          {units.map(unit => (
            <div key={unit.id} className="bg-card border rounded-xl px-4 py-3 flex items-center gap-3">
              <button onClick={() => openEdit(unit)} className="flex-1 min-w-0 text-left">
                <p className="font-medium text-sm">{unit.unit_number}</p>
                {unit.tenant_name
                  ? <p className="text-xs text-muted-foreground">{unit.tenant_name}{unit.monthly_rate ? ` · $${unit.monthly_rate}/mo` : ''}</p>
                  : <p className="text-xs text-muted-foreground">Vacant</p>
                }
              </button>
              <Pencil size={14} className="text-muted-foreground flex-shrink-0" onClick={() => openEdit(unit)} />
              <button
                onClick={() => setConfirmDelete(unit)}
                className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Sheet open={showForm} onOpenChange={v => !v && setShowForm(false)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>{editUnit ? `Edit ${editUnit.unit_number}` : 'New Storage Unit'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Unit Number</p>
              <Input value={form.unit_number} onChange={e => set('unit_number', e.target.value)} placeholder="A1" autoFocus={!editUnit} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Tenant Name</p>
              <Input value={form.tenant_name} onChange={e => set('tenant_name', e.target.value)} placeholder="John Smith" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Phone</p>
              <Input value={form.tenant_phone} onChange={e => set('tenant_phone', formatPhoneInput(e.target.value))} placeholder="(519) 555-0000" type="tel" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Monthly Rate ($)</p>
                <Input value={form.monthly_rate} onChange={e => set('monthly_rate', e.target.value)} placeholder="120" type="number" min="0" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Billing Day</p>
                <Input value={form.billing_day} onChange={e => set('billing_day', e.target.value)} placeholder="1" type="number" min="1" max="31" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Payment Frequency</p>
              <div className="flex gap-1.5">
                {Object.entries(FREQ_LABELS).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => set('payment_frequency', val)}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${form.payment_frequency === val ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Move-in Date</p>
              <Input value={form.move_in_date} onChange={e => set('move_in_date', e.target.value)} type="date" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
              <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Extra lock, access info…" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!form.unit_number.trim() || saving} onClick={handleSave}>
                {saving ? 'Saving…' : editUnit ? 'Save' : 'Add Unit'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete unit "{confirmDelete?.unit_number}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">This permanently removes the unit and all its payment history.</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
