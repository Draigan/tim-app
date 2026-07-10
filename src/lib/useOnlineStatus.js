import { useEffect, useState } from 'react'

function browserIsOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(browserIsOnline)

  useEffect(() => {
    const update = () => setOnline(browserIsOnline())

    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}
