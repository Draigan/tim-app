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
