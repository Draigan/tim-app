// Bumping this key retires any accept/decline already stored on a device.
const STORAGE_KEY = 'voice_trial_v2'
const SESSION_SKIP_KEY = 'voice_trial_skipped_v2'
export const TRIAL_DAYS = 10
export const VOICE_TRIAL_EVENT = 'voice-trial-changed'

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function getVoiceTrial() {
  const stored = read()
  if (!stored?.acceptedAt || !stored?.expiresAt) return null
  const expiresAt = new Date(stored.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) return null
  const msLeft = expiresAt.getTime() - Date.now()
  return {
    acceptedAt: stored.acceptedAt,
    expiresAt: stored.expiresAt,
    active: msLeft > 0,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
  }
}

export function isVoiceTrialActive() {
  return getVoiceTrial()?.active === true
}

export function acceptVoiceTrial() {
  const now = new Date()
  const value = {
    acceptedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TRIAL_DAYS * 86400000).toISOString(),
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* ignore */ }
  window.dispatchEvent(new Event(VOICE_TRIAL_EVENT))
}

// Declining only quiets the pitch for this session — it comes back next launch.
export function declineVoiceTrial() {
  try { sessionStorage.setItem(SESSION_SKIP_KEY, '1') } catch { /* ignore */ }
  window.dispatchEvent(new Event(VOICE_TRIAL_EVENT))
}

export function wasDeclinedThisSession() {
  try { return sessionStorage.getItem(SESSION_SKIP_KEY) === '1' } catch { return false }
}

export function shouldShowVoiceTrial({ ignoreAccepted = false } = {}) {
  if (!ignoreAccepted && getVoiceTrial()) return false
  return !wasDeclinedThisSession()
}

export function resetVoiceTrial() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(SESSION_SKIP_KEY)
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(VOICE_TRIAL_EVENT))
}
