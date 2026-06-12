import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckSquare, Plus, Save, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import StorageViewMenu from '@/components/StorageViewMenu'
import { supabase } from '@/lib/supabase'
import { cn, formatPhone } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'

function customerName(record) {
  return record?.name || 'Unnamed customer'
}

function compactAssignments(assignments) {
  return assignments
    .slice(0, 4)
    .map(item => item.label)
    .join(' / ')
}

function mergeCustomer(map, source) {
  if (!source.customer_id) return
  const existing = map.get(source.customer_id) ?? {
    id: source.customer_id,
    name: source.customers?.name ?? source.tenant_name ?? 'Unnamed customer',
    phone: source.customers?.phone ?? source.tenant_phone ?? '',
    email: source.customers?.email ?? '',
    assignments: [],
  }

  existing.name = existing.name || source.customers?.name || source.tenant_name
  existing.phone = existing.phone || source.customers?.phone || source.tenant_phone || ''
  existing.email = existing.email || source.customers?.email || ''
  existing.assignments.push(source.assignment)
  map.set(source.customer_id, existing)
}

async function loadStorageCustomers() {
  const [
    { data: tenancies, error: tenancyError },
    { data: rentals, error: rentalError },
    { data: notes, error: notesError },
    { data: fields, error: fieldsError },
    { data: values, error: valuesError },
  ] = await Promise.all([
    supabase
      .from('storage_tenancies')
      .select('id, customer_id, tenant_name, tenant_phone, storage_units(unit_number), customers(id, name, phone, email)')
      .is('end_date', null),
    supabase
      .from('portable_storage_rentals')
      .select('id, asset_id, customer_id, tenant_name, tenant_phone, assets(label), customers(id, name, phone, email)'),
    supabase.from('storage_customer_notes').select('customer_id, notes, updated_at'),
    supabase
      .from('storage_customer_check_fields')
      .select('id, label, sort_order, created_at')
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('storage_customer_check_values').select('customer_id, field_id, checked'),
  ])

  const error = tenancyError || rentalError || notesError || fieldsError || valuesError
  if (error) throw error

  const byCustomer = new Map()
  ;(tenancies ?? []).forEach(tenancy => {
    mergeCustomer(byCustomer, {
      ...tenancy,
      assignment: {
        type: 'fixed',
        label: `Unit ${tenancy.storage_units?.unit_number ?? 'Unknown'}`,
      },
    })
  })
  ;(rentals ?? []).forEach(rental => {
    mergeCustomer(byCustomer, {
      ...rental,
      assignment: {
        type: 'portable',
        label: rental.assets?.label ?? 'Portable storage',
      },
    })
  })

  const notesByCustomer = Object.fromEntries((notes ?? []).map(row => [row.customer_id, row.notes ?? '']))
  const checkValues = {}
  ;(values ?? []).forEach(row => {
    checkValues[`${row.customer_id}:${row.field_id}`] = row.checked === true
  })

  return {
    customers: [...byCustomer.values()].sort((a, b) => customerName(a).localeCompare(customerName(b))),
    fields: fields ?? [],
    notesByCustomer,
    checkValues,
  }
}

function FieldHeader({ fields, onRequestArchiveField }) {
  if (fields.length === 0) return null

  return (
    <div className="flex gap-1.5 flex-wrap">
      {fields.map(field => (
        <div key={field.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
          <CheckSquare size={12} className="text-muted-foreground" />
          <span>{field.label}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onRequestArchiveField(field)}
            aria-label={`Remove ${field.label}`}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function CustomerNoteCard({
  customer,
  fields,
  note,
  dirty,
  saving,
  checkValues,
  onNoteChange,
  onSaveNote,
  onToggleCheck,
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{customerName(customer)}</p>
          <p className="text-xs text-muted-foreground truncate">
            {compactAssignments(customer.assignments)}
          </p>
          {(customer.phone || customer.email) && (
            <p className="text-xs text-muted-foreground truncate">
              {[customer.phone && formatPhone(customer.phone), customer.email].filter(Boolean).join(' / ')}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={dirty ? 'default' : 'outline'}
          disabled={!dirty || saving}
          onClick={() => onSaveNote(customer.id)}
          className="gap-1.5 flex-shrink-0"
        >
          <Save size={13} />
          {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      {fields.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {fields.map(field => {
            const checked = checkValues[`${customer.id}:${field.id}`] === true
            return (
              <label
                key={field.id}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer transition-colors',
                  checked ? 'bg-green-500/10 border-green-500/40 text-green-700' : 'bg-background hover:bg-accent'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={event => onToggleCheck(customer.id, field.id, event.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {field.label}
              </label>
            )
          })}
        </div>
      )}

      <Textarea
        value={note}
        onChange={event => onNoteChange(customer.id, event.target.value)}
        onBlur={() => dirty && onSaveNote(customer.id)}
        placeholder="Storage notes for this customer..."
        className="min-h-[92px]"
      />
    </div>
  )
}

export default function StorageCustomerNotes() {
  const [customers, setCustomers] = useState([])
  const [fields, setFields] = useState([])
  const [notes, setNotes] = useState({})
  const [savedNotes, setSavedNotes] = useState({})
  const [checkValues, setCheckValues] = useState({})
  const [query, setQuery] = useState('')
  const [newField, setNewField] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingNoteId, setSavingNoteId] = useState(null)
  const [addingField, setAddingField] = useState(false)
  const [confirmArchiveField, setConfirmArchiveField] = useState(null)
  const [archivingFieldId, setArchivingFieldId] = useState(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const data = await loadStorageCustomers()
      setCustomers(data.customers)
      setFields(data.fields)
      setNotes(current => {
        const next = { ...data.notesByCustomer }
        Object.entries(current).forEach(([customerId, note]) => {
          if (note !== savedNotes[customerId]) next[customerId] = note
        })
        return next
      })
      setSavedNotes(data.notesByCustomer)
      setCheckValues(data.checkValues)
      setError('')
    } catch (err) {
      console.error('storage customer notes error:', err)
      setError(err instanceof Error ? err.message : 'Could not load storage customer notes.')
    } finally {
      setLoading(false)
    }
  }, [savedNotes])

  useEffect(() => {
    let cancelled = false

    loadStorageCustomers()
      .then(data => {
        if (cancelled) return
        setCustomers(data.customers)
        setFields(data.fields)
        setNotes(data.notesByCustomer)
        setSavedNotes(data.notesByCustomer)
        setCheckValues(data.checkValues)
        setError('')
      })
      .catch(err => {
        if (cancelled) return
        console.error('storage customer notes error:', err)
        setError(err instanceof Error ? err.message : 'Could not load storage customer notes.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])
  useRealtime(['storage_tenancies', 'portable_storage_rentals', 'customers', 'storage_customer_notes', 'storage_customer_check_fields', 'storage_customer_check_values'], refresh)

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(customer => [
      customer.name,
      customer.phone,
      customer.email,
      ...customer.assignments.map(item => item.label),
    ].some(value => value?.toLowerCase().includes(q)))
  }, [customers, query])

  const confirmArchiveCheckedCount = useMemo(() => {
    if (!confirmArchiveField) return 0
    return Object.entries(checkValues).filter(([key, checked]) => (
      checked === true && key.endsWith(`:${confirmArchiveField.id}`)
    )).length
  }, [checkValues, confirmArchiveField])

  function updateNote(customerId, value) {
    setNotes(prev => ({ ...prev, [customerId]: value }))
  }

  async function saveNote(customerId) {
    const note = notes[customerId] ?? ''
    setSavingNoteId(customerId)
    const { error: saveError } = await supabase.from('storage_customer_notes').upsert({
      customer_id: customerId,
      notes: note,
      updated_at: new Date().toISOString(),
    })
    setSavingNoteId(null)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setSavedNotes(prev => ({ ...prev, [customerId]: note }))
  }

  async function addField() {
    const label = newField.trim()
    if (!label) return
    setAddingField(true)
    const sortOrder = fields.reduce((max, field) => Math.max(max, Number(field.sort_order) || 0), 0) + 1
    const { error: addError } = await supabase.from('storage_customer_check_fields').insert({
      label,
      sort_order: sortOrder,
    })
    setAddingField(false)
    if (addError) {
      setError(addError.message)
      return
    }
    setNewField('')
    refresh()
  }

  async function archiveField(field) {
    if (!field || archivingFieldId) return
    setArchivingFieldId(field.id)
    const { error: archiveError } = await supabase
      .from('storage_customer_check_fields')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', field.id)
    setArchivingFieldId(null)
    if (archiveError) {
      setError(archiveError.message)
      return
    }
    setFields(prev => prev.filter(item => item.id !== field.id))
    setConfirmArchiveField(null)
  }

  async function toggleCheck(customerId, fieldId, checked) {
    const key = `${customerId}:${fieldId}`
    setCheckValues(prev => ({ ...prev, [key]: checked }))
    const { error: checkError } = await supabase.from('storage_customer_check_values').upsert({
      customer_id: customerId,
      field_id: fieldId,
      checked,
      updated_at: new Date().toISOString(),
    })
    if (checkError) {
      setError(checkError.message)
      setCheckValues(prev => ({ ...prev, [key]: !checked }))
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b bg-background flex-shrink-0">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
          <Link to="/storage" aria-label="Back to storage">
            <ArrowLeft size={18} />
          </Link>
        </Button>
        <h1 className="text-base sm:text-lg font-semibold flex-1">Storage Customer Notes</h1>
        <StorageViewMenu current="customer-notes" className="w-[174px]" />
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search storage customers..."
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
            <div className="flex gap-2">
              <Input
                value={newField}
                onChange={event => setNewField(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addField())}
                placeholder='Add checkbox, e.g. "Called"'
              />
              <Button onClick={addField} disabled={!newField.trim() || addingField} className="gap-1.5 flex-shrink-0">
                <Plus size={14} />
                Add
              </Button>
            </div>
            <FieldHeader
              fields={fields}
              onRequestArchiveField={field => {
                setError('')
                setConfirmArchiveField(field)
              }}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : filteredCustomers.length > 0 ? (
          <div className="space-y-3">
            {filteredCustomers.map(customer => {
              const note = notes[customer.id] ?? ''
              const saved = savedNotes[customer.id] ?? ''
              return (
                <CustomerNoteCard
                  key={customer.id}
                  customer={customer}
                  fields={fields}
                  note={note}
                  dirty={note !== saved}
                  saving={savingNoteId === customer.id}
                  checkValues={checkValues}
                  onNoteChange={updateNote}
                  onSaveNote={saveNote}
                  onToggleCheck={toggleCheck}
                />
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            No active storage customers found.
          </div>
        )}
      </main>

      <Dialog
        open={!!confirmArchiveField}
        onOpenChange={open => {
          if (!open && !archivingFieldId) setConfirmArchiveField(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove "{confirmArchiveField?.label}"?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              This hides the checkbox from every storage customer. Existing saved checkmarks are kept in the database,
              but they will not show here after it is removed.
            </p>
            <p>
              {confirmArchiveCheckedCount > 0
                ? `${confirmArchiveCheckedCount} customer${confirmArchiveCheckedCount === 1 ? '' : 's'} currently have this checked.`
                : 'No customers currently have this checked.'}
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={!!archivingFieldId}
              onClick={() => setConfirmArchiveField(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={!confirmArchiveField || archivingFieldId === confirmArchiveField?.id}
              onClick={() => archiveField(confirmArchiveField)}
            >
              {archivingFieldId === confirmArchiveField?.id ? 'Removing...' : 'Remove'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
