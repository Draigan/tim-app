import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import MapView from '@/pages/MapView'
import Inventory from '@/pages/Inventory'
import NewAsset from '@/pages/NewAsset'
import AssetDetail from '@/pages/AssetDetail'
import DeployAsset from '@/pages/DeployAsset'
import Settings from '@/pages/Settings'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null

  if (!session) return <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MapView />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/assets/new" element={<NewAsset />} />
          <Route path="/assets/:id" element={<AssetDetail />} />
          <Route path="/deploy/:assetId" element={<DeployAsset />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
