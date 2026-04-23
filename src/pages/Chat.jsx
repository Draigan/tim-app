import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'

const PAGE_SIZE = 30

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
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const scrollRef = useRef(null)
  const sessionRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session
      setUserId(session?.user?.id)
      supabase
        .from('messages')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(PAGE_SIZE)
        .then(({ data }) => {
          if (!data) return
          setMessages(data.reverse())
          setHasMore(data.length === PAGE_SIZE)
        })
    })
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('messages-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: msg }) => {
        setMessages(prev => [...prev, msg])
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  // Scroll to bottom on initial load and new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length > 0 && messages[messages.length - 1]?.id])

  async function loadMore() {
    if (loadingMore || !hasMore || messages.length === 0) return
    setLoadingMore(true)
    const oldest = messages[0].sent_at
    const el = scrollRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0

    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('sent_at', { ascending: false })
      .lt('sent_at', oldest)
      .limit(PAGE_SIZE)

    if (data) {
      const older = data.reverse()
      setMessages(prev => [...older, ...prev])
      setHasMore(data.length === PAGE_SIZE)
      // Preserve scroll position after prepend
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevScrollHeight
      })
    }
    setLoadingMore(false)
  }

  async function sendMessage(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    const user = sessionRef.current?.user
    await supabase.from('messages').insert({
      user_id: user.id,
      sender_name: user?.user_metadata?.full_name ?? user?.email ?? 'Unknown',
      content: text,
    })
    inputRef.current?.focus()
  }

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {loadingMore ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center pt-8">No messages yet. Say something!</p>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.user_id === userId
          const prevMsg = messages[i - 1]
          const nextMsg = messages[i + 1]
          const showName = msg.sender_name !== prevMsg?.sender_name
          const isLastInRun = nextMsg?.sender_name !== msg.sender_name
          return (
            <div key={msg.id} className="flex flex-col items-start">
              {showName && (
                <p className={`text-xs font-medium mb-1 px-1 ${isOwn ? 'text-primary' : 'text-muted-foreground'}`}>
                  {isOwn ? 'You' : msg.sender_name}
                </p>
              )}
              <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl ${isOwn ? 'bg-primary/15 text-foreground' : 'bg-muted'}`}>
                <p className="text-sm leading-relaxed break-words">{msg.content}</p>
              </div>
              {isLastInRun && (
                <p className="text-[10px] text-muted-foreground mt-1 mb-1 px-1">{timeAgo(msg.sent_at)}</p>
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
