import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, LogOut, Sun, Moon, UserX, LogOutIcon, MessageSquare } from 'lucide-react'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'
import { useTheme } from '@/lib/theme'

const ADMIN_EMAILS = ['tim@timberfell.ca']

function validPassword(pw) {
  return pw.length >= 5 && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
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
  const [actionUserId, setActionUserId] = useState(null)
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

  async function handleSignOut(userId) {
    setActionUserId(userId)
    await adminFetch('?action=signout', { method: 'POST', body: JSON.stringify({ userId }) })
    setActionUserId(null)
  }

  async function handleBan(userId, ban) {
    setActionUserId(userId)
    await adminFetch('?action=ban', { method: 'POST', body: JSON.stringify({ userId, ban }) })
    await fetchUsers()
    setActionUserId(null)
  }

  async function handleDelete(userId) {
    setActionUserId(userId)
    await adminFetch('?action=delete', { method: 'POST', body: JSON.stringify({ userId }) })
    setConfirmDeleteUser(null)
    await fetchUsers()
    setActionUserId(null)
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
          <div key={u.id} className={`bg-card border rounded-xl px-4 py-3 ${u.banned ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{u.full_name ?? u.email}</p>
                {u.full_name && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {u.banned ? 'Disabled' : u.last_sign_in_at ? `Last seen ${fmtDate(u.last_sign_in_at)}` : u.confirmed_at ? 'Never signed in' : 'Invite pending'}
                </p>
              </div>
              {!ADMIN_EMAILS.includes(u.email) && (
                <div className="flex gap-1.5 flex-shrink-0">
                  {!u.banned && (
                    <button
                      title="Sign out"
                      disabled={actionUserId === u.id}
                      onClick={() => handleSignOut(u.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    >
                      <LogOutIcon size={15} />
                    </button>
                  )}
                  <button
                    title={u.banned ? 'Re-enable' : 'Disable account'}
                    disabled={actionUserId === u.id}
                    onClick={() => handleBan(u.id, !u.banned)}
                    className={`transition-colors disabled:opacity-40 ${u.banned ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground hover:text-destructive'}`}
                  >
                    <UserX size={15} />
                  </button>
                  <button
                    title="Delete account"
                    disabled={actionUserId === u.id}
                    onClick={() => setConfirmDeleteUser(u)}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
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
              disabled={actionUserId === confirmDeleteUser?.id || deleteConfirmText.trim().toLowerCase() !== (confirmDeleteUser?.full_name ?? confirmDeleteUser?.email ?? '').toLowerCase()}
              onClick={() => handleDelete(confirmDeleteUser.id)}
            >
              {actionUserId === confirmDeleteUser?.id ? 'Deleting…' : 'Delete'}
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
                <Input placeholder="They'll use this to log in" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">Min. 5 characters, 1 uppercase, 1 number</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Confirm Password</p>
                <Input placeholder="Repeat password" value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} />
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

export default function Settings() {
  const { dark, toggle } = useTheme()
  const [types, setTypes] = useState([])
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('box')
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [sendingFeedback, setSendingFeedback] = useState(false)

  const fetchTypes = useCallback(async () => {
    const { data } = await supabase.from('asset_types').select('*').order('name')
    if (data) setTypes(data)
  }, [])

  useRealtime(['asset_types'], fetchTypes)

  useEffect(() => {
    fetchTypes()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return
      setCurrentUser(session.user)
      if (ADMIN_EMAILS.includes(session.user.email)) setIsAdmin(true)
    })
  }, [fetchTypes])

  async function addType() {
    if (!newTypeName.trim()) return
    const { error } = await supabase.from('asset_types').insert({ name: newTypeName.trim(), icon: newTypeIcon })
    if (!error) {
      setNewTypeName('')
      setNewTypeIcon('box')
      setShowAdd(false)
      fetchTypes()
    }
  }

  async function deleteType() {
    setDeletingId(confirmDelete.id)
    await supabase.from('asset_types').delete().eq('id', confirmDelete.id)
    setDeletingId(null)
    setConfirmDelete(null)
    fetchTypes()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
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

        {isAdmin && <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Asset Types
            </h2>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              Add Type
            </Button>
          </div>
          <div className="space-y-2">
            {types.map(type => (
              <div key={type.id} className="flex items-center justify-between bg-card border rounded-xl px-4 py-3">
                {type.icon && <img src={iconImgUrl(type.icon, 18)} width="18" height="18" alt={type.name} />}
                <span className="text-sm font-medium">{type.name}</span>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  onClick={() => setConfirmDelete(type)}
                  disabled={deletingId === type.id}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>}

        <div className="space-y-2 pt-2">
          <Button variant="outline" className="w-full" onClick={toggle}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? 'Light Mode' : 'Dark Mode'}
          </Button>
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

      <Dialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete "{confirmDelete?.name}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">
            This will remove the type permanently. Any assets using it will be unaffected but may lose their type label.
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={deleteType} disabled={!!deletingId}>
              {deletingId ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Asset Type</DialogTitle>
          </DialogHeader>
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
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewTypeIcon(key)}
                    title={label}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${newTypeIcon === key ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-accent'}`}
                  >
                    <img src={iconImgUrl(key)} width="20" height="20" alt={label} />
                    <span className="text-[9px] text-muted-foreground leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button className="flex-1" onClick={addType}>Add Type</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFeedback} onOpenChange={v => { setShowFeedback(v); if (!v) { setFeedbackSent(false); setFeedbackMsg('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
          </DialogHeader>
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
    </div>
  )
}
