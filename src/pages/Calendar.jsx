import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useIsAdmin } from '@/lib/useIsAdmin'
import { useRealtime } from '@/lib/useRealtime'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const COLORS = [
  { key: 'blue',   dot: 'bg-blue-500',   pill: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
  { key: 'sky',    dot: 'bg-sky-400',    pill: 'bg-sky-400/20 text-sky-400 border border-sky-400/30' },
  { key: 'green',  dot: 'bg-green-500',  pill: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  { key: 'teal',   dot: 'bg-teal-500',   pill: 'bg-teal-500/20 text-teal-400 border border-teal-500/30' },
  { key: 'red',    dot: 'bg-red-500',    pill: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  { key: 'pink',   dot: 'bg-pink-500',   pill: 'bg-pink-500/20 text-pink-400 border border-pink-500/30' },
  { key: 'purple', dot: 'bg-purple-500', pill: 'bg-purple-500/20 text-purple-400 border border-purple-500/30' },
  { key: 'orange', dot: 'bg-orange-500', pill: 'bg-orange-500/20 text-orange-400 border border-orange-500/30' },
  { key: 'yellow', dot: 'bg-yellow-400', pill: 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30' },
]
const colorMap = Object.fromEntries(COLORS.map(c => [c.key, c]))

function isoDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

function EventDialog({ date, event, onClose, onSaved, onDeleted }) {
  const [title, setTitle] = useState(event?.title ?? '')
  const [fromDate, setFromDate] = useState(event?.from_date ?? date ?? '')
  const [toDate] = useState(event?.to_date ?? date ?? '')
  const [startTime, setStartTime] = useState(event?.start_time?.slice(0, 5) ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [color, setColor] = useState(event?.color ?? 'blue')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    if (!title.trim() || !fromDate) return
    setSaving(true)
    const payload = {
      title: title.trim(),
      from_date: fromDate,
      to_date: fromDate,
      start_time: startTime || null,
      notes: notes || null,
      color,
    }
    if (event) {
      await supabase.from('calendar_events').update(payload).eq('id', event.id)
    } else {
      await supabase.from('calendar_events').insert(payload)
    }
    setSaving(false)
    onSaved()
  }

  async function del() {
    await supabase.from('calendar_events').delete().eq('id', event.id)
    onDeleted()
  }

  if (confirmDelete) return (
    <Dialog open onOpenChange={() => setConfirmDelete(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete event?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground mt-1">"{event.title}" will be permanently removed.</p>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="destructive" className="flex-1" onClick={del}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{event ? 'Edit Event' : 'New Event'}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" autoFocus />
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Date</p>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              onClick={e => { try { e.target.showPicker() } catch {} }}
              className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer bg-background" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Time (optional)</p>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer bg-background" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Color</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button key={c.key} onClick={() => setColor(c.key)}
                  className={`w-7 h-7 rounded-full ${c.dot} transition-transform ${color === c.key ? 'ring-2 ring-offset-2 ring-offset-background ring-white scale-110' : 'opacity-60'}`} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" rows={2} />
          </div>
          <div className="flex gap-2 pt-1">
            {event && (
              <Button variant="outline" size="icon" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} className="text-destructive" />
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving || !title.trim() || !fromDate || !toDate}>
              {saving ? 'Saving…' : event ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function Calendar() {
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const today = new Date()
  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate())

  const [view, setView] = useState(() => localStorage.getItem('calView') ?? 'month')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    return d.toISOString().slice(0, 10)
  })
  const [events, setEvents] = useState([])
  const [reservations, setReservations] = useState([])
  const [assets, setAssets] = useState({})
  const [selected, setSelected] = useState(null)
  const [dialog, setDialog] = useState(null) // null | { date, event? }

  const rangeStart = view === 'month'
    ? isoDate(year, month, 1)
    : weekStart
  const rangeEnd = view === 'month'
    ? isoDate(year, month, new Date(year, month + 1, 0).getDate())
    : addDays(weekStart, 6)

  const fetch = useCallback(async () => {
    const [{ data: evts }, { data: resvs }, { data: assetList }] = await Promise.all([
      supabase.from('calendar_events').select('*').lte('from_date', rangeEnd).gte('to_date', rangeStart),
      supabase.from('reservations').select('*').gte('from_date', rangeStart).lte('from_date', rangeEnd),
      supabase.from('assets').select('id, label'),
    ])
    if (evts) setEvents(evts)
    if (resvs) setReservations(resvs)
    if (assetList) setAssets(Object.fromEntries(assetList.map(a => [a.id, a])))
  }, [rangeStart, rangeEnd])

  useEffect(() => { fetch() }, [fetch])
  useRealtime(['calendar_events', 'reservations'], fetch)

  if (!isAdmin) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Not available</div>

  // Build per-day index
  function eventsOnDay(dateStr) {
    return events.filter(e => e.from_date <= dateStr && e.to_date >= dateStr)
  }
  function resvOnDay(dateStr) {
    return reservations.filter(r => r.from_date === dateStr)
  }

  function prevPeriod() {
    setSelected(null)
    if (view === 'month') {
      if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
    } else {
      setWeekStart(addDays(weekStart, -7))
    }
  }
  function nextPeriod() {
    setSelected(null)
    if (view === 'month') {
      if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
    } else {
      setWeekStart(addDays(weekStart, 7))
    }
  }

  const periodLabel = view === 'month'
    ? new Date(year, month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : (() => {
        const s = new Date(weekStart + 'T00:00:00')
        const e = new Date(addDays(weekStart, 6) + 'T00:00:00')
        return s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      })()

  // Selected day events
  const selEvents = selected ? eventsOnDay(selected) : []
  const selResvs = selected ? resvOnDay(selected) : []

  // Month grid
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDow = new Date(year, month, 1).getDay()

  // Week view days
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function DayDots({ dateStr }) {
    const evts = eventsOnDay(dateStr)
    const resvs = resvOnDay(dateStr)
    const dots = [...evts.map(e => ({ type: 'event', color: colorMap[e.color]?.dot ?? 'bg-blue-500' })),
                  ...resvs.map(() => ({ type: 'resv', color: 'bg-amber-500' }))]
    if (!dots.length) return null
    return (
      <div className="flex gap-0.5 justify-center mt-0.5 flex-wrap">
        {dots.slice(0, 3).map((d, i) => <div key={i} className={`w-1.5 h-1.5 rounded-full ${d.color}`} />)}
        {dots.length > 3 && <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />}
      </div>
    )
  }

  return (
    <div className="relative h-full flex flex-col">
      {/* Header */}
      <div className="relative z-10 px-4 pt-5 pb-2 flex-shrink-0 space-y-2 bg-background">
        <div className="flex items-center justify-between">
          <button onClick={prevPeriod} className="text-muted-foreground hover:text-foreground p-2 -ml-2"><ChevronLeft size={28} /></button>
          <span className="text-sm font-medium text-center">{periodLabel}</span>
          <button onClick={nextPeriod} className="text-muted-foreground hover:text-foreground p-2 -mr-2"><ChevronRight size={28} /></button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => {
            setSelected(todayIso)
            setYear(today.getFullYear()); setMonth(today.getMonth())
            const d = new Date(); d.setDate(d.getDate() - d.getDay())
            setWeekStart(d.toISOString().slice(0, 10))
          }} className="text-xs text-muted-foreground hover:text-foreground border rounded-md px-2 py-1">Today</button>
          <div className="flex rounded-lg border overflow-hidden text-xs">
            <button onClick={() => { setView('month'); localStorage.setItem('calView', 'month') }} className={`px-3 py-1.5 ${view === 'month' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Month</button>
            <button onClick={() => { setView('week'); localStorage.setItem('calView', 'week') }} className={`px-3 py-1.5 ${view === 'week' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Week</button>
          </div>
          <Button size="icon" className="h-8 w-8 rounded-xl flex-shrink-0" onClick={() => setDialog({ date: selected ?? todayIso })}>
            <Plus size={16} />
          </Button>
        </div>
      </div>

      {/* DOW headers */}
      <div className="grid grid-cols-7 px-4 flex-shrink-0">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Month view */}
      {view === 'month' && (
        <>
          <div className="grid grid-cols-7 px-4 gap-y-1 flex-shrink-0">
            {Array.from({ length: startDow }).map((_, i) => <div key={'e' + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const dateStr = isoDate(year, month, day)
              const isToday = dateStr === todayIso
              const isSel = dateStr === selected
              return (
                <button key={day} onClick={() => setSelected(isSel ? null : dateStr)}
                  className={`flex flex-col items-center py-1 rounded-lg transition-colors ${isSel ? 'bg-primary' : isToday ? 'bg-primary/10' : 'hover:bg-accent'}`}>
                  <span className={`text-sm font-medium leading-none ${isSel ? 'text-primary-foreground' : isToday ? 'text-primary' : ''}`}>{day}</span>
                  <div className={isSel ? '[&_.dot]:bg-primary-foreground' : ''}>
                    <DayDots dateStr={dateStr} />
                  </div>
                </button>
              )
            })}
          </div>

          {/* Selected day detail */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
            {selected ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {new Date(selected + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                  </p>
                  <button onClick={() => setDialog({ date: selected })} className="text-muted-foreground hover:text-foreground">
                    <Plus size={16} />
                  </button>
                </div>
                {selEvents.length === 0 && selResvs.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing scheduled</p>
                )}
                <div className="space-y-2">
                  {selEvents.map(e => {
                    const c = colorMap[e.color] ?? colorMap.blue
                    const timeStr = e.start_time ? fmtTime(e.start_time) : null
                    return (
                      <button key={e.id} onClick={() => setDialog({ date: selected, event: e })}
                        className={`w-full text-left rounded-xl px-4 py-3 text-sm ${c.pill}`}>
                        <p className="font-medium">{e.title}</p>
                        {timeStr && <p className="text-xs opacity-70 mt-0.5">{timeStr}</p>}
                        {e.from_date !== e.to_date && <p className="text-xs opacity-70 mt-0.5">{e.from_date} → {e.to_date}</p>}
                        {e.notes && <p className="text-xs opacity-70 mt-0.5">{e.notes}</p>}
                      </button>
                    )
                  })}
                  {selResvs.map(r => (
                    <button key={r.id} onClick={() => navigate(`/assets/${r.asset_id}`)}
                      className="w-full text-left rounded-xl px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                      <p className="font-medium">Reservation · {assets[r.asset_id]?.label ?? '—'}</p>
                      <p className="text-xs opacity-70 mt-0.5">{r.from_date} → {r.to_date}{r.customer_name ? ` · ${r.customer_name}` : ''}</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center mt-6">Tap a day to see events</p>
            )}
          </div>
        </>
      )}

      {/* Week view */}
      {view === 'week' && (
        <div className="flex-1 overflow-y-auto pb-4">
          <div className="grid grid-cols-7 px-4 gap-x-1 mt-1">
            {weekDays.map(dateStr => {
              const dayNum = parseInt(dateStr.slice(8))
              const isToday = dateStr === todayIso
              const evts = eventsOnDay(dateStr)
              const resvs = resvOnDay(dateStr)
              return (
                <div key={dateStr} className="flex flex-col gap-1">
                  <button onClick={() => setSelected(selected === dateStr ? null : dateStr)}
                    className={`flex items-center justify-center w-7 h-7 mx-auto rounded-full text-sm font-medium transition-colors ${isToday ? 'bg-primary text-primary-foreground' : selected === dateStr ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-accent'}`}>
                    {dayNum}
                  </button>
                  {evts.map(e => {
                    const c = colorMap[e.color] ?? colorMap.blue
                    return (
                      <button key={e.id} onClick={() => setDialog({ date: dateStr, event: e })}
                        className={`w-full text-left rounded px-1.5 py-1 text-[10px] leading-tight ${c.pill}`}>
                        <p className="truncate">{e.title}</p>
                        {e.start_time && <p className="opacity-70">{fmtTime(e.start_time)}</p>}
                      </button>
                    )
                  })}
                  {resvs.map(r => (
                    <button key={r.id} onClick={() => navigate(`/assets/${r.asset_id}`)}
                      className="w-full text-left rounded px-1.5 py-1 text-[10px] leading-tight bg-amber-500/15 border border-amber-500/30 text-amber-500 truncate">
                      {assets[r.asset_id]?.label ?? 'Resv'}
                    </button>
                  ))}
                  {evts.length === 0 && resvs.length === 0 && (
                    <button onClick={() => setDialog({ date: dateStr })} className="w-full h-6 rounded border border-dashed border-border/40 hover:border-primary/40 transition-colors" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {dialog && (
        <EventDialog
          date={dialog.date}
          event={dialog.event}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); fetch() }}
          onDeleted={() => { setDialog(null); fetch() }}
        />
      )}
    </div>
  )
}
