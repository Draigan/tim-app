import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { getMarkerColor, formatPhone } from '@/lib/utils'
import { Phone, MapPin, Calendar, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function expiryBadge(expiresAt) {
  if (!expiresAt) return { label: 'No expiry set', variant: 'secondary' }
  const daysLeft = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return { label: 'Expired', variant: 'destructive' }
  if (daysLeft === 0) return { label: 'Expires today', variant: 'destructive' }
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, variant: 'warning' }
  return { label: `${daysLeft}d left`, variant: 'success' }
}

export default function AssetBottomSheet({ deployment, onClose, onPickup }) {
  const navigate = useNavigate()

  async function handlePickup() {
    await supabase
      .from('deployments')
      .update({ picked_up_at: new Date().toISOString() })
      .eq('id', deployment.id)
    onPickup()
  }

  const badge = deployment ? expiryBadge(deployment.expires_at) : null

  return (
    <Sheet open={!!deployment} onOpenChange={open => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto pb-8">
        {deployment && (
          <>
            <SheetHeader className="pr-6">
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getMarkerColor(deployment.expires_at) }}
                />
                <SheetTitle>{deployment.label}</SheetTitle>
                <span className="text-muted-foreground text-sm">{deployment.type_name}</span>
                {deployment.size && (
                  <span className="text-muted-foreground text-sm">· {deployment.size}</span>
                )}
              </div>
              <Badge variant={badge.variant} className="w-fit mt-1">{badge.label}</Badge>
            </SheetHeader>

            <div className="mt-5 space-y-3">
              <div className="flex items-start gap-3">
                <MapPin size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <span className="text-sm">{deployment.address}</span>
              </div>

              {deployment.customer_name && (
                <div className="flex items-center gap-3">
                  <User size={16} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-sm">{deployment.customer_name}</span>
                </div>
              )}

              {deployment.customer_phone && (
                <a
                  href={`tel:${deployment.customer_phone}`}
                  className="flex items-center gap-3 text-primary"
                >
                  <Phone size={16} className="flex-shrink-0" />
                  <span className="text-sm">{formatPhone(deployment.customer_phone)}</span>
                </a>
              )}

              {deployment.expires_at && (
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-sm">
                    Expires {new Date(deployment.expires_at + 'T00:00:00').toLocaleDateString()}
                  </span>
                </div>
              )}

              {deployment.notes && (
                <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3 mt-2">
                  {deployment.notes}
                </p>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { onClose(); navigate(`/assets/${deployment.asset_id}`) }}
              >
                View Asset
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handlePickup}
              >
                Mark Picked Up
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
