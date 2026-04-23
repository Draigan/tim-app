import { NavLink } from 'react-router-dom'
import { Map, Package, History, Settings, CalendarDays, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/lib/useIsAdmin'

export default function BottomNav() {
  const isAdmin = useIsAdmin()

  const navItems = [
    { to: '/', icon: Map, label: 'Map' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    ...(isAdmin
      ? [
          { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
          { to: '/history', icon: History, label: 'History' },
        ]
      : [{ to: '/notifications', icon: Bell, label: 'Notifications' }]
    ),
    { to: '/settings', icon: Settings, label: 'Settings' },
  ]

  return (
    <nav className="border-t bg-background flex flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {navItems.map(({ to, icon: Icon, label }) => (
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
          <Icon size={22} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
