import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/Layout'
import { ThemeProvider } from '@/lib/theme'
import Login from '@/pages/Login'
import MapView from '@/pages/MapView'
import Inventory from '@/pages/Inventory'
import NewAsset from '@/pages/NewAsset'
import AssetDetail from '@/pages/AssetDetail'
import DeployAsset from '@/pages/DeployAsset'
import Settings from '@/pages/Settings'
import History from '@/pages/History'
import Chat from '@/pages/Chat'
import Calendar from '@/pages/Calendar'
import AssetManager from '@/pages/AssetManager'
import Storage from '@/pages/Storage'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [needsPassword, setNeedsPassword] = useState(
    () => sessionStorage.getItem('pendingInvite') === '1'
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_IN') window.history.replaceState(null, '', '/')
      if (event === 'USER_UPDATED') { sessionStorage.removeItem('pendingInvite'); setNeedsPassword(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div style={{ height: '100dvh', background: 'var(--color-background)' }} />

  if (needsPassword) return <ThemeProvider><Login onPasswordSet={() => setNeedsPassword(false)} /></ThemeProvider>

  if (!session) return <ThemeProvider><Login /></ThemeProvider>

  return (
    <ThemeProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MapView />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/assets/new" element={<NewAsset />} />
          <Route path="/assets/:id" element={<AssetDetail />} />
          <Route path="/deploy/:assetId" element={<DeployAsset />} />
          <Route path="/history" element={<History />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/asset-manager" element={<AssetManager />} />
          <Route path="/storage" element={<Storage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  )
}
