import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { getUserAccess } from './authz'

export function useAccess() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    function applySession(session) {
      if (!mounted) return
      setUser(session?.user ?? null)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return useMemo(() => ({
    loading,
    user,
    ...getUserAccess(user),
  }), [loading, user])
}
