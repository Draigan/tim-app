import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const ADMIN_EMAILS = ['tim@timberfell.ca']

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function getCallerEmail(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user?.email ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const email = await getCallerEmail(req)
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers: CORS, status: 403 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  if (req.method === 'GET') {
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    if (error) return json({ error: error.message }, 500)
    const list = users.map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.user_metadata?.full_name ?? null,
      last_sign_in_at: u.last_sign_in_at,
      banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
      invited_at: u.invited_at,
      confirmed_at: u.confirmed_at,
    }))
    return json(list)
  }

  if (req.method === 'POST') {
    const body = await req.json()

    if (action === 'create') {
      const { email: newEmail, password, full_name } = body
      if (!full_name?.trim()) return json({ error: 'Name is required' }, 400)
      if (!password || password.length < 4) return json({ error: 'Password must be at least 4 characters' }, 400)
      const { error } = await supabaseAdmin.auth.admin.createUser({
        email: newEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'signout') {
      const { userId } = body
      const { error } = await supabaseAdmin.auth.admin.signOut(userId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'ban') {
      const { userId, ban } = body
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: ban ? '876000h' : 'none',
      })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'delete') {
      const { userId } = body
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
})
