import { NavLink, useLocation } from 'react-router-dom'
import { Map, Package, History, Settings, CalendarDays, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/lib/useIsAdmin'
import { useUnreadChat } from '@/lib/useUnreadChat'

export default function BottomNav() {
  const isAdmin = useIsAdmin()
  const { pathname } = useLocation()
  const unreadChat = useUnreadChat(pathname === '/chat')

  const navItems = [
    { to: '/', icon: Map, label: 'Map' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    ...(isAdmin ? [{ to: '/calendar', icon: CalendarDays, label: 'Calendar' }] : []),
    { to: '/chat', icon: MessageCircle, label: 'Chat', badge: unreadChat },
    ...(isAdmin ? [{ to: '/history', icon: History, label: 'History' }] : []),
    { to: '/settings', icon: Settings, label: 'Settings' },
  ]

  return (
    <nav className="border-t bg-background flex flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {navItems.map(({ to, icon: Icon, label, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex-1 flex flex-col items-center gap-1.5 py-4 text-xs transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )
          }
        >
          <div className="relative">
            <Icon size={22} />
            {badge && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full" />
            )}
          </div>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
