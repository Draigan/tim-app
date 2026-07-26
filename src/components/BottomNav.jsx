import { createElement, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Map, Package, Settings, Warehouse, MoreHorizontal, Users, CalendarDays, LayoutGrid, History, ChevronRight, Star, ReceiptText, Bell, Mic, BadgeCheck } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAccess } from '@/lib/useAccess'
import { useNotificationUnreadCount } from '@/lib/useNotificationUnreadCount'

const MORE_ITEMS = [
  { to: '/notifications',   icon: Bell,         label: 'Notifications',   description: 'Bookings, payments, alerts', access: 'canViewNotifications' },
  { to: '/voice-deploy',     icon: Mic,          label: 'Voice Deploy',     description: 'Deploy an asset by voice', access: 'canUseVoiceDeploy' },
  { to: '/calendar',        icon: CalendarDays, label: 'Calendar',        description: 'Schedule and reservations', access: 'canManageCalendar' },
  { to: '/asset-manager',   icon: LayoutGrid,   label: 'Asset Manager',   description: 'Add and configure assets', access: 'canManageAssets' },
  { to: '/verifier',        icon: BadgeCheck,   label: 'Verifier',        description: 'Check off bins you actually see', access: 'canManageAssets' },
  { to: '/history',         icon: History,      label: 'History',         description: 'Deployment history', access: 'canViewHistory' },
  { to: '/online-payments', icon: ReceiptText,  label: 'Online Payments', description: 'Tax collected payments', access: 'canManageRevenue' },
  { to: '/admin-revenue',   icon: ReceiptText,  label: 'Admin Revenue',   description: 'Revenue tracker', access: 'canManageRevenue' },
  { to: '/review-request',  icon: Star,         label: 'Review Request',  description: 'Send a review request by SMS', access: 'canRequestReviews' },
  { to: '/settings',        icon: Settings,     label: 'Settings',        description: 'Users, notifications, help', access: 'canUseApp' },
]

function MoreSheet({ open, onClose, items, unreadCount }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  function go(to) {
    onClose()
    navigate(to)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={v => !v && onClose()}>
        <SheetContent side="bottom" className="pb-8">
          <div className="pt-2 pb-1">
            <div className="space-y-1">
              {items.map(item => (
                <button
                  key={item.to}
                  onClick={() => go(item.to)}
                  className={cn(
                    'w-full flex items-center gap-4 px-2 py-3 rounded-xl transition-colors hover:bg-accent',
                    pathname === item.to && 'text-primary'
                  )}
                >
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    pathname === item.to ? 'bg-primary/15' : 'bg-muted'
                  )}>
                    {createElement(item.icon, {
                      size: 20,
                      className: pathname === item.to ? 'text-primary' : 'text-foreground',
                    })}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-medium', pathname === item.to && 'text-primary')}>{item.label}</p>
                      {item.to === '/notifications' && unreadCount > 0 && (
                        <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default function BottomNav() {
  const access = useAccess()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const unreadCount = useNotificationUnreadCount(access.canViewNotifications)
  const moreItems = MORE_ITEMS.filter(item => access[item.access])

  const moreActive = moreItems.some(item => item.to === pathname)

  const navItems = [
    { to: '/', icon: Map, label: 'Map' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    ...(access.canViewStorage ? [{ to: '/storage', icon: Warehouse, label: 'Storage' }] : []),
    { to: '/customers', icon: Users, label: 'Customers' },
  ]

  return (
    <>
      <nav className="border-t bg-background flex flex-shrink-0 select-none" style={{ paddingBottom: '4px' }}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex-1 flex flex-col items-center gap-0.5 pt-3 pb-0 text-xs transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                {createElement(item.icon, {
                  size: 22,
                  className: isActive ? 'drop-shadow-[0_0_8px_rgba(74,222,128,0.9)]' : '',
                })}
                {item.label}
              </>
            )}
          </NavLink>
        ))}

        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              'relative flex-1 flex flex-col items-center gap-0.5 pt-3 pb-0 text-xs transition-colors',
              moreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {unreadCount > 0 && (
              <span className="absolute top-2 right-[calc(50%-18px)] min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-semibold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
            <MoreHorizontal size={22} className={moreActive ? 'drop-shadow-[0_0_8px_rgba(74,222,128,0.9)]' : ''} />
            More
          </button>
        )}
      </nav>

      {moreItems.length > 0 && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} unreadCount={unreadCount} />}
    </>
  )
}
