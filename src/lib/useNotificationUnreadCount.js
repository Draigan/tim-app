import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useNotificationUnreadCount(enabled = true) {
  const [count, setCount] = useState(0)
  const [userId, setUserId] = useState(null)

  const load = useCallback(async () => {
    if (!enabled) {
      setCount(0)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setUserId(null)
      setCount(0)
      return
    }

    setUserId(user.id)

    const { data: notifications, error: notificationError } = await supabase
      .from('app_notifications')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(500)

    if (notificationError) {
      console.error('Unable to load notification count.', notificationError)
      return
    }

    const ids = (notifications ?? []).map(notification => notification.id)
    if (!ids.length) {
      setCount(0)
      return
    }

    const { data: reads, error: readError } = await supabase
      .from('app_notification_reads')
      .select('notification_id')
      .eq('user_id', user.id)
      .in('notification_id', ids)

    if (readError) {
      console.error('Unable to load notification reads.', readError)
      return
    }

    const readIds = new Set((reads ?? []).map(read => read.notification_id))
    setCount(ids.filter(id => !readIds.has(id)).length)
  }, [enabled])

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
    if (!enabled || !userId) return undefined

    const channel = supabase
      .channel(`notification-unread-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_notifications' }, load)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_notification_reads', filter: `user_id=eq.${userId}` },
        load,
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [enabled, load, userId])

  return count
}
