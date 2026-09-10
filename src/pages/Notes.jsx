import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'

function fmtDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function noteMeta(note) {
  const who = note.author_email ? note.author_email.split('@')[0] : ''
  const when = fmtDate(note.updated_at)
  const edited = note.updated_at !== note.created_at ? 'edited ' : ''
  return [who, when && `${edited}${when}`].filter(Boolean).join(' / ')
}

async function loadNotes() {
  const { data, error } = await supabase
    .from('app_notes')
    .select('id, title, body, author_email, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

function NoteCard({ note, editing, draft, saving, onDraftChange, onStartEdit, onCancelEdit, onSave, onRequestDelete }) {
  if (editing) {
    return (
      <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
        <Input
          value={draft.title}
          onChange={event => onDraftChange({ ...draft, title: event.target.value })}
          placeholder="Title (optional)"
          maxLength={160}
        />
        <Textarea
          value={draft.body}
          onChange={event => onDraftChange({ ...draft, body: event.target.value })}
          placeholder="Note..."
          className="min-h-[120px]"
        />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancelEdit} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={onSave}
            disabled={saving || (!draft.title.trim() && !draft.body.trim())}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {note.title && <p className="text-sm font-semibold break-words">{note.title}</p>}
          <p className="text-xs text-muted-foreground">{noteMeta(note)}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onStartEdit(note)} aria-label="Edit note">
            <Pencil size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRequestDelete(note)}
            aria-label="Delete note"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      {note.body && <p className="text-sm whitespace-pre-wrap break-words">{note.body}</p>}
    </div>
  )
}

export default function Notes() {
  const navigate = useNavigate()
  const [notes, setNotes] = useState([])
  const [query, setQuery] = useState('')
  const [newNote, setNewNote] = useState({ title: '', body: '' })
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ title: '', body: '' })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setNotes(await loadNotes())
      setError('')
    } catch (err) {
      console.error('notes error:', err)
      setError(getErrorMessage(err, 'Could not load notes.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    loadNotes()
      .then(rows => {
        if (cancelled) return
        setNotes(rows)
        setError('')
      })
      .catch(err => {
        if (cancelled) return
        console.error('notes error:', err)
        setError(getErrorMessage(err, 'Could not load notes.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])
  useRealtime(['app_notes'], load)

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(note => [note.title, note.body, note.author_email]
      .some(value => value?.toLowerCase().includes(q)))
  }, [notes, query])

  async function addNote() {
    const title = newNote.title.trim()
    const body = newNote.body.trim()
    if (!title && !body) return

    setAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error: addError } = await supabase.from('app_notes').insert({
      title,
      body,
      created_by: user?.id ?? null,
      author_email: user?.email ?? null,
    })
    setAdding(false)

    if (addError) {
      setError(getErrorMessage(addError, 'Could not save the note.'))
      return
    }
    setNewNote({ title: '', body: '' })
    load()
  }

  function startEdit(note) {
    setError('')
    setEditingId(note.id)
    setEditDraft({ title: note.title ?? '', body: note.body ?? '' })
  }

  async function saveEdit() {
    const title = editDraft.title.trim()
    const body = editDraft.body.trim()
    if (!title && !body) return

    setSavingId(editingId)
    const { error: saveError } = await supabase
      .from('app_notes')
      .update({ title, body, updated_at: new Date().toISOString() })
      .eq('id', editingId)
    setSavingId(null)

    if (saveError) {
      setError(getErrorMessage(saveError, 'Could not save the note.'))
      return
    }
    setEditingId(null)
    load()
  }

  async function deleteNote(note) {
    if (!note || deletingId) return
    setDeletingId(note.id)
    const { error: deleteError } = await supabase.from('app_notes').delete().eq('id', note.id)
    setDeletingId(null)

    if (deleteError) {
      setError(getErrorMessage(deleteError, 'Could not delete the note.'))
      return
    }
    setConfirmDelete(null)
    setNotes(prev => prev.filter(item => item.id !== note.id))
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold leading-tight">Notes</h1>
          <p className="text-xs text-muted-foreground">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </p>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
          <Input
            value={newNote.title}
            onChange={event => setNewNote(prev => ({ ...prev, title: event.target.value }))}
            placeholder="Title (optional)"
            maxLength={160}
          />
          <Textarea
            value={newNote.body}
            onChange={event => setNewNote(prev => ({ ...prev, body: event.target.value }))}
            placeholder="Write a note..."
            className="min-h-[92px]"
          />
          <Button
            onClick={addNote}
            disabled={adding || (!newNote.title.trim() && !newNote.body.trim())}
            className="w-full gap-1.5"
          >
            <Plus size={15} />
            {adding ? 'Adding...' : 'Add note'}
          </Button>
        </div>

        {notes.length > 0 && (
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search notes..."
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : filteredNotes.length > 0 ? (
          <div className="space-y-3">
            {filteredNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                editing={editingId === note.id}
                draft={editDraft}
                saving={savingId === note.id}
                onDraftChange={setEditDraft}
                onStartEdit={startEdit}
                onCancelEdit={() => setEditingId(null)}
                onSave={saveEdit}
                onRequestDelete={note => { setError(''); setConfirmDelete(note) }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            <StickyNote size={20} className="mx-auto mb-2 opacity-60" />
            {notes.length === 0 ? 'No notes yet. Add the first one above.' : 'No notes match that search.'}
          </div>
        )}
      </main>

      <Dialog
        open={!!confirmDelete}
        onOpenChange={open => { if (!open && !deletingId) setConfirmDelete(null) }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmDelete?.title
              ? `"${confirmDelete.title}" is deleted for everyone. This cannot be undone.`
              : 'This note is deleted for everyone. This cannot be undone.'}
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" disabled={!!deletingId} onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deletingId === confirmDelete?.id}
              onClick={() => deleteNote(confirmDelete)}
            >
              {deletingId === confirmDelete?.id ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
