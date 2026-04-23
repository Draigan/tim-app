import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Chat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [userId, setUserId] = useState(null)
  const [sessionReady, setSessionReady] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const sessionRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session
      setUserId(session?.user?.id)
      setSessionReady(true)
    })
  }, [])

  useEffect(() => {
    if (!sessionReady) return
    supabase
      .from('messages')
      .select('*')
      .order('sent_at', { ascending: true })
      .then(({ data }) => { if (data) setMessages(data) })
  }, [sessionReady])

  useEffect(() => {
    const channel = supabase
      .channel('messages-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: msg }) => {
        setMessages(prev => [...prev, msg])
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    const session = sessionRef.current
    const user = session?.user
    await supabase.from('messages').insert({
      user_id: user.id,
      sender_name: user?.user_metadata?.full_name ?? user?.email ?? 'Unknown',
      content: text,
    })
    inputRef.current?.focus()
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 border-b flex-shrink-0">
        <h1 className="text-xl font-semibold">Team Chat</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center pt-8">No messages yet. Say something!</p>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.user_id === userId
          const prevMsg = messages[i - 1]
          const showName = !isOwn && msg.sender_name !== prevMsg?.sender_name
          return (
            <div key={msg.id} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
              {showName && (
                <p className="text-xs text-muted-foreground mb-1 px-1">{msg.sender_name}</p>
              )}
              <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl ${isOwn ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'}`}>
                <p className="text-sm leading-relaxed break-words">{msg.content}</p>
              </div>
              {(i === messages.length - 1 || messages[i + 1]?.user_id !== msg.user_id) && (
                <p className="text-[10px] text-muted-foreground mt-1 px-1">{timeAgo(msg.sent_at)}</p>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={sendMessage}
        className="border-t px-4 py-3 flex gap-2 flex-shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Message the team…"
          className="flex-1 bg-muted rounded-full px-4 py-2 text-sm outline-none"
          autoComplete="off"
        />
        <Button type="submit" size="icon" disabled={!input.trim()} className="rounded-full flex-shrink-0">
          <Send size={16} />
        </Button>
      </form>
    </div>
  )
}
