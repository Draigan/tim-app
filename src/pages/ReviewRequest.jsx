import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Star } from 'lucide-react'

const DEFAULT_MESSAGE = "Thanks for choosing Timberfell! We'd love your feedback —"

function deploymentLabel(deployment) {
  const name = deployment.customer_name || 'Unnamed customer'
  const address = deployment.address || 'No address'
  return `${name} - ${address}`
}

export default function ReviewRequest() {
  const [deployments, setDeployments] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [sendState, setSendState] = useState('idle') // idle | sending | sent | error

  useEffect(() => {
    let cancelled = false

    async function fetchDeployments() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('active_deployments')
          .select('id, address, customer_name, customer_phone, dropped_at')
          .not('customer_phone', 'is', null)
          .order('dropped_at', { ascending: false })

        if (error) throw error
        if (cancelled) return

        const rows = data ?? []
        setDeployments(rows)
        setSelectedId(current => current || rows[0]?.id || '')
      } catch (err) {
        console.error('review deployments failed', err)
        if (!cancelled) setDeployments([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDeployments()

    return () => { cancelled = true }
  }, [])

  const selected = useMemo(
    () => deployments.find(deployment => deployment.id === selectedId) ?? null,
    [deployments, selectedId],
  )
  const phone = selected?.customer_phone || ''
  const name = selected?.customer_name || null

  async function handleSend() {
    if (!selected || !phone) return
    setSendState('sending')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-review-request`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          customerName: name,
          deploymentId: selected.id,
        }),
      })
      if (!res.ok) throw new Error()
      setSendState('sent')
      setTimeout(() => {
        setSendState('idle')
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
            <p className="text-xs text-muted-foreground mb-1.5">Deployment</p>
            <Select value={selectedId} onValueChange={setSelectedId} disabled={loading || deployments.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? 'Loading...' : 'Select deployment'} />
              </SelectTrigger>
              <SelectContent>
                {deployments.map(deployment => (
                  <SelectItem key={deployment.id} value={deployment.id}>
                    {deploymentLabel(deployment)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!loading && deployments.length === 0 && (
            <p className="text-sm text-muted-foreground">No active deployments with a customer phone.</p>
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
          disabled={!selected || !phone || sendState !== 'idle'}
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
