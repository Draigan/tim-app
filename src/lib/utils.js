import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function getMarkerColor(expiresAt) {
  if (!expiresAt) return '#22c55e'
  const daysLeft = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return '#ef4444'
  if (daysLeft <= 3) return '#f59e0b'
  return '#22c55e'
}

export const TYPE_ICONS = [
  '🗑️','📦','🚽','🚛','🏗️','⚙️','🛢️','🔧','🏠','⛽','🧲','🪣',
  '🚰','🪜','🔩','🧱','🪵','🏚️','🚜','🛻','🚧','💡','🔌','🧰',
]

export function formatPhone(phone) {
  if (!phone) return ''
  const text = String(phone).trim()
  const rawDigits = text.replace(/\D/g, '')
  const digits = rawDigits.length === 11 && rawDigits.startsWith('1') ? rawDigits.slice(1) : rawDigits
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
  return text
}

export function formatPhoneInput(value) {
  const rawDigits = String(value).replace(/\D/g, '')
  const digits = (rawDigits.length > 10 && rawDigits.startsWith('1') ? rawDigits.slice(1) : rawDigits).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export function getErrorMessage(error, fallback = 'Something went wrong.') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'No internet connection. Check your connection and try again.'
  }

  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && error.message) {
    return String(error.message)
  }
  return fallback
}

export function newClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function isRetryableError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true

  const status = Number(error?.status)
  if (status === 408 || status === 429 || status >= 500) return true

  const message = String(error?.message ?? error ?? '').toLowerCase()
  return [
    'failed to fetch',
    'load failed',
    'networkerror',
    'network request failed',
    'timeout',
    'timed out',
    'temporarily unavailable',
  ].some(text => message.includes(text))
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function retryTransient(operation, { attempts = 3, delayMs = 700 } = {}) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (err) {
      lastError = err
      if (attempt >= attempts || !isRetryableError(err)) throw err
      await wait(delayMs * attempt)
    }
  }

  throw lastError
}

export function throwSupabaseError(result) {
  if (!result?.error) return result
  if (typeof result.status === 'number') result.error.status = result.status
  throw result.error
}
