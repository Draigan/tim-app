import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { useCallback } from 'react'
import { X } from 'lucide-react'
import BottomNav from './BottomNav'
import PushPrompt from './PushPrompt'
import ConnectionStatus from './ConnectionStatus'

function ReservationBanner() {
  const [alerts, setAlerts] = useState([])
  const [dismissed, setDismissed] = useState(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('dismissedRes') || '{}')
      const today = new Date().toISOString().slice(0, 10)
      return stored.date === today ? stored.ids : []
    } catch { return [] }
  })
  const navigate = useNavigate()

  const fetch = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const [{ data: resvs }, { data: active }] = await Promise.all([
      supabase.from('reservations').select('*').eq('from_date', today),
      supabase.from('deployments').select('asset_id').is('picked_up_at', null),
    ])
    if (!resvs || resvs.length === 0) return
    const activeIds = new Set((active || []).map(d => d.asset_id))
    const due = resvs.filter(r => !activeIds.has(r.asset_id))
    if (due.length === 0) return
    const { data: assets } = await supabase.from('assets').select('id, label').in('id', due.map(r => r.asset_id))
    const assetMap = Object.fromEntries((assets || []).map(a => [a.id, a]))
    setAlerts(due.map(r => ({ ...r, asset: assetMap[r.asset_id] ?? null })))
  }, [])

  useEffect(() => { fetch() }, [fetch])
  useRealtime(['reservations', 'deployments'], fetch)

  function dismiss(id) {
    const next = [...dismissed, id]
    setDismissed(next)
    const today = new Date().toISOString().slice(0, 10)
    sessionStorage.setItem('dismissedRes', JSON.stringify({ date: today, ids: next }))
  }

  const visible = alerts.filter(a => !dismissed.includes(a.id))
  if (visible.length === 0) return null

  return (
    <div className="flex flex-col gap-1 px-3 pt-2 flex-shrink-0">
      {visible.map(r => (
        <div key={r.id} className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/40 rounded-lg px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <span className="flex-1 min-w-0">
            <button className="font-medium hover:underline truncate" onClick={() => navigate(`/assets/${r.asset_id}`)}>
              {r.asset?.label ?? 'Asset'}
            </button>
            {' '}is reserved today{r.customer_name ? ` · ${r.customer_name}` : ''}
          </span>
          <button onClick={() => dismiss(r.id)} className="flex-shrink-0 hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const showLogo = pathname !== '/' && pathname !== '/storage/floorplan'
  const showNav  = pathname !== '/storage/floorplan'

  return (
    <div className="flex flex-col h-full">
      {showLogo && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1 border-b bg-background flex-shrink-0">
          <img src="/logo.webp" alt="Timberfell" className="h-8 w-auto logo-invert" />
          <ConnectionStatus />
        </div>
      )}
      <ReservationBanner />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      {showNav && <BottomNav />}
      <PushPrompt />
    </div>
  )
}
