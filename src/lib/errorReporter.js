import { supabase } from './supabase'

const DEDUPE_MS = 60_000
const MAX_DETAIL_LENGTH = 600
const MAX_BODY_LENGTH = 180

let installed = false
const lastSentAtByKey = new Map()

function truncate(value, maxLength) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function safeJson(value) {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return String(item)
    if (!item || typeof item !== 'object') return item
    if (seen.has(item)) return '[Circular]'
    seen.add(item)
    return item
  })
}

function argText(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
    if (typeof value.error?.message === 'string') return value.error.message
    return safeJson(value)
  }
  return String(value)
}

function errorDetails(reason) {
  if (Array.isArray(reason)) {
    return {
      message: reason.map(argText).filter(Boolean).join(' '),
      detail: reason.map(argText).filter(Boolean).join('\n'),
      stack: reason.find(item => item instanceof Error)?.stack || '',
    }
  }

  if (reason instanceof Error) {
    return {
      message: `${reason.name}: ${reason.message}`,
      detail: reason.message,
      stack: reason.stack || '',
    }
  }

  const message = argText(reason)
  return { message, detail: message, stack: '' }
}

function reportUrl() {
  if (typeof window === 'undefined') return '/'
  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`
  return path.startsWith('/') ? path : '/'
}

function reportKey(source, message) {
  return `${source}:${reportUrl()}:${message}`.slice(0, 300)
}

export function reportErrorToSuperuser(reason, context = {}) {
  if (typeof window === 'undefined') return

  const source = String(context.source || 'app')
  const details = errorDetails(reason)
  const message = truncate(details.message, MAX_DETAIL_LENGTH)
  if (!message) return

  const key = reportKey(source, message)
  const now = Date.now()
  const lastSentAt = lastSentAtByKey.get(key) || 0
  if (now - lastSentAt < DEDUPE_MS) return
  lastSentAtByKey.set(key, now)

  const url = reportUrl()
  const body = truncate(`${source}: ${message}`, MAX_BODY_LENGTH)
  const metadata = {
    source,
    message,
    detail: truncate(details.detail, MAX_DETAIL_LENGTH),
    stack: truncate(details.stack, MAX_DETAIL_LENGTH),
    url,
    user_agent: navigator.userAgent,
    ...context,
  }

  void sendReport({ title: 'App error', body, url, metadata })
}

async function sendReport({ title, body, url, metadata }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to_superuser: true,
        title,
        body,
        url,
        error: metadata,
      }),
    })
  } catch {
    // Error reporting must never create a second app error.
  }
}

export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalConsoleError = console.error.bind(console)
  console.error = (...args) => {
    originalConsoleError(...args)
    reportErrorToSuperuser(args, { source: 'console.error' })
  }

  window.addEventListener('error', event => {
    reportErrorToSuperuser(event.error || event.message, {
      source: 'window.error',
      filename: event.filename || '',
      lineno: event.lineno || null,
      colno: event.colno || null,
    })
  })

  window.addEventListener('unhandledrejection', event => {
    reportErrorToSuperuser(event.reason, { source: 'unhandledrejection' })
  })
}
