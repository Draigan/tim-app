import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Map, Package, Settings, Warehouse, MoreHorizontal, Users, CalendarDays, LayoutGrid, History, ChevronRight, Star } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/lib/useIsAdmin'

const MORE_ITEMS = [
  { to: '/calendar',       icon: CalendarDays, label: 'Calendar',        description: 'Schedule and reservations' },
  { to: '/asset-manager',  icon: LayoutGrid,   label: 'Asset Manager',   description: 'Add and configure assets' },
  { to: '/history',        icon: History,      label: 'History',         description: 'Deployment history' },
  { to: '/review-request', icon: Star,         label: 'Review Request',  description: 'Send a review request by SMS' },
  { to: '/settings',       icon: Settings,     label: 'Settings',        description: 'Users, notifications, help' },
]

function MoreSheet({ open, onClose }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  function go(to) {
    onClose()
    navigate(to)
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="pb-8">
        <div className="pt-2 pb-1">
          <div className="space-y-1">
            {MORE_ITEMS.map(({ to, icon: Icon, label, description }) => (
              <button
                key={to}
                onClick={() => go(to)}
                className={cn(
                  'w-full flex items-center gap-4 px-2 py-3 rounded-xl transition-colors hover:bg-accent',
                  pathname === to && 'text-primary'
                )}
              >
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                  pathname === to ? 'bg-primary/15' : 'bg-muted'
                )}>
                  <Icon size={20} className={pathname === to ? 'text-primary' : 'text-foreground'} />
                </div>
                <div className="flex-1 text-left">
                  <p className={cn('text-sm font-medium', pathname === to && 'text-primary')}>{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default function BottomNav() {
  const isAdmin = useIsAdmin()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const moreActive = MORE_ITEMS.some(item => item.to === pathname)

  const navItems = [
    { to: '/', icon: Map, label: 'Map' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    ...(isAdmin ? [{ to: '/storage', icon: Warehouse, label: 'Storage' }] : []),
    { to: '/customers', icon: Users, label: 'Customers' },
    ...(!isAdmin ? [{ to: '/settings', icon: Settings, label: 'Settings' }] : []),
  ]

  return (
    <>
      <nav className="border-t bg-background flex flex-shrink-0 select-none" style={{ paddingBottom: '4px' }}>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex-1 flex flex-col items-center gap-0.5 pt-3 pb-0 text-xs transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} className={isActive ? 'drop-shadow-[0_0_8px_rgba(74,222,128,0.9)]' : ''} />
                {label}
              </>
            )}
          </NavLink>
        ))}

        {isAdmin && (
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 pt-3 pb-0 text-xs transition-colors',
              moreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MoreHorizontal size={22} className={moreActive ? 'drop-shadow-[0_0_8px_rgba(74,222,128,0.9)]' : ''} />
            More
          </button>
        )}
      </nav>

      {isAdmin && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />}
    </>
  )
}
