import { useEffect } from 'react'
import { supabase } from './supabase'

export function useRealtime(tables, callback) {
  useEffect(() => {
    const channel = supabase.channel('realtime-' + tables.join('-'))
    tables.forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, callback)
    })
    channel.subscribe()
    return () => supabase.removeChannel(channel)
  }, [callback])
}
