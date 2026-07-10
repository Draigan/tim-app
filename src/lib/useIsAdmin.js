import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { isOwner } from './authz'

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let mounted = true
    const applySession = session => {
      if (mounted) setIsAdmin(isOwner(session?.user))
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
  return isAdmin
}
