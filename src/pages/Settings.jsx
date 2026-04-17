import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, LogOut } from 'lucide-react'

export default function Settings() {
  const [types, setTypes] = useState([])
  const [newTypeName, setNewTypeName] = useState('')
  const [showAdd, setShowAdd] = useState(false)
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
    const { error } = await supabase.from('asset_types').insert({ name: newTypeName.trim() })
    if (!error) {
      setNewTypeName('')
      setShowAdd(false)
      fetchTypes()
    }
  }

  async function deleteType(id) {
    setDeletingId(id)
    await supabase.from('asset_types').delete().eq('id', id)
    setDeletingId(null)
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
                <span className="text-sm font-medium">{type.name}</span>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  onClick={() => deleteType(type.id)}
                  disabled={deletingId === type.id}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={handleSignOut}>
            <LogOut size={16} />
            Sign Out
          </Button>
        </div>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm mx-4">
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
