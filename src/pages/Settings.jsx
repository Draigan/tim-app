import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, LogOut, Sun, Moon, MessageSquare, Bell, BellOff } from 'lucide-react'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'
import { useTheme } from '@/lib/theme'
import { usePushNotifications } from '@/lib/usePushNotifications'
import { ADMIN_EMAILS, isAdminUser } from '@/lib/authz'

const PASSWORD_MIN_LENGTH = 12

function validPassword(pw) {
  return pw.length >= PASSWORD_MIN_LENGTH
    && /[a-z]/.test(pw)
    && /[A-Z]/.test(pw)
    && /[0-9]/.test(pw)
    && /[^A-Za-z0-9]/.test(pw)
}

async function adminFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return res.json()
}

function UsersPanel() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createDone, setCreateDone] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    try {
      const data = await adminFetch('')
      if (Array.isArray(data)) setUsers(data.sort((a, b) => {
      if (ADMIN_EMAILS.includes(a.email)) return -1
      if (ADMIN_EMAILS.includes(b.email)) return 1
      return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)
    }))
    } catch (e) {
      console.error('admin fetch failed', e)
    }
    setLoading(false)
  }

  async function handleCreate() {
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) return
    setCreating(true)
    setCreateError('')
    const res = await adminFetch('?action=create', {
      method: 'POST',
      body: JSON.stringify({ email: newEmail.trim(), password: newPassword.trim(), full_name: newName.trim() }),
    })
    setCreating(false)
    if (res.error) { setCreateError(res.error); return }
    setCreateDone(true)
    fetchUsers()
  }

  async function handleDelete(userId) {
    await adminFetch('?action=delete', { method: 'POST', body: JSON.stringify({ userId }) })
    setConfirmDeleteUser(null)
    await fetchUsers()
  }

  function fmtDate(iso) {
    if (!iso) return null
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Users</h2>
        <Button size="sm" variant="outline" onClick={() => { setShowCreate(true); setCreateDone(false); setNewName(''); setNewEmail(''); setNewPassword(''); setNewPasswordConfirm(''); setCreateError('') }}>
          <Plus size={14} />
          Add User
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="bg-card border rounded-xl px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{u.full_name ?? u.email}</p>
                {u.full_name && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {u.last_sign_in_at ? `Last seen ${fmtDate(u.last_sign_in_at)}` : u.confirmed_at ? 'Never signed in' : 'Invite pending'}
                </p>
              </div>
              {!ADMIN_EMAILS.includes(u.email) && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    title="Delete account"
                    onClick={() => setConfirmDeleteUser(u)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!confirmDeleteUser} onOpenChange={open => { if (!open) { setConfirmDeleteUser(null); setDeleteConfirmText('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmDeleteUser?.full_name ?? confirmDeleteUser?.email}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">This permanently removes their account. They won't be able to log in.</p>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-1.5">Type <span className="font-medium text-foreground">{confirmDeleteUser?.full_name ?? confirmDeleteUser?.email}</span> to confirm</p>
            <Input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="Type name to confirm…"
              autoFocus
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" className="flex-1" onClick={() => { setConfirmDeleteUser(null); setDeleteConfirmText('') }}>Cancel</Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteConfirmText.trim().toLowerCase() !== (confirmDeleteUser?.full_name ?? confirmDeleteUser?.email ?? '').toLowerCase()}
              onClick={() => handleDelete(confirmDeleteUser.id)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          {createDone ? (
            <div className="py-4 text-center space-y-2">
              <p className="font-medium">Account created!</p>
              <p className="text-sm text-muted-foreground">Give {newName} their email and temporary password to log in.</p>
              <Button className="w-full mt-2" onClick={() => setShowCreate(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Name</p>
                <Input placeholder="John Smith" value={newName} onChange={e => setNewName(e.target.value)} autoFocus required />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Email</p>
                <Input type="email" placeholder="john@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Password</p>
                <Input type="password" autoComplete="new-password" placeholder="They'll use this to log in" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">Min. 12 characters, uppercase, lowercase, number, and symbol</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Confirm Password</p>
                <Input type="password" autoComplete="new-password" placeholder="Repeat password" value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} />
                {newPasswordConfirm && newPassword !== newPasswordConfirm && (
                  <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                )}
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleCreate} disabled={creating || !newName.trim() || !newEmail.trim() || !validPassword(newPassword) || newPassword !== newPasswordConfirm}>
                  {creating ? 'Creating…' : 'Create Account'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BillingSettingsPanel() {
  const [enabled, setEnabled] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('billing_settings').select('auto_charge_enabled').eq('id', 1).single()
      .then(({ data }) => { if (data) setEnabled(data.auto_charge_enabled) })
  }, [])

  async function toggle() {
    const next = !enabled
    setSaving(true)
    await supabase.from('billing_settings').update({ auto_charge_enabled: next }).eq('id', 1)
    setEnabled(next)
    setSaving(false)
  }

  if (enabled === null) return null

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Billing</p>
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium">Daily auto-charge</p>
            <p className="text-xs text-muted-foreground mt-0.5">Automatically charge cards on billing day each month</p>
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${enabled ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}

function SmsSettingsPanel() {
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.from('sms_settings').select('*').eq('id', 1).single()
      .then(({ data }) => { if (data) setSettings(data) })
  }, [])

  async function handleSave() {
    setSaving(true)
    await supabase.from('sms_settings').update({
      enabled:                   settings.enabled,
      remind_on_due_day:         settings.remind_on_due_day,
      first_reminder_days_after: Number(settings.first_reminder_days_after),
      repeat_interval_days:      Number(settings.repeat_interval_days),
      business_name:             settings.business_name,
    }).eq('id', 1)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settings) return null

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Storage Settings</p>
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium">SMS Reminders</p>
            <p className="text-xs text-muted-foreground mt-0.5">Auto-text tenants when payment is overdue</p>
          </div>
          <button
            onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${settings.enabled ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${settings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {settings.enabled && (
          <div className="px-4 pb-4 space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Remind on due day</p>
              <button
                onClick={() => setSettings(s => ({ ...s, remind_on_due_day: !s.remind_on_due_day }))}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${settings.remind_on_due_day ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${settings.remind_on_due_day ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">First reminder (days overdue)</p>
                <Input type="number" min="1" value={settings.first_reminder_days_after}
                  onChange={e => setSettings(s => ({ ...s, first_reminder_days_after: e.target.value }))} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1.5">Repeat every (days)</p>
                <Input type="number" min="1" value={settings.repeat_interval_days}
                  onChange={e => setSettings(s => ({ ...s, repeat_interval_days: e.target.value }))} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Business name (shown in SMS)</p>
              <Input value={settings.business_name}
                onChange={e => setSettings(s => ({ ...s, business_name: e.target.value }))} />
            </div>
            <Button className="w-full" disabled={saving} onClick={handleSave}>
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const HELP = [
  {
    title: 'Adding an Asset',
    adminOnly: true,
    body: 'Go to Settings and tap Asset Manager, then hit Add Asset in the top right. Pick the type, choose an icon, give it a label (e.g. BIN-04), and add a size if it applies. Hit Save and it\'ll show up in Inventory.',
  },
  {
    title: 'Deploying an Asset',
    body: 'Go to Inventory, find the asset, tap Deploy. Type the address and pick it from the suggestions — this pins it on the map. Fill in the customer name, phone, and an expected pickup date if you have one.',
  },
  {
    title: 'Picking Up an Asset',
    body: 'Tap any active pin on the map or find the asset in Inventory. Tap the card to open it, then hit Pick Up. You can add pickup notes before confirming.',
  },
  {
    title: 'Reservations',
    adminOnly: true,
    body: 'Open an asset from Inventory and tap Reserve. Set the date, customer info, and address. A banner will appear on the day the reservation starts if the asset hasn\'t been deployed yet.',
  },
  {
    title: 'Calendar',
    adminOnly: true,
    body: 'The Calendar tab is for your own schedule — deliveries, service dates, anything you want. Tap a day to see what\'s on, tap + to add an event. Reservations show up automatically as amber dots.',
  },
  {
    title: 'History',
    adminOnly: true,
    body: 'Every deployment is logged automatically with who deployed it, who picked it up, dates, and any notes. Use the filters to search by asset, customer, or date range.',
  },
  {
    title: 'What Employees Can\'t See',
    adminOnly: true,
    body: 'Employees can view the map, inventory, and history — but they cannot add or edit assets, manage reservations, access the calendar, or see the Settings users list. Only you can create and manage employee accounts.',
  },
]

function HelpSection({ isAdmin }) {
  const [open, setOpen] = useState(null)
  const items = HELP.filter(item => isAdmin || !item.adminOnly)
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Help</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <button key={item.title} onClick={() => setOpen(open === i ? null : i)}
            className="w-full text-left bg-card border rounded-xl px-4 py-3 transition-colors hover:bg-accent">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-muted-foreground text-lg leading-none">{open === i ? '−' : '+'}</span>
            </div>
            {open === i && (
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{item.body}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}


export default function Settings() {
  const { dark, toggle } = useTheme()
  const { supported: pushSupported, permission, subscribed, loading: pushLoading, subscribe, unsubscribe } = usePushNotifications()
  const [testingPush, setTestingPush] = useState(false)

  async function sendTestNotification() {
    setTestingPush(true)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', body: 'Push notifications are working!', url: null, to_self: true }),
    }).catch(() => {})
    setTestingPush(false)
  }
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fontSize') ?? 'md')

  function applyFontSize(size) {
    const map = { sm: '14px', md: '16px', lg: '18px', xl: '20px' }
    document.documentElement.style.fontSize = map[size]
    localStorage.setItem('fontSize', size)
    setFontSize(size)
  }
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [showAddType, setShowAddType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('box')
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [sendingFeedback, setSendingFeedback] = useState(false)

  useEffect(() => { applyFontSize(fontSize) }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return
      setCurrentUser(session.user)
      setIsAdmin(isAdminUser(session.user))
    })
  }, [])

  async function handleSignOut() {
    if (subscribed) await unsubscribe()
    await supabase.auth.signOut()
  }

  async function addType() {
    if (!newTypeName.trim()) return
    await supabase.from('asset_types').insert({ name: newTypeName.trim(), icon: newTypeIcon })
    setNewTypeName('')
    setNewTypeIcon('box')
    setShowAddType(false)
  }


  async function handleFeedback() {
    if (!feedbackMsg.trim()) return
    setSendingFeedback(true)
    await supabase.from('feedback').insert({
      message: feedbackMsg.trim(),
      user_email: currentUser?.email ?? null,
      user_name: currentUser?.user_metadata?.full_name ?? null,
    })
    setSendingFeedback(false)
    setFeedbackSent(true)
    setFeedbackMsg('')
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-6">

        {isAdmin && <UsersPanel />}

        {isAdmin && <BillingSettingsPanel />}

        {isAdmin && <SmsSettingsPanel />}

        <HelpSection isAdmin={isAdmin} />

        <div className="space-y-2 pt-2">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Text Size</p>
            <div className="flex rounded-lg border overflow-hidden">
              {[{ key: 'sm', label: 'A', size: 'text-xs' }, { key: 'md', label: 'A', size: 'text-sm' }, { key: 'lg', label: 'A', size: 'text-base' }, { key: 'xl', label: 'A', size: 'text-lg' }].map(({ key, label, size }) => (
                <button key={key} onClick={() => applyFontSize(key)}
                  className={`flex-1 py-2 flex items-center justify-center transition-colors ${fontSize === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  <span className={size}>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={toggle}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? 'Light Mode' : 'Dark Mode'}
          </Button>
          {pushSupported && permission !== 'denied' && (
            <>
              <Button
                variant="outline"
                className="w-full"
                onClick={subscribed ? unsubscribe : subscribe}
                disabled={pushLoading}
              >
                {subscribed ? <BellOff size={16} /> : <Bell size={16} />}
                {pushLoading ? '…' : subscribed ? 'Disable Notifications' : 'Enable Notifications'}
              </Button>
              {subscribed && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={sendTestNotification}
                  disabled={testingPush}
                >
                  <Bell size={16} />
                  {testingPush ? 'Sending…' : 'Test Notifications'}
                </Button>
              )}
            </>
          )}
          <Button variant="outline" className="w-full" onClick={() => setShowFeedback(true)}>
            <MessageSquare size={16} />
            Send Feedback
          </Button>
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={handleSignOut}>
            <LogOut size={16} />
            Sign Out
          </Button>
          {currentUser && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              Signed in as {currentUser.user_metadata?.full_name ? `${currentUser.user_metadata.full_name} (${currentUser.email})` : currentUser.email}
            </p>
          )}
        </div>

      </div>

      <Dialog open={showFeedback} onOpenChange={v => { setShowFeedback(v); if (!v) { setFeedbackSent(false); setFeedbackMsg('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Send Feedback</DialogTitle></DialogHeader>
          {feedbackSent ? (
            <div className="py-4 text-center space-y-2">
              <p className="font-medium">Thanks for the feedback!</p>
              <Button className="w-full mt-2" onClick={() => setShowFeedback(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              <Textarea
                placeholder="What's on your mind? Bugs, suggestions, anything…"
                value={feedbackMsg}
                onChange={e => setFeedbackMsg(e.target.value)}
                rows={4}
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowFeedback(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleFeedback} disabled={sendingFeedback || !feedbackMsg.trim()}>
                  {sendingFeedback ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAddType} onOpenChange={setShowAddType}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Asset Type</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <Input
              placeholder="Type name…"
              value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addType())}
              autoFocus
            />
            <div>
              <p className="text-sm text-muted-foreground mb-2">Icon</p>
              <div className="grid grid-cols-6 gap-1">
                {ICON_OPTIONS.map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setNewTypeIcon(key)} title={label}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${newTypeIcon === key ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-accent'}`}>
                    <img src={iconImgUrl(key)} width="20" height="20" alt={label} />
                    <span className="text-[9px] text-muted-foreground leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddType(false)}>Cancel</Button>
              <Button className="flex-1" onClick={addType} disabled={!newTypeName.trim()}>Add Type</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
