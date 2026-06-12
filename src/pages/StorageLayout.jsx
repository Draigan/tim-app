import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import StorageViewMenu from '@/components/StorageViewMenu'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'

const DAY_MS = 86400000

function lastDayOf(year, month0) {
  return new Date(year, month0 + 1, 0).getDate()
}

function currentPeriodLabel(billingDay) {
  const today = new Date()
  const effective = billingDay ? Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth())) : 0
  if (!billingDay || today.getDate() >= effective) {
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  }
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

function parseLocalDate(value) {
  if (!value) return null
  const [y, m, d] = String(value).split('-').map(Number)
  if (![y, m, d].every(Number.isFinite)) return null
  return new Date(y, m - 1, d)
}

function isPaidThroughToday(paidThroughDate) {
  const paidThrough = parseLocalDate(paidThroughDate)
  if (!paidThrough) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return paidThrough >= today
}

function paymentStatus(billingDay, frequency, isPaid, moveInDate, paidThroughDate) {
  if (!billingDay || !frequency || frequency === 'one_time' || frequency === 'other') {
    return isPaid || isPaidThroughToday(paidThroughDate) ? 'paid' : 'unpaid'
  }
  if (isPaid || isPaidThroughToday(paidThroughDate)) return 'paid'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const paidThrough = parseLocalDate(paidThroughDate)
  if (paidThrough && paidThrough < today) return 'overdue'
  const [y, m] = currentPeriodLabel(billingDay).split('-').map(Number)
  let dueDate = new Date(y, m - 1, Math.min(billingDay, lastDayOf(y, m - 1)))
  const moveIn = parseLocalDate(moveInDate)
  if (moveIn && dueDate < moveIn) dueDate = moveIn
  const daysUntilDue = Math.round((dueDate - today) / DAY_MS)
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue <= 3) return 'due_soon'
  return 'upcoming'
}

function tileClass(status, vacant) {
  if (vacant) return 'bg-muted/30 border-muted-foreground/20 text-muted-foreground'
  if (status === 'paid') return 'bg-green-500/10 border-green-500/40'
  if (status === 'overdue') return 'bg-red-500/10 border-red-500/50'
  if (status === 'due_soon') return 'bg-amber-500/10 border-amber-500/40'
  return 'bg-card border-border'
}

function dotClass(status) {
  if (status === 'paid') return 'bg-green-500'
  if (status === 'overdue') return 'bg-red-500'
  if (status === 'due_soon') return 'bg-amber-500'
  return 'bg-muted-foreground/30'
}

// cycles: null → up_top → down_below → null
function nextArea(current) {
  if (!current) return 'up_top'
  if (current === 'up_top') return 'down_below'
  return null
}

function areaLabel(area) {
  if (area === 'up_top') return '↑ Top'
  if (area === 'down_below') return '↓ Below'
  return '– –'
}

function UnitTile({ unit, isPaid, editMode, onAreaChange }) {
  const vacant = !unit.tenant_name
  const status = vacant ? null : paymentStatus(unit.billing_day, unit.payment_frequency, isPaid, unit.move_in_date, unit.paid_through_date)

  return (
    <button
      disabled={!editMode}
      onClick={() => onAreaChange(unit)}
      className={cn(
        'border rounded-xl p-2 flex flex-col items-center text-center w-full transition-all',
        tileClass(status, vacant),
        editMode && 'ring-2 ring-primary/20 hover:ring-primary/50 cursor-pointer',
        !editMode && 'cursor-default'
      )}
      style={{ minHeight: 80 }}
    >
      <div className="flex items-center gap-1 mb-0.5">
        {!vacant && status && (
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotClass(status))} />
        )}
        <span className="font-bold text-sm leading-none">{unit.unit_number}</span>
      </div>

      {vacant ? (
        <span className="text-[10px] text-muted-foreground/60 mt-1">Vacant</span>
      ) : (
        <>
          <span className="text-[10px] leading-tight w-full truncate px-0.5 mt-0.5">{unit.tenant_name}</span>
          {unit.monthly_rate != null && (
            <span className="text-[10px] text-muted-foreground mt-0.5">${unit.monthly_rate}/mo</span>
          )}
        </>
      )}

      {editMode && (
        <span className="text-[9px] text-primary/70 font-medium mt-1">{areaLabel(unit.area)}</span>
      )}
    </button>
  )
}

function AreaSection({ title, units, paidIds, editMode, onAreaChange, emptyHint }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {title} · {units.length} unit{units.length !== 1 ? 's' : ''}
      </h2>
      {units.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {units.map(u => (
            <UnitTile
              key={u.id}
              unit={u}
              isPaid={paidIds.has(u.id)}
              editMode={editMode}
              onAreaChange={onAreaChange}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">{emptyHint}</p>
      )}
    </section>
  )
}

export default function StorageLayout() {
  const [units, setUnits] = useState([])
  const [paidIds, setPaidIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)

  const fetchAll = useCallback(async () => {
    const cutoff = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2)
      return d.toISOString().slice(0, 7)
    })()

    const [
      { data: unitData },
      { data: tenancyData },
      { data: paymentData },
    ] = await Promise.all([
      supabase.from('storage_units').select('*').order('unit_number'),
      supabase.from('storage_tenancies').select('*').is('end_date', null),
      supabase.from('storage_payments').select('tenancy_id, period_label').gte('period_label', cutoff),
    ])

    if (!unitData) { setLoading(false); return }

    const tenancyByUnit = {}
    ;(tenancyData ?? []).forEach(t => { tenancyByUnit[t.unit_id] = t })

    const merged = unitData.map(u => {
      const t = tenancyByUnit[u.id]
      return {
        id:               u.id,
        unit_number:      u.unit_number,
        area:             u.area ?? null,
        tenancy_id:       t?.id ?? null,
        tenant_name:      t?.tenant_name ?? null,
        monthly_rate:     t?.monthly_rate ?? null,
        billing_day:      t?.billing_day ?? null,
        payment_frequency: t?.payment_frequency ?? null,
        move_in_date:     t?.move_in_date ?? null,
        paid_through_date: t?.paid_through_date ?? null,
      }
    })
    setUnits(merged)

    const tenancyToUnit = {}
    merged.forEach(u => { if (u.tenancy_id) tenancyToUnit[u.tenancy_id] = u })

    const paid = new Set(
      merged.filter(u => u.tenancy_id && isPaidThroughToday(u.paid_through_date)).map(u => u.id)
    )
    ;(paymentData ?? [])
      .filter(p => {
        const u = tenancyToUnit[p.tenancy_id]
        return u && p.period_label === currentPeriodLabel(u.billing_day)
      })
      .map(p => tenancyToUnit[p.tenancy_id]?.id)
      .filter(Boolean)
      .forEach(id => paid.add(id))

    setPaidIds(paid)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['storage_units', 'storage_tenancies', 'storage_payments'], fetchAll)

  async function handleAreaChange(unit) {
    const newArea = nextArea(unit.area)
    await supabase.from('storage_units').update({ area: newArea }).eq('id', unit.id)
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, area: newArea } : u))
  }

  const upTop = units.filter(u => u.area === 'up_top')
  const downBelow = units.filter(u => u.area === 'down_below')
  const unassigned = units.filter(u => !u.area)

  const occupied = units.filter(u => u.tenant_name)
  const monthlyRevenue = units.reduce((sum, u) => {
    return sum + (u.tenant_name && u.monthly_rate ? Number(u.monthly_rate) : 0)
  }, 0)

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b bg-background flex-shrink-0">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
          <Link to="/storage" aria-label="Back to storage">
            <ArrowLeft size={18} />
          </Link>
        </Button>
        <h1 className="text-base sm:text-lg font-semibold flex-1">Storage Layout</h1>
        <StorageViewMenu current="layout" className="w-[128px]" />
        <Button
          variant={editMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setEditMode(v => !v)}
        >
          {editMode
            ? <><Check size={14} className="mr-1.5" />Done</>
            : <><Pencil size={14} className="mr-1.5" />Edit</>
          }
        </Button>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

          {/* Summary */}
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Occupied</p>
              <p className="font-semibold">{occupied.length} / {units.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Monthly revenue</p>
              <p className="font-semibold">${monthlyRevenue.toFixed(0)}/mo</p>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Paid</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Due soon</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Overdue</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground/30 inline-block" />Vacant</span>
          </div>

          {editMode && (
            <p className="text-xs text-center text-muted-foreground bg-muted/40 rounded-lg py-2 px-3">
              Tap a unit to cycle: Unassigned → Up Top → Down Below → Unassigned
            </p>
          )}

          <AreaSection
            title="Up Top"
            units={upTop}
            paidIds={paidIds}
            editMode={editMode}
            onAreaChange={handleAreaChange}
            emptyHint={editMode ? 'Tap an unassigned unit to place it here.' : 'No units assigned — tap Edit to set up.'}
          />

          <div className="border-t border-dashed border-border" />

          <AreaSection
            title="Down Below"
            units={downBelow}
            paidIds={paidIds}
            editMode={editMode}
            onAreaChange={handleAreaChange}
            emptyHint={editMode ? 'Tap an unassigned unit to place it here.' : 'No units assigned — tap Edit to set up.'}
          />

          {(unassigned.length > 0 || editMode) && (
            <>
              <div className="border-t border-dashed border-border" />
              <AreaSection
                title="Unassigned"
                units={unassigned}
                paidIds={paidIds}
                editMode={editMode}
                onAreaChange={handleAreaChange}
                emptyHint="All units placed."
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
