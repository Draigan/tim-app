import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Wifi, WifiOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const STATUS = {
  checking: {
    label: 'Checking',
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
    icon: Loader2,
    spin: true,
  },
  online: {
    label: 'Online',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-400',
    icon: Wifi,
  },
  slow: {
    label: 'Slow',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    icon: Wifi,
  },
  offline: {
    label: 'Offline',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-400',
    icon: WifiOff,
  },
}

async function checkSupabaseConnection() {
  if (navigator.onLine === false) return 'offline'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  const started = performance.now()

  try {
    const { error } = await supabase
      .from('customers')
      .select('id')
      .limit(1)
      .abortSignal(controller.signal)

    if (error) throw error

    const elapsed = performance.now() - started
    return elapsed > 2500 ? 'slow' : 'online'
  } catch (err) {
    console.warn('connection check failed:', err)
    return 'offline'
  } finally {
    clearTimeout(timeout)
  }
}

function useConnectionStatus() {
  const [status, setStatus] = useState(() => navigator.onLine === false ? 'offline' : 'checking')
  const checkId = useRef(0)

  const check = useCallback(async () => {
    const id = checkId.current + 1
    checkId.current = id

    if (navigator.onLine === false) {
      setStatus('offline')
      return
    }

    setStatus(current => current === 'offline' ? 'checking' : current)
    const next = await checkSupabaseConnection()
    if (checkId.current === id) setStatus(next)
  }, [])

  useEffect(() => {
    check()

    const handleOnline = () => check()
    const handleOffline = () => setStatus('offline')
    const handleVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    const interval = setInterval(check, 30000)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisible)

    return () => {
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [check])

  return status
}

export default function ConnectionStatus({ compact = false }) {
  const status = useConnectionStatus()
  const config = STATUS[status] ?? STATUS.checking
  const Icon = config.icon

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex h-8 w-8 items-center justify-center"
        title={`Connection: ${config.label} — tap to reload`}
        aria-label={`Connection status: ${config.label}`}
      >
        <Icon size={18} className={cn(config.text, config.spin && 'animate-spin')} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={cn(
        'h-8 flex items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium',
        config.text
      )}
      title="Tap to reload the app"
      aria-label={`Connection status: ${config.label}`}
    >
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      <Icon size={13} className={config.spin ? 'animate-spin' : ''} />
      <span>{config.label}</span>
    </button>
  )
}
