import { NavLink, useLocation } from 'react-router-dom'
import { Map, Package, Settings, CalendarDays, Warehouse } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/lib/useIsAdmin'

export default function BottomNav() {
  const isAdmin = useIsAdmin()
  const { pathname } = useLocation()

  const navItems = [
    { to: '/', icon: Map, label: 'Map' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    ...(isAdmin ? [{ to: '/calendar', icon: CalendarDays, label: 'Calendar' }] : []),
    ...(isAdmin ? [{ to: '/storage', icon: Warehouse, label: 'Storage' }] : []),
    { to: '/settings', icon: Settings, label: 'Settings' },
  ]

  return (
    <nav className="border-t bg-background flex flex-shrink-0" style={{ paddingBottom: '4px' }}>
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
    </nav>
  )
}
