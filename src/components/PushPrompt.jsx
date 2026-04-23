import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Bell } from 'lucide-react'
import { usePushNotifications } from '@/lib/usePushNotifications'

export default function PushPrompt() {
  const { supported, permission, subscribe, loading } = usePushNotifications()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!supported) return
    if (permission !== 'default') return
    if (localStorage.getItem('push_prompt_dismissed')) return
    const t = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(t)
  }, [supported, permission])

  function handleEnable() {
    subscribe()
    setOpen(false)
  }

  function handleDismiss() {
    localStorage.setItem('push_prompt_dismissed', '1')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleDismiss() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 rounded-full p-2.5">
              <Bell size={20} className="text-primary" />
            </div>
            <DialogTitle>Stay in the loop</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mt-1">
          Get notified when assets are deployed, picked up, or when the team sends a message — even when the app is closed.
        </p>
        <div className="flex flex-col gap-2 mt-3">
          <Button className="w-full" onClick={handleEnable} disabled={loading}>
            {loading ? 'Enabling…' : 'Enable Notifications'}
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={handleDismiss}>
            Not Now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
