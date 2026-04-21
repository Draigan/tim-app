import { StrictMode, useEffect } from 'react'

const fontSizeMap = { sm: '14px', md: '16px', lg: '18px', xl: '20px' }
const savedSize = localStorage.getItem('fontSize') ?? 'md'
document.documentElement.style.fontSize = fontSizeMap[savedSize]
import { createRoot } from 'react-dom/client'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './index.css'
import App from './App.jsx'

function ServiceWorkerUpdater() {
  useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => registration.update(), 5 * 60_000)
      }
    },
    onNeedRefresh() {
      window.location.reload()
    },
  })

  // On iOS the interval freezes when backgrounded — force a check on every resume.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const reg = await navigator.serviceWorker?.getRegistration()
        if (reg) await reg.update()
      } catch (_) {}
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  return null
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ServiceWorkerUpdater />
    <App />
  </StrictMode>,
)
