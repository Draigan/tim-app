import { useState, useEffect } from 'react'
import { callFunction } from './functions'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

async function pushFetch(body) {
  // Storing a subscription is an upsert, so a repeat after a dropped connection
  // costs nothing and saves the user from silently losing notifications.
  return callFunction('push-subscribe', { body, attempts: 2 })
}

export function usePushNotifications() {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  const [permission, setPermission] = useState(() => supported ? Notification.permission : 'denied')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!supported || !VAPID_PUBLIC_KEY) return
    navigator.serviceWorker.ready.then(async reg => {
      let sub = await reg.pushManager.getSubscription()
      if (!sub && Notification.permission === 'granted') {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }).catch(() => null)
      }
      if (sub) {
        setSubscribed(true)
        pushFetch({ action: 'subscribe', subscription: sub.toJSON() }).catch(() => {})
      }
    })
  }, [supported])

  async function subscribe() {
    if (!supported || !VAPID_PUBLIC_KEY) return
    setLoading(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      await pushFetch({ action: 'subscribe', subscription: sub.toJSON() })
      setSubscribed(true)
    } finally {
      setLoading(false)
    }
  }

  async function unsubscribe() {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await pushFetch({ action: 'unsubscribe', subscription: sub.toJSON() })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } finally {
      setLoading(false)
    }
  }

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}
