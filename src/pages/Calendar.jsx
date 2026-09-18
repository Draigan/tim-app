import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { callFunction } from '@/lib/functions'
import { useAccess } from '@/lib/useAccess'
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

// The grid is always six rows, so the page never changes height between months.
const GRID_DAYS = 42
// Months of slack loaded either side of where you are. Paging inside the loaded
// window is instant and never shows the previous month's dots.
const WINDOW_MONTHS = 2

function isoDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - date.getDay())
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate())
}

function shiftMonth(y, m, n) {
  const date = new Date(y, m + n, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

function monthStart(y, m) {
  return isoDate(y, m, 1)
}

function monthEnd(y, m) {
  return isoDate(y, m, new Date(y, m + 1, 0).getDate())
}

function monthOf(iso) {
  const [y, m] = iso.split('-').map(Number)
  return { year: y, month: m - 1 }
}

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

function fmtRange(from, to) {
  if (from === to) return ''
  const opts = { month: 'short', day: 'numeric' }
  const s = new Date(from + 'T00:00:00').toLocaleDateString(undefined, opts)
  const e = new Date(to + 'T00:00:00').toLocaleDateString(undefined, opts)
  return `${s} → ${e}`
}

function fmtDay(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// Tells the other managers an event landed on the calendar. Fire-and-forget:
// a push that does not go out must never cost someone their saved event.
async function announceNewEvent(saved) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const who = session.user?.user_metadata?.full_name ?? session.user?.email ?? 'Someone'
    const when = fmtDay(saved.from_date)
    const through = saved.to_date !== saved.from_date ? ` through ${fmtDay(saved.to_date)}` : ''
    const at = saved.start_time ? `, ${fmtTime(saved.start_time)}` : ''
    await callFunction('send-push', {
      token: session.access_token,
      body: {
        to_managers: true,
        kind: 'calendar_event',
        title: 'Event added',
        body: `${who} added "${saved.title}" — ${when}${through}${at}`,
        url: '/calendar',
        metadata: {
          title: saved.title,
          from_date: saved.from_date,
          to_date: saved.to_date,
          start_time: saved.start_time,
          added_by: who,
        },
      },
    })
  } catch {
    // The event is already saved; a missed announcement is not worth surfacing.
  }
}

function EventDialog({ date, event, onClose, onSaved, onDeleted }) {
  const [title, setTitle] = useState(event?.title ?? '')
  const [fromDate, setFromDate] = useState(event?.from_date ?? date ?? '')
  const [toDate, setToDate] = useState(event?.to_date ?? date ?? '')
  const [startTime, setStartTime] = useState(event?.start_time?.slice(0, 5) ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [color, setColor] = useState(event?.color ?? 'blue')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // An end date can never sit before the start date.
  function changeFromDate(value) {
    setFromDate(value)
    if (value && toDate < value) setToDate(value)
  }

  async function save() {
    if (!title.trim() || !fromDate) return
    setSaving(true)
    setError('')
    const payload = {
      title: title.trim(),
      from_date: fromDate,
      to_date: toDate || fromDate,
      start_time: startTime || null,
      notes: notes || null,
      color,
    }
    const { error: saveError } = event
      ? await supabase.from('calendar_events').update(payload).eq('id', event.id)
      : await supabase.from('calendar_events').insert(payload)
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    if (!event) void announceNewEvent(payload)
    onSaved()
  }

  async function del() {
    setError('')
    const { error: deleteError } = await supabase.from('calendar_events').delete().eq('id', event.id)
    if (deleteError) {
      setConfirmDelete(false)
      setError(deleteError.message)
      return
    }
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

  const invalidRange = Boolean(fromDate && toDate && toDate < fromDate)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{event ? 'Edit Event' : 'New Event'}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Starts</p>
              <input type="date" value={fromDate} onChange={e => changeFromDate(e.target.value)}
                onClick={e => { try { e.target.showPicker() } catch { /* showPicker is not on every browser */ } }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer bg-background" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Ends</p>
              <input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)}
                onClick={e => { try { e.target.showPicker() } catch { /* showPicker is not on every browser */ } }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm cursor-pointer bg-background" />
            </div>
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
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            {event && (
              <Button variant="outline" size="icon" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} className="text-destructive" />
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving || !title.trim() || !fromDate || !toDate || invalidRange}>
              {saving ? 'Saving…' : event ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DayDetail({ date, events, reservations, assets, onAdd, onEdit, onOpenAsset }) {
  if (!date) return <p className="text-sm text-muted-foreground text-center mt-6">Tap a day to see events</p>

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <button onClick={() => onAdd(date)} className="text-muted-foreground hover:text-foreground">
          <Plus size={16} />
        </button>
      </div>
      {events.length === 0 && reservations.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing scheduled</p>
      )}
      <div className="space-y-2">
        {events.map(e => {
          const c = colorMap[e.color] ?? colorMap.blue
          const timeStr = e.start_time ? fmtTime(e.start_time) : null
          const rangeStr = fmtRange(e.from_date, e.to_date)
          return (
            <button key={e.id} onClick={() => onEdit(date, e)}
              className={`w-full text-left rounded-xl px-4 py-3 text-sm ${c.pill}`}>
              <p className="font-medium">{e.title}</p>
              {timeStr && <p className="text-xs opacity-70 mt-0.5">{timeStr}</p>}
              {rangeStr && <p className="text-xs opacity-70 mt-0.5">{rangeStr}</p>}
              {e.notes && <p className="text-xs opacity-70 mt-0.5">{e.notes}</p>}
            </button>
          )
        })}
        {reservations.map(r => (
          <button key={r.id} onClick={() => onOpenAsset(r.asset_id)}
            className="w-full text-left rounded-xl px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
            <p className="font-medium">Reservation · {assets[r.asset_id]?.label ?? '—'}</p>
            <p className="text-xs opacity-70 mt-0.5">
              {fmtRange(r.from_date, r.to_date) || 'Single day'}{r.customer_name ? ` · ${r.customer_name}` : ''}
            </p>
          </button>
        ))}
      </div>
    </>
  )
}

function DayDots({ dots, muted }) {
  if (!dots.length) return null
  return (
    <div className="flex gap-0.5 justify-center mt-0.5 flex-wrap">
      {dots.slice(0, 3).map((d, i) => (
        <div key={i} className={`w-1.5 h-1.5 rounded-full ${muted ? 'bg-primary-foreground' : d}`} />
      ))}
      {dots.length > 3 && (
        <div className={`w-1.5 h-1.5 rounded-full ${muted ? 'bg-primary-foreground/50' : 'bg-muted-foreground/40'}`} />
      )}
    </div>
  )
}

// How far ahead the agenda looks. It sits inside the loaded window, which always
// reaches to the end of the month two past the current one.
const AGENDA_DAYS = 60

function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000)
}

function fmtShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function agendaDayLabel(todayIso, iso) {
  const diff = daysBetween(todayIso, iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7) return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })
  return fmtDay(iso)
}

// A multi-day item is listed only once, so this line is where its length shows.
function spanNote(day, from, to) {
  if (from === to) return null
  if (from < day) return `Ongoing · ends ${fmtShort(to)}`
  return `Through ${fmtShort(to)}`
}

function AgendaView({ todayIso, events, reservations, assets, loading, onAdd, onEdit, onOpenAsset }) {
  if (loading) return <p className="text-sm text-muted-foreground text-center mt-6">Loading…</p>

  const end = addDays(todayIso, AGENDA_DAYS - 1)
  // Today always gets a heading, even when it is empty.
  const byDay = new Map([[todayIso, []]])
  const add = (from, to, entry) => {
    if (to < todayIso || from > end) return
    // Listed on the day it starts, or on today if it has already started.
    const day = from < todayIso ? todayIso : from
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(entry)
  }
  events.forEach(e => add(e.from_date, e.to_date, { kind: 'event', item: e }))
  reservations.forEach(r => add(r.from_date, r.to_date, { kind: 'reservation', item: r }))

  const days = [...byDay.keys()].sort()
  const total = [...byDay.values()].reduce((n, list) => n + list.length, 0)

  // All-day events first, then by time, with reservations after the events.
  const order = (a, b) => {
    if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1
    return (a.item.start_time ?? '').localeCompare(b.item.start_time ?? '')
  }

  return (
    <div className="space-y-5">
      {days.map(day => {
        const entries = byDay.get(day).sort(order)
        const diff = daysBetween(todayIso, day)
        return (
          <section key={day}>
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-baseline gap-2">
                <h2 className={`text-sm font-semibold ${diff === 0 ? 'text-primary' : ''}`}>{agendaDayLabel(todayIso, day)}</h2>
                {diff < 7 && <span className="text-xs text-muted-foreground">{fmtShort(day)}</span>}
              </div>
              {diff >= 7 && <span className="text-xs text-muted-foreground">in {diff} days</span>}
            </div>

            {entries.length === 0 ? (
              <button onClick={() => onAdd(day)}
                className="w-full text-left rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                Nothing today · tap to add
              </button>
            ) : (
              <div className="space-y-2">
                {entries.map(({ kind, item }) => {
                  const span = spanNote(day, item.from_date, item.to_date)
                  if (kind === 'reservation') {
                    return (
                      <button key={`r-${item.id}`} onClick={() => onOpenAsset(item.asset_id)}
                        className="w-full text-left rounded-xl border bg-card px-4 py-3 flex gap-3 hover:bg-accent transition-colors">
                        <div className="w-1 self-stretch rounded-full bg-amber-500" />
                        <div className="w-16 flex-shrink-0 text-xs text-amber-600 dark:text-amber-400 pt-0.5">Rental</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{assets[item.asset_id]?.label ?? 'Reservation'}</p>
                          {(item.customer_name || span) && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {[item.customer_name, span].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </button>
                    )
                  }
                  const c = colorMap[item.color] ?? colorMap.blue
                  return (
                    <button key={`e-${item.id}`} onClick={() => onEdit(day, item)}
                      className="w-full text-left rounded-xl border bg-card px-4 py-3 flex gap-3 hover:bg-accent transition-colors">
                      <div className={`w-1 self-stretch rounded-full ${c.dot}`} />
                      <div className="w-16 flex-shrink-0 text-xs text-muted-foreground pt-0.5">
                        {item.start_time ? fmtTime(item.start_time) : 'All day'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        {span && <p className="text-xs text-muted-foreground mt-0.5">{span}</p>}
                        {item.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.notes}</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      <p className="text-xs text-muted-foreground text-center pt-2">
        {total === 0 ? `Nothing scheduled in the next ${AGENDA_DAYS} days` : `Showing the next ${AGENDA_DAYS} days`}
      </p>
    </div>
  )
}

export default function Calendar() {
  const navigate = useNavigate()
  const { canManageCalendar } = useAccess()
  const today = new Date()
  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate())

  // The agenda is the landing screen every time: opening the calendar should
  // answer "what's coming up?" before anything else.
  const [view, setView] = useState('agenda')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso))
  const [selected, setSelected] = useState(null)
  const [dialog, setDialog] = useState(null) // null | { date, event? }
  const [assets, setAssets] = useState({})
  // Events and reservations are held for a wide window and filtered in memory,
  // so moving between months costs nothing and never flashes stale data.
  const [data, setData] = useState({ events: [], reservations: [], start: null, end: null })

  const loadedRef = useRef({ start: null, end: null })
  const inFlightRef = useRef(null)

  const gridStart = startOfWeek(monthStart(year, month))
  const visibleStart = view === 'month' ? gridStart : view === 'week' ? weekStart : todayIso
  const visibleEnd = view === 'month'
    ? addDays(gridStart, GRID_DAYS - 1)
    : view === 'week' ? addDays(weekStart, 6) : addDays(todayIso, AGENDA_DAYS - 1)

  const anchor = view === 'month' ? { year, month } : monthOf(view === 'week' ? weekStart : todayIso)
  const windowFrom = shiftMonth(anchor.year, anchor.month, -WINDOW_MONTHS)
  const windowTo = shiftMonth(anchor.year, anchor.month, WINDOW_MONTHS)
  const windowStart = monthStart(windowFrom.year, windowFrom.month)
  const windowEnd = monthEnd(windowTo.year, windowTo.month)

  const covered = data.start !== null && data.start <= visibleStart && data.end >= visibleEnd
  // Only the very first load has nothing to show; later window refills already
  // cover the visible days, so dimming those would be a flicker of its own.
  const empty = data.start === null

  const load = useCallback(async (from, to) => {
    const key = `${from}|${to}`
    if (inFlightRef.current === key) return
    inFlightRef.current = key
    try {
      const [{ data: evts }, { data: resvs }, { data: assetList }] = await Promise.all([
        supabase.from('calendar_events').select('*').lte('from_date', to).gte('to_date', from),
        supabase.from('reservations').select('*').lte('from_date', to).gte('to_date', from),
        supabase.from('assets').select('id, label').eq('archived', false),
      ])
      loadedRef.current = { start: from, end: to }
      setData({ events: evts ?? [], reservations: resvs ?? [], start: from, end: to })
      if (assetList) setAssets(Object.fromEntries(assetList.map(a => [a.id, a])))
    } finally {
      inFlightRef.current = null
    }
  }, [])

  // Realtime and post-save refreshes reload whatever window is on screen. Reading
  // the range from a ref keeps this callback stable, so the channel is opened
  // once instead of being torn down every time you change month.
  const reload = useCallback(() => {
    const { start, end } = loadedRef.current
    if (start && end) load(start, end)
  }, [load])

  useEffect(() => {
    if (covered) return
    load(windowStart, windowEnd)
  }, [covered, windowStart, windowEnd, load])

  useRealtime(['calendar_events', 'reservations'], reload)

  const eventsOnDay = useCallback(
    dateStr => data.events.filter(e => e.from_date <= dateStr && e.to_date >= dateStr),
    [data.events],
  )
  // Reservations span days just like events do, so they show on every day they
  // cover rather than only on the day they start.
  const resvOnDay = useCallback(
    dateStr => data.reservations.filter(r => r.from_date <= dateStr && r.to_date >= dateStr),
    [data.reservations],
  )

  if (!canManageCalendar) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Not available</div>

  function prevPeriod() {
    if (view === 'month') {
      const next = shiftMonth(year, month, -1)
      setYear(next.year); setMonth(next.month)
    } else {
      setWeekStart(addDays(weekStart, -7))
    }
  }
  function nextPeriod() {
    if (view === 'month') {
      const next = shiftMonth(year, month, 1)
      setYear(next.year); setMonth(next.month)
    } else {
      setWeekStart(addDays(weekStart, 7))
    }
  }
  function goToday() {
    setSelected(todayIso)
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setWeekStart(startOfWeek(todayIso))
  }
  function changeView(next) {
    setView(next)
    // Carry the selected day across so switching views doesn't lose your place.
    if (next === 'week') setWeekStart(startOfWeek(selected ?? todayIso))
    else if (next === 'month') {
      const m = monthOf(selected ?? (view === 'week' ? weekStart : todayIso))
      setYear(m.year); setMonth(m.month)
    }
  }

  const periodLabel = view === 'month'
    ? new Date(year, month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : (() => {
        const s = new Date(weekStart + 'T00:00:00')
        const e = new Date(addDays(weekStart, 6) + 'T00:00:00')
        return s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      })()

  const gridDays = Array.from({ length: GRID_DAYS }, (_, i) => addDays(gridStart, i))
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const selEvents = selected ? eventsOnDay(selected) : []
  const selResvs = selected ? resvOnDay(selected) : []

  function dotsFor(dateStr) {
    return [
      ...eventsOnDay(dateStr).map(e => colorMap[e.color]?.dot ?? 'bg-blue-500'),
      ...resvOnDay(dateStr).map(() => 'bg-amber-500'),
    ]
  }

  const detail = (
    <DayDetail
      date={selected}
      events={selEvents}
      reservations={selResvs}
      assets={assets}
      onAdd={date => setDialog({ date })}
      onEdit={(date, event) => setDialog({ date, event })}
      onOpenAsset={assetId => navigate(`/assets/${assetId}`)}
    />
  )

  return (
    <div className="relative h-full flex flex-col">
      {/* Header */}
      <div className="relative z-10 px-4 pt-5 pb-2 flex-shrink-0 space-y-2 bg-background">
        {view === 'agenda' ? (
          <div className="flex items-center justify-center min-h-[44px]">
            <span className="text-sm font-medium">Upcoming</span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button onClick={prevPeriod} className="text-muted-foreground hover:text-foreground p-2 -ml-2"><ChevronLeft size={28} /></button>
            <span className="text-sm font-medium text-center">{periodLabel}</span>
            <button onClick={nextPeriod} className="text-muted-foreground hover:text-foreground p-2 -mr-2"><ChevronRight size={28} /></button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          {view === 'agenda'
            ? <span className="w-[52px]" />
            : <button onClick={goToday} className="text-xs text-muted-foreground hover:text-foreground border rounded-md px-2 py-1">Today</button>}
          <div className="flex rounded-lg border overflow-hidden text-xs">
            {[['agenda', 'Agenda'], ['month', 'Month'], ['week', 'Week']].map(([key, label]) => (
              <button key={key} onClick={() => changeView(key)}
                className={`px-3 py-1.5 ${view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
          <Button size="icon" className="h-8 w-8 rounded-xl flex-shrink-0" onClick={() => setDialog({ date: selected ?? todayIso })}>
            <Plus size={16} />
          </Button>
        </div>
      </div>

      {/* Agenda view */}
      {view === 'agenda' && (
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
          <AgendaView
            todayIso={todayIso}
            events={data.events}
            reservations={data.reservations}
            assets={assets}
            loading={empty}
            onAdd={date => setDialog({ date })}
            onEdit={(date, event) => setDialog({ date, event })}
            onOpenAsset={assetId => navigate(`/assets/${assetId}`)}
          />
        </div>
      )}

      {/* DOW headers */}
      {view !== 'agenda' && (
        <div className="grid grid-cols-7 px-4 flex-shrink-0">
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
          ))}
        </div>
      )}

      {/* Month view */}
      {view === 'month' && (
        <>
          <div className={`grid grid-cols-7 px-4 gap-y-1 flex-shrink-0 transition-opacity ${empty ? 'opacity-40' : 'opacity-100'}`}>
            {gridDays.map(dateStr => {
              const day = Number(dateStr.slice(8))
              const inMonth = Number(dateStr.slice(5, 7)) === month + 1
              const isToday = dateStr === todayIso
              const isSel = dateStr === selected
              return (
                <button key={dateStr} onClick={() => setSelected(isSel ? null : dateStr)}
                  className={`flex flex-col items-center py-1 rounded-lg transition-colors ${isSel ? 'bg-primary' : isToday ? 'bg-primary/10' : 'hover:bg-accent'}`}>
                  <span className={`text-sm font-medium leading-none ${
                    isSel ? 'text-primary-foreground' : isToday ? 'text-primary' : inMonth ? '' : 'text-muted-foreground/40'
                  }`}>{day}</span>
                  <DayDots dots={dotsFor(dateStr)} muted={isSel} />
                </button>
              )
            })}
          </div>

          {/* Selected day detail */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4">{detail}</div>
        </>
      )}

      {/* Week view */}
      {view === 'week' && (
        <div className="flex-1 overflow-y-auto pb-4">
          <div className={`grid grid-cols-7 px-4 gap-x-1 mt-1 transition-opacity ${empty ? 'opacity-40' : 'opacity-100'}`}>
            {weekDays.map(dateStr => {
              const dayNum = Number(dateStr.slice(8))
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

          {/* Selected day detail — the week grid gets the same panel as the month grid */}
          <div className="px-4 pt-5">{detail}</div>
        </div>
      )}

      {dialog && (
        <EventDialog
          date={dialog.date}
          event={dialog.event}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); reload() }}
          onDeleted={() => { setDialog(null); reload() }}
        />
      )}
    </div>
  )
}
