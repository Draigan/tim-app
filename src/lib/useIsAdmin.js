import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const ADMIN_EMAILS = ['tim@timberfell.ca']

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email && ADMIN_EMAILS.includes(session.user.email)) setIsAdmin(true)
    })
  }, [])
  return isAdmin
}
