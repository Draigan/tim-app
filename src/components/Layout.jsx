import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  const { pathname } = useLocation()
  const showLogo = pathname !== '/'

  return (
    <div className="flex flex-col h-full">
      {showLogo && (
        <div className="flex items-center px-4 pt-3 pb-1 border-b bg-background flex-shrink-0">
          <img src="/logo.webp" alt="Timberfell" className="h-8 w-auto logo-invert" />
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
