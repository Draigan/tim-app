import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, LogOut, Sun, Moon } from 'lucide-react'
import { ICON_OPTIONS, iconImgUrl } from '@/lib/icons'
import { useTheme } from '@/lib/theme'

export default function Settings() {
  const { dark, toggle } = useTheme()
  const [types, setTypes] = useState([])
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('box')
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    fetchTypes()
  }, [])

  async function fetchTypes() {
    const { data } = await supabase.from('asset_types').select('*').order('name')
    if (data) setTypes(data)
  }

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

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-6">
        <div>
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
        </div>

        <div className="space-y-2 pt-2">
          <Button variant="outline" className="w-full" onClick={toggle}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? 'Light Mode' : 'Dark Mode'}
          </Button>
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={handleSignOut}>
            <LogOut size={16} />
            Sign Out
          </Button>
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
    </div>
  )
}
