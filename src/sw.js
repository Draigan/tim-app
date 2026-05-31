import { clientsClaim, skipWaiting } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'

skipWaiting()
clientsClaim()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  const targetUrl = data.url ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const alreadyThere = data.url && windowClients.some(c =>
        c.visibilityState === 'visible' && new URL(c.url).pathname === targetUrl
      )
      if (alreadyThere) return
      return self.registration.showNotification(data.title ?? 'Timberfell', {
        body: data.body ?? '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: targetUrl },
      })
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const url = event.notification.data?.url ?? '/'
      const match = list.find(c => 'focus' in c)
      return match ? match.focus() : clients.openWindow(url)
    })
  )
})
