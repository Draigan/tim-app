import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Share, MoreVertical, Plus, Download } from 'lucide-react'

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
const isAndroid = /android/i.test(navigator.userAgent)
const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
const PASSWORD_MIN_LENGTH = 12

function passwordPolicyError(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter'
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter'
  if (!/[0-9]/.test(password)) return 'Password must include a number'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a symbol'
  return null
}

function InstallBanner({ deferredPrompt, onInstall }) {
  if (isStandalone) return null

  if (isIos) {
    return (
      <div className="rounded-xl border bg-muted/50 p-4 text-sm space-y-2">
        <p className="font-medium text-center">Add to Home Screen</p>
        <div className="space-y-1.5 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
            <span>Tap the <Share size={13} className="inline mx-0.5 mb-0.5" /> Share button in Safari</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
            <span>Tap <strong>"Add to Home Screen"</strong> <Plus size={13} className="inline mx-0.5 mb-0.5" /></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
            <span>Tap <strong>"Add"</strong> to install</span>
          </div>
        </div>
      </div>
    )
  }

  if (deferredPrompt) {
    return (
      <Button variant="outline" className="w-full" onClick={onInstall}>
        <Download size={15} />
        Install App
      </Button>
    )
  }

  // Android fallback (prompt already dismissed or not Chrome)
  if (isAndroid) {
    return (
      <div className="rounded-xl border bg-muted/50 p-4 text-sm space-y-2">
        <p className="font-medium text-center">Add to Home Screen</p>
        <div className="space-y-1.5 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
            <span>Tap <MoreVertical size={13} className="inline mx-0.5 mb-0.5" /> in your browser menu</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
            <span>Tap <strong>"Add to Home Screen"</strong></span>
          </div>
        </div>
      </div>
    )
  }

  return null
}

function SetPasswordForm({ onPasswordSet }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    const passwordError = passwordPolicyError(password)
    if (passwordError) { setError(passwordError); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false) }
    else onPasswordSet?.()
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <img src="/logo.webp" alt="Timberfell" className="h-14 w-auto mx-auto logo-invert" />
          <p className="text-sm text-muted-foreground">Set a password to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw">New Password</Label>
            <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus />
            <p className="text-xs text-muted-foreground">Min. 12 characters, uppercase, lowercase, number, and symbol</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cpw">Confirm Password</Label>
            <Input id="cpw" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Saving…' : 'Set Password'}
          </Button>
        </form>
      </div>
    </div>
  )
}

export function LogoSplash() {
  return (
    <div className="text-center">
      <img src="/logo.webp" alt="Timberfell" className="splash-logo h-16 w-auto mx-auto" />
      <p className="splash-form text-sm text-muted-foreground mt-3">Sign in to continue</p>
    </div>
  )
}

export default function Login({ onPasswordSet }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)

  useEffect(() => {
    function handler(e) { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  if (onPasswordSet) return <SetPasswordForm onPasswordSet={onPasswordSet} />

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-8">
        <LogoSplash />

        <form className="splash-form space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@company.com"
              value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password"
              value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        <div className="splash-form">
          <InstallBanner deferredPrompt={deferredPrompt} onInstall={handleInstall} />
        </div>
      </div>
    </div>
  )
}
