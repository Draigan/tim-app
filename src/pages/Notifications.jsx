import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { Bell } from 'lucide-react'

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Notifications() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchMessages = useCallback(() => {
    supabase
      .from('broadcasts')
      .select('*')
      .order('sent_at', { ascending: false })
      .then(({ data }) => {
        if (data) setMessages(data)
        setLoading(false)
      })
  }, [])

  useEffect(() => { fetchMessages() }, [fetchMessages])
  useRealtime(['broadcasts'], fetchMessages)

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Notifications</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
            <Bell size={32} strokeWidth={1.5} />
            <p className="text-sm">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(m => (
              <div key={m.id} className="bg-card border rounded-xl px-4 py-3">
                <p className="text-sm leading-relaxed">{m.message}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{timeAgo(m.sent_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
