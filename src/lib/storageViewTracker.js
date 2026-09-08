import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabase'
import { isStorageWatched } from './authz'

const RPC_URL = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/record_storage_view`
const PUSH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`

// Keep the stored duration fresh so a killed tab still leaves an accurate row.
const HEARTBEAT_MS = 15_000
// A tab switch or a locked phone ends the visit. Coming back inside this window
// continues the same visit instead of opening a second one.
const RESUME_GRACE_MS = 60_000
// Ignore accidental taps, and only report a resumed visit again once it has
// gathered another meaningful chunk of time.
const FIRST_NOTIFY_SECONDS = 5
const FOLLOW_UP_NOTIFY_SECONDS = 60

export function isStorageSectionPath(pathname) {
  return pathname === '/storage' || pathname.startsWith('/storage/')
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (!minutes) return `${rest}s`
  if (!rest) return `${minutes}m`
  return `${minutes}m ${rest}s`
}

function createState() {
  return {
    user: null,
    token: '',
    pathname: typeof window === 'undefined' ? '/' : window.location.pathname,
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    visit: null,
    heartbeatId: null,
    pending: Promise.resolve(),
  }
}

function recordVisit(state, { visit, duration, ended = false, reopen = false, keepalive = false }) {
  if (!state.token) return
  const body = {
    p_session_id: visit.id,
    p_path: visit.path,
    p_duration_seconds: duration,
    p_ended: ended,
    p_notified_seconds: visit.reportedSeconds,
    p_reopen: reopen,
  }
  const send = () => sendRecord(state, body, keepalive)
  // Calls are chained so a heartbeat can never overtake the call that opened the
  // visit. A keepalive call goes out immediately: the page is closing and a
  // queued request would never be sent.
  if (keepalive) send()
  else state.pending = state.pending.then(send)
}

function sendRecord(state, body, keepalive) {
  // Tracking must never surface as an app error, so every failure stays silent.
  return fetch(RPC_URL, {
    method: 'POST',
    keepalive,
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  }).catch(() => {})
}

function notifySuperuser(state, visit, durationSeconds, keepalive) {
  fetch(PUSH_URL, {
    method: 'POST',
    keepalive,
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to_superuser: true,
      kind: 'storage_view',
      title: 'Storage viewed',
      body: `${state.user.email} spent ${formatDuration(durationSeconds)} in Storage`,
      url: '/storage',
      metadata: {
        session_id: visit.id,
        user_email: state.user.email,
        path: visit.path,
        started_at: new Date(visit.startedAt).toISOString(),
        ended_at: new Date(visit.closedAt).toISOString(),
        duration_seconds: durationSeconds,
        already_reported_seconds: visit.reportedSeconds,
      },
    }),
  }).catch(() => {})
}

function activeSeconds(visit, now) {
  const running = visit.runningSince ? now - visit.runningSince : 0
  return Math.round((visit.activeMs + running) / 1000)
}

function stopHeartbeat(state) {
  if (state.heartbeatId === null) return
  clearInterval(state.heartbeatId)
  state.heartbeatId = null
}

function startHeartbeat(state) {
  stopHeartbeat(state)
  state.heartbeatId = setInterval(() => {
    const visit = state.visit
    if (!visit || !visit.runningSince) return
    recordVisit(state, { visit, duration: activeSeconds(visit, Date.now()) })
  }, HEARTBEAT_MS)
}

function beginVisit(state) {
  const visit = state.visit
  const now = Date.now()

  if (visit && visit.runningSince) return

  if (visit && visit.closedAt && now - visit.closedAt <= RESUME_GRACE_MS) {
    visit.closedAt = null
    visit.runningSince = now
    recordVisit(state, { visit, duration: activeSeconds(visit, now), reopen: true })
  } else {
    state.visit = {
      id: crypto.randomUUID(),
      path: state.pathname,
      startedAt: now,
      activeMs: 0,
      runningSince: now,
      reportedSeconds: 0,
      closedAt: null,
    }
    recordVisit(state, { visit: state.visit, duration: 0, reopen: true })
  }

  startHeartbeat(state)
}

function endVisit(state, { keepalive = false } = {}) {
  const visit = state.visit
  if (!visit || visit.closedAt) return

  const now = Date.now()
  const duration = activeSeconds(visit, now)
  visit.activeMs = duration * 1000
  visit.runningSince = null
  visit.closedAt = now
  stopHeartbeat(state)

  const threshold = visit.reportedSeconds ? FOLLOW_UP_NOTIFY_SECONDS : FIRST_NOTIFY_SECONDS
  const report = duration - visit.reportedSeconds >= threshold
  const previouslyReported = visit.reportedSeconds

  // Record the reported total in the same call that closes the visit, so a
  // notification can never be sent twice for the same seconds.
  if (report) visit.reportedSeconds = duration
  recordVisit(state, { visit, duration, ended: true, keepalive })

  if (!report) return
  notifySuperuser(state, { ...visit, reportedSeconds: previouslyReported }, duration, keepalive)
}

function syncVisit(state) {
  if (!state.user || !state.token) return
  if (state.visible && isStorageSectionPath(state.pathname)) beginVisit(state)
  else endVisit(state)
}

/**
 * Times how long a watched account (see STORAGE_WATCH_EMAILS) spends in the
 * Storage section and reports each visit to the superuser. Mounted once, in
 * Layout. Anyone not on the watch list is never touched.
 */
export function useStorageViewTracker() {
  const { pathname } = useLocation()
  const stateRef = useRef(createState())

  useEffect(() => {
    const state = stateRef.current
    let cancelled = false

    function applySession(session) {
      if (cancelled) return
      const user = session?.user
      if (!user || !session.access_token || !isStorageWatched(user)) {
        // Close the visit while the old token can still write it out.
        endVisit(state)
        state.user = null
        state.token = ''
        state.visit = null
        return
      }
      state.user = { id: user.id, email: user.email }
      state.token = session.access_token
      syncVisit(state)
    }

    supabase.auth.getSession().then(({ data: { session } }) => applySession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applySession(session))

    function handleVisibility() {
      state.visible = document.visibilityState !== 'hidden'
      syncVisit(state)
    }

    function handlePageHide() {
      endVisit(state, { keepalive: true })
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      endVisit(state)
    }
  }, [])

  useEffect(() => {
    const state = stateRef.current
    state.pathname = pathname
    syncVisit(state)
  }, [pathname])
}
