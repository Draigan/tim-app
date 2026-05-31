import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Star } from 'lucide-react'
import CustomerPicker from '@/components/CustomerPicker'

const DEFAULT_MESSAGE = "Thanks for choosing Timberfell! We'd love your feedback —"

export default function ReviewRequest() {
  const [customer, setCustomer] = useState(null)
  const [manualPhone, setManualPhone] = useState('')
  const [sendState, setSendState] = useState('idle') // idle | sending | sent | error

  const phone = customer?.phone || manualPhone.trim()
  const name = customer?.name || null

  async function handleSend() {
    if (!phone) return
    setSendState('sending')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-review-request`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, customerName: name }),
      })
      if (!res.ok) throw new Error()
      setSendState('sent')
      setTimeout(() => {
        setSendState('idle')
        setCustomer(null)
        setManualPhone('')
      }, 3000)
    } catch {
      setSendState('error')
      setTimeout(() => setSendState('idle'), 3000)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Review Request</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Customer</p>
            <CustomerPicker
              value={customer}
              onChange={c => { setCustomer(c); setManualPhone('') }}
            />
          </div>

          {!customer && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Or enter a phone number</p>
              <Input
                type="tel"
                placeholder="(705) 555-0100"
                value={manualPhone}
                onChange={e => setManualPhone(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-muted/50 p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Message preview</p>
          <p className="text-sm text-muted-foreground">
            Hi{name ? ` ${name}` : ''}! {DEFAULT_MESSAGE} [review link]
          </p>
        </div>

        <Button
          className="w-full gap-2"
          disabled={!phone || sendState !== 'idle'}
          onClick={handleSend}
        >
          <Star size={15} />
          {sendState === 'sending' ? 'Sending…'
            : sendState === 'sent' ? 'Sent!'
            : sendState === 'error' ? 'Failed — try again'
            : 'Send Review Request'}
        </Button>
      </div>
    </div>
  )
}
