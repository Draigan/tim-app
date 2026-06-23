import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, RotateCw, Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import StorageViewMenu from '@/components/StorageViewMenu'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'
import { StorageSheet } from './Storage'

const SCALE = 6      // px per foot
const SNAP  = 12     // snap to 2-foot grid
const CANVAS_W = 1400
const CANVAS_H = 900
const MARGIN = 24
const GAP = 14

const snap = v => Math.round(v / SNAP) * SNAP

// ─── helpers ─────────────────────────────────────────────────────────────────

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

function parseSizeFt(size) {
  const m = String(size ?? '').match(/(\d+)\s*[xX×]\s*(\d+)/)
  if (!m) return { w: 8, l: 20 }
  const a = Number(m[1]); const b = Number(m[2])
  return { w: Math.min(a, b), l: Math.max(a, b) }
}

// default stacked grid position before user has placed the unit
function autoPosition(index, size) {
  const { w } = parseSizeFt(size)
  const tileW = w * SCALE
  const maxH = 40 * SCALE   // tallest possible unit (8×40 portrait)
  const perRow = Math.max(1, Math.floor((CANVAS_W - MARGIN * 2 + GAP) / (tileW + GAP)))
  return {
    x: MARGIN + (index % perRow) * (tileW + GAP),
    y: MARGIN + Math.floor(index / perRow) * (maxH + GAP),
    rotation: 0,
  }
}

function tileCls(status, vacant) {
  if (vacant)                return 'bg-muted/40 border-muted-foreground/20 text-muted-foreground'
  if (status === 'paid')     return 'bg-green-500/10 border-green-500/50 text-foreground'
  if (status === 'overdue')  return 'bg-red-500/10 border-red-500/60 text-foreground'
  if (status === 'due_soon') return 'bg-amber-500/10 border-amber-500/50 text-foreground'
  return 'bg-card border-border text-foreground'
}

function dotCls(status) {
  if (status === 'paid')     return 'bg-green-500'
  if (status === 'overdue')  return 'bg-red-500'
  if (status === 'due_soon') return 'bg-amber-500'
  return 'bg-muted-foreground/30'
}

// ─── unit block ───────────────────────────────────────────────────────────────

function UnitBlock({ unit, pos, isPaid, isDragging, onPointerDown, onPointerMove, onPointerUp, onRotate, locked, onTap }) {
  const { w, l } = parseSizeFt(unit.size)
  const rotated = pos.rotation === 90
  const tileW = (rotated ? l : w) * SCALE
  const tileH = (rotated ? w : l) * SCALE

  const vacant = !unit.tenant_name
  const status = vacant ? null : paymentStatus(unit.billing_day, unit.payment_frequency, isPaid, unit.move_in_date, unit.paid_through_date)

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: tileW,
        height: tileH,
        touchAction: 'none',
        zIndex: isDragging ? 1000 : 1,
        cursor: locked ? 'pointer' : isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      className={cn(
        'border-2 rounded-lg flex flex-col items-center justify-center overflow-hidden',
        tileCls(status, vacant),
        isDragging && 'shadow-2xl ring-2 ring-primary/40',
      )}
      onClick={locked ? onTap : undefined}
      onPointerDown={locked ? undefined : onPointerDown}
      onPointerMove={locked ? undefined : onPointerMove}
      onPointerUp={locked ? undefined : onPointerUp}
    >
      {/* status dot */}
      {!vacant && status && (
        <span className={cn('absolute top-1.5 left-1.5 w-2 h-2 rounded-full', dotCls(status))} />
      )}

      {/* rotate button — hidden when locked */}
      {!locked && (
        <button
          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-black/10 hover:bg-black/25 active:bg-black/40"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => onRotate(unit.id)}
          title="Rotate"
        >
          <RotateCw size={9} />
        </button>
      )}

      <span className="font-bold text-xs leading-none">{unit.unit_number}</span>
      <span className="text-[9px] opacity-60 mt-0.5">{unit.size || `${w}×${l}`}</span>
      {!vacant && (
        <span className="text-[9px] leading-tight text-center px-1 mt-0.5 max-w-full truncate">
          {unit.tenant_name}
        </span>
      )}
      {unit.monthly_rate != null && (
        <span className="text-[9px] opacity-50 mt-0.5">${unit.monthly_rate}/mo</span>
      )}
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'up_top',    label: 'Up Top' },
  { key: 'down_below', label: 'Down Below' },
]

export default function StorageFloorplan() {
  const [activeTab, setActiveTab] = useState('up_top')
  const [units, setUnits]         = useState([])
  const [positions, setPositions] = useState({})   // key: `${unitId}::${area}`
  const [paidIds, setPaidIds]     = useState(new Set())
  const [loading, setLoading]     = useState(true)
  const [draggingId, setDraggingId] = useState(null)
  const [locked, setLocked]       = useState(false)
  const [selectedUnit, setSelectedUnit] = useState(null)

  const dragRef   = useRef(null)
  const canvasRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const cutoff = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2)
      return d.toISOString().slice(0, 7)
    })()

    const [
      { data: unitData },
      { data: tenancyData },
      { data: paymentData },
      { data: posData },
    ] = await Promise.all([
      supabase.from('storage_units').select('*').order('unit_number'),
      supabase.from('storage_tenancies').select('*, customers(id, name, pin, has_payment_method)').eq('storage_kind', 'fixed_unit').is('end_date', null),
      supabase.from('storage_payments').select('tenancy_id, period_label').gte('period_label', cutoff),
      supabase.from('storage_unit_positions').select('*'),
    ])

    if (!unitData) { setLoading(false); return }

    const tenancyByUnit = {}
    ;(tenancyData ?? []).forEach(t => { tenancyByUnit[t.unit_id] = t })

    const merged = unitData.map(u => {
      const t = tenancyByUnit[u.id]
      return {
        id:               u.id,
        unit_number:      u.unit_number,
        size:             u.size ?? null,
        area:             u.area ?? null,
        unit_notes:       u.unit_notes ?? null,
        tenancy_id:       t?.id ?? null,
        tenant_name:      t?.tenant_name ?? null,
        tenant_phone:     t?.tenant_phone ?? null,
        customer_id:      t?.customer_id ?? null,
        customers:        t?.customers ?? null,
        monthly_rate:     t?.monthly_rate ?? null,
        billing_day:      t?.billing_day ?? null,
        payment_frequency: t?.payment_frequency ?? null,
        move_in_date:     t?.move_in_date ?? null,
        paid_through_date: t?.paid_through_date ?? null,
        notes:            t?.notes ?? null,
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

    const posMap = {}
    ;(posData ?? []).forEach(p => {
      posMap[`${p.unit_id}::${p.area}`] = { x: p.x, y: p.y, rotation: p.rotation }
    })
    setPositions(posMap)

    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useRealtime(['storage_units', 'storage_tenancies', 'storage_payments', 'storage_unit_positions'], fetchAll)

  function getPos(unitId, index) {
    return positions[`${unitId}::${activeTab}`] ?? autoPosition(index, units.find(u => u.id === unitId)?.size)
  }

  async function savePosition(unitId, area, pos) {
    await supabase.from('storage_unit_positions').upsert(
      { unit_id: unitId, area, x: pos.x, y: pos.y, rotation: pos.rotation ?? 0 },
      { onConflict: 'unit_id,area' }
    )
  }

  function handlePointerDown(e, unit) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left + canvas.scrollLeft
    const py = e.clientY - rect.top + canvas.scrollTop

    const tabUnits = units.filter(u => u.area === activeTab)
    const idx = tabUnits.findIndex(u => u.id === unit.id)
    const currentPos = getPos(unit.id, idx)

    dragRef.current = {
      unitId: unit.id,
      offsetX: px - currentPos.x,
      offsetY: py - currentPos.y,
    }
    setDraggingId(unit.id)
  }

  function handlePointerMove(e) {
    if (!dragRef.current) return

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left + canvas.scrollLeft
    const py = e.clientY - rect.top + canvas.scrollTop

    const { unitId, offsetX, offsetY } = dragRef.current
    const newX = snap(Math.max(0, px - offsetX))
    const newY = snap(Math.max(0, py - offsetY))

    const key = `${unitId}::${activeTab}`
    setPositions(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? { rotation: 0 }), x: newX, y: newY },
    }))
  }

  function handlePointerUp(e, unitId) {
    if (!dragRef.current || dragRef.current.unitId !== unitId) return
    dragRef.current = null
    setDraggingId(null)

    const pos = positions[`${unitId}::${activeTab}`]
    if (pos) savePosition(unitId, activeTab, pos)
  }

  async function handleRotate(unitId) {
    const key = `${unitId}::${activeTab}`
    const tabUnits = units.filter(u => u.area === activeTab)
    const idx = tabUnits.findIndex(u => u.id === unitId)
    const current = positions[key] ?? autoPosition(idx, units.find(u => u.id === unitId)?.size)
    const newPos = { ...current, rotation: current.rotation === 90 ? 0 : 90 }
    setPositions(prev => ({ ...prev, [key]: newPos }))
    await savePosition(unitId, activeTab, newPos)
  }

  const tabUnits = units.filter(u => u.area === activeTab)

  return (
    <div className="h-full flex flex-col bg-background">
      {/* single slim bar: back + tabs */}
      <header className="flex items-center border-b bg-background flex-shrink-0 h-11">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 flex-shrink-0 rounded-none">
          <Link to="/storage" aria-label="Back to storage">
            <ArrowLeft size={18} />
          </Link>
        </Button>
        <div className="w-px h-5 bg-border flex-shrink-0" />
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex-1 h-11 text-sm font-medium border-b-2 transition-colors',
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
        <div className="w-px h-5 bg-border flex-shrink-0" />
        <StorageViewMenu current="floorplan" className="h-8 w-[112px] mx-1" />
        <div className="w-px h-5 bg-border flex-shrink-0" />
        <button
          onClick={() => setLocked(v => !v)}
          className={cn(
            'h-11 w-11 flex-shrink-0 flex items-center justify-center transition-colors',
            locked ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
          title={locked ? 'Unlock positions' : 'Lock positions'}
        >
          {locked ? <Lock size={16} /> : <LockOpen size={16} />}
        </button>
      </header>

      {/* canvas */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </div>
      ) : (
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto"
          style={{ background: 'hsl(var(--muted) / 0.3)' }}
        >
          <div
            className="relative"
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              backgroundImage: [
                `linear-gradient(rgba(128,128,128,0.08) 1px, transparent 1px)`,
                `linear-gradient(90deg, rgba(128,128,128,0.08) 1px, transparent 1px)`,
              ].join(','),
              backgroundSize: `${SCALE * 5}px ${SCALE * 5}px`,
            }}
          >
            {tabUnits.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-8">
                <p className="text-sm text-muted-foreground">No units in this area.</p>
                <p className="text-xs text-muted-foreground">
                  Assign units using the{' '}
                  <Link to="/storage/layout" className="text-primary underline underline-offset-2">
                    Layout
                  </Link>{' '}
                  view first.
                </p>
              </div>
            ) : (
              tabUnits.map((unit, idx) => {
                const pos = getPos(unit.id, idx)
                return (
                  <UnitBlock
                    key={unit.id}
                    unit={unit}
                    pos={pos}
                    isPaid={paidIds.has(unit.id)}
                    isDragging={draggingId === unit.id}
                    locked={locked}
                    onTap={() => setSelectedUnit(unit)}
                    onPointerDown={e => handlePointerDown(e, unit)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={e => handlePointerUp(e, unit.id)}
                    onRotate={handleRotate}
                  />
                )
              })
            )}
          </div>
        </div>
      )}

      <StorageSheet
        item={selectedUnit}
        isPaid={selectedUnit ? paidIds.has(selectedUnit.id) : false}
        onClose={() => setSelectedUnit(null)}
        onTogglePaid={() => {}}
        onAssigned={() => { setSelectedUnit(null); fetchAll() }}
      />
    </div>
  )
}
