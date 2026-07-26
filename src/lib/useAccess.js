import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { getUserAccess } from './authz'
import { VOICE_TRIAL_EVENT } from './voiceTrial'

export function useAccess() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [trialTick, setTrialTick] = useState(0)

  useEffect(() => {
    function bump() { setTrialTick(t => t + 1) }
    window.addEventListener(VOICE_TRIAL_EVENT, bump)
    return () => window.removeEventListener(VOICE_TRIAL_EVENT, bump)
  }, [])

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

  return useMemo(() => {
    void trialTick // access depends on trial state, which changes outside React
    return {
      loading,
      user,
      ...getUserAccess(user),
    }
  }, [loading, user, trialTick])
}
