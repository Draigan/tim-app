import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, CheckCheck, Circle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 200

function fmtDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function badgeVariant(severity) {
  if (severity === 'success') return 'success'
  if (severity === 'warning') return 'warning'
  if (severity === 'error') return 'destructive'
  return 'secondary'
}

function typeLabel(type) {
  return String(type || 'general')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function Notifications() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [readIds, setReadIds] = useState(new Set())
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setUserId(null)
      setNotifications([])
      setReadIds(new Set())
      setLoading(false)
      return
    }

    setUserId(user.id)

    const { data, error: notificationError } = await supabase
      .from('app_notifications')
      .select('id, audience, type, severity, title, body, url, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (notificationError) {
      setError(notificationError.message)
      setLoading(false)
      return
    }

    const rows = data ?? []
    setNotifications(rows)

    const ids = rows.map(row => row.id)
    if (!ids.length) {
      setReadIds(new Set())
      setLoading(false)
      return
    }

    const { data: reads, error: readError } = await supabase
      .from('app_notification_reads')
      .select('notification_id')
      .eq('user_id', user.id)
      .in('notification_id', ids)

    if (readError) {
      setError(readError.message)
      setLoading(false)
      return
    }

    setReadIds(new Set((reads ?? []).map(read => read.notification_id)))
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    if (!userId) return undefined

    const channel = supabase
      .channel(`notifications-page-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_notifications' }, load)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_notification_reads', filter: `user_id=eq.${userId}` },
        load,
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [load, userId])

  const unread = useMemo(
    () => notifications.filter(notification => !readIds.has(notification.id)),
    [notifications, readIds],
  )
  const visible = useMemo(() => {
    if (filter === 'unread') return unread
    return notifications
  }, [filter, notifications, unread])

  async function markRead(notificationIds) {
    if (!userId || notificationIds.length === 0) return
    const readAt = new Date().toISOString()
    const rows = notificationIds.map(notificationId => ({
      notification_id: notificationId,
      user_id: userId,
      read_at: readAt,
    }))
    const { error: readError } = await supabase
      .from('app_notification_reads')
      .upsert(rows, { onConflict: 'notification_id,user_id' })

    if (readError) {
      setError(readError.message)
      return
    }

    setReadIds(current => new Set([...current, ...notificationIds]))
  }

  async function openNotification(notification) {
    await markRead([notification.id])
    if (notification.url) navigate(notification.url)
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold leading-tight">Notifications</h1>
          <p className="text-xs text-muted-foreground">{unread.length} unread</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'h-8 px-3 rounded-md text-sm border transition-colors',
            filter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
          )}
        >
          All
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={cn(
            'h-8 px-3 rounded-md text-sm border transition-colors',
            filter === 'unread' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
          )}
        >
          Unread
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => markRead(unread.map(notification => notification.id))}
          disabled={!unread.length}
        >
          <CheckCheck size={16} />
          Mark all read
        </Button>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && notifications.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-10">Loading notifications...</div>
        ) : visible.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 text-muted-foreground">
            <Bell size={34} className="mb-3" />
            <p className="text-sm font-medium text-foreground">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
            <p className="text-xs mt-1">Storage bookings and online payments will show up here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(notification => {
              const isUnread = !readIds.has(notification.id)
              return (
                <button
                  key={notification.id}
                  onClick={() => openNotification(notification)}
                  className={cn(
                    'w-full text-left rounded-lg border px-3 py-3 transition-colors',
                    isUnread ? 'bg-primary/5 border-primary/30' : 'bg-card hover:bg-accent',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="pt-1">
                      <Circle size={10} className={isUnread ? 'fill-primary text-primary' : 'text-transparent'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className={cn('text-sm leading-snug flex-1', isUnread ? 'font-semibold' : 'font-medium')}>
                          {notification.title}
                        </p>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(notification.created_at)}</span>
                      </div>
                      {notification.body && (
                        <p className="text-sm text-muted-foreground mt-1 leading-snug">{notification.body}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={badgeVariant(notification.severity)}>
                          {typeLabel(notification.type)}
                        </Badge>
                        {notification.url && <span className="text-xs text-muted-foreground">Tap to open</span>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
