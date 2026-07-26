import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getUserAccess } from '@/lib/authz'
import { VOICE_TRIAL_EVENT } from '@/lib/voiceTrial'
import { Button } from '@/components/ui/button'
import Layout from '@/components/Layout'
import { ThemeProvider } from '@/lib/theme'
import { LogOut } from 'lucide-react'
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
import StorageReadOnly from '@/pages/StorageReadOnly'
import StorageLayout from '@/pages/StorageLayout'
import StorageFloorplan from '@/pages/StorageFloorplan'
import StorageStatistics from '@/pages/StorageStatistics'
import StorageCustomerNotes from '@/pages/StorageCustomerNotes'
import StorageBilling from '@/pages/StorageBilling'
import Customers from '@/pages/Customers'
import ReviewRequest from '@/pages/ReviewRequest'
import AdminRevenue from '@/pages/AdminRevenue'
import OnlinePayments from '@/pages/OnlinePayments'
import Notifications from '@/pages/Notifications'
import VoiceDeploy from '@/pages/VoiceDeploy'
import Verifier from '@/pages/Verifier'

const STORAGE_PUBLIC_ORIGIN = (import.meta.env.VITE_STORAGE_PUBLIC_ORIGIN || 'https://timberfellstorage.ca').replace(/\/+$/, '')
const CUSTOMER_RETURN_PATHS = new Map([
  ['/payment-success', '/payment-success'],
  ['/payment/success', '/payment-success'],
  ['/payment-cancelled', '/payment-cancelled'],
  ['/payment/cancelled', '/payment-cancelled'],
  ['/card-saved', '/card-saved'],
  ['/card-cancelled', '/card-cancelled'],
])

function redirectCustomerReturnPath() {
  if (typeof window === 'undefined') return
  const normalizedPath = window.location.pathname.replace(/\/+$/, '')
  const targetPath = CUSTOMER_RETURN_PATHS.get(normalizedPath)
  if (!targetPath || window.location.origin === STORAGE_PUBLIC_ORIGIN) return
  window.location.replace(`${STORAGE_PUBLIC_ORIGIN}${targetPath}${window.location.search}${window.location.hash}`)
}

function AccessDenied({ roleLabel }) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')

  async function handleSignOut() {
    setError('')
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    if (error) {
      setError(error.message)
      setSigningOut(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {roleLabel ? `${roleLabel} does not have access to this page.` : 'This account does not have an app role yet.'}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" variant="outline" className="w-full" onClick={handleSignOut} disabled={signingOut}>
          <LogOut size={16} />
          {signingOut ? 'Signing out...' : 'Sign out'}
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [needsPassword, setNeedsPassword] = useState(
    () => sessionStorage.getItem('pendingInvite') === '1'
  )

  const [trialTick, setTrialTick] = useState(0)

  useEffect(() => {
    redirectCustomerReturnPath()
  }, [])

  // Accepting the voice trial changes route access, so re-render on it.
  useEffect(() => {
    function bump() { setTrialTick(t => t + 1) }
    window.addEventListener(VOICE_TRIAL_EVENT, bump)
    return () => window.removeEventListener(VOICE_TRIAL_EVENT, bump)
  }, [])

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

  void trialTick
  const access = getUserAccess(session.user)
  const requireAccess = (allowed, element) => allowed ? element : <AccessDenied roleLabel={access.roleLabel} />

  return (
    <ThemeProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={requireAccess(access.canUseApp, <MapView />)} />
          <Route path="/inventory" element={requireAccess(access.canUseApp, <Inventory />)} />
          <Route path="/assets/new" element={requireAccess(access.canManageAssets, <NewAsset />)} />
          <Route path="/assets/:id" element={requireAccess(access.canUseApp, <AssetDetail />)} />
          <Route path="/deploy/:assetId" element={requireAccess(access.canUseApp, <DeployAsset />)} />
          <Route path="/history" element={requireAccess(access.canViewHistory, <History />)} />
          <Route path="/chat" element={requireAccess(access.canUseApp, <Chat />)} />
          <Route path="/calendar" element={requireAccess(access.canManageCalendar, <Calendar />)} />
          <Route path="/settings" element={requireAccess(access.canUseApp, <Settings />)} />
          <Route path="/asset-manager" element={requireAccess(access.canManageAssets, <AssetManager />)} />
          <Route path="/storage" element={requireAccess(access.canViewStorage, access.canManageStorage ? <Storage /> : <StorageReadOnly />)} />
          <Route path="/storage/layout" element={requireAccess(access.canManageStorage, <StorageLayout />)} />
          <Route path="/storage/floorplan" element={requireAccess(access.canManageStorage, <StorageFloorplan />)} />
          <Route path="/storage/statistics" element={requireAccess(access.canManageStorage, <StorageStatistics />)} />
          <Route path="/storage/customer-notes" element={requireAccess(access.canManageStorage, <StorageCustomerNotes />)} />
          <Route path="/storage/portable/:assetId/billing" element={requireAccess(access.canManageStorage, <StorageBilling />)} />
          <Route path="/storage/customer/:tenancyId/billing" element={requireAccess(access.canManageStorage, <StorageBilling />)} />
          <Route path="/storage/:unitId/billing" element={requireAccess(access.canManageStorage, <StorageBilling />)} />
          <Route path="/customers" element={requireAccess(access.canUseApp, <Customers />)} />
          <Route path="/review-request" element={requireAccess(access.canRequestReviews, <ReviewRequest />)} />
          <Route path="/admin-revenue" element={requireAccess(access.canManageRevenue, <AdminRevenue />)} />
          <Route path="/online-payments" element={requireAccess(access.canManageRevenue, <OnlinePayments />)} />
          <Route path="/notifications" element={requireAccess(access.canViewNotifications, <Notifications />)} />
          <Route path="/voice-deploy" element={requireAccess(access.canUseVoiceDeploy, <VoiceDeploy />)} />
          <Route path="/verifier" element={requireAccess(access.canManageAssets, <Verifier />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  )
}
