import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const KEY = 'chat_last_seen'

export function markChatRead() {
  localStorage.setItem(KEY, new Date().toISOString())
}

export function useUnreadChat(active) {
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    if (active) {
      markChatRead()
      setHasUnread(false)
      return
    }

    const lastSeen = localStorage.getItem(KEY) ?? new Date(0).toISOString()

    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .gt('sent_at', lastSeen)
      .then(({ count }) => setHasUnread((count ?? 0) > 0))

    const channel = supabase
      .channel('unread-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        setHasUnread(true)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [active])

  return hasUnread
}
