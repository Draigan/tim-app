import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function emailsFromEnv(...names: string[]): string[] {
  const values = names
    .flatMap(name => (Deno.env.get(name) ?? '').split(','))
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(values.length ? values : ['d@d.d'])]
}

const SUPERUSER_EMAILS = emailsFromEnv('SUPERUSER_EMAILS')
const OWNER_EMAILS = ['tim@timberfell.ca']
const DRIVER_EMAILS = ['beau@timberfell.ca']
const ASSIGNABLE_ROLES = new Set(['owner', 'driver'])
const ROLE_LABELS: Record<string, string> = {
  superuser: 'Superuser',
  owner: 'Owner',
  driver: 'Driver',
}
const PASSWORD_MIN_LENGTH = 12
const GENERATED_PASSWORD_LENGTH = 20
const PASSWORD_CHARSETS = {
  lower: 'abcdefghjkmnpqrstuvwxyz',
  upper: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  number: '23456789',
  symbol: '!#%+?@_',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function userHasAnyRole(user: any, allowedRoles: Set<string>): boolean {
  const appMetadata = user?.app_metadata ?? {}
  const role = appMetadata.role
  if (typeof role === 'string' && allowedRoles.has(role.toLowerCase())) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => allowedRoles.has(String(role).toLowerCase()))
  if (roles && typeof roles === 'object') {
    return [...allowedRoles].some(role => Boolean(roles[role]))
  }

  return false
}

function normalizedEmail(userOrEmail: any): string {
  const email = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail?.email
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

function protectedSuperuserEmail(userOrEmail: any): boolean {
  return SUPERUSER_EMAILS.includes(normalizedEmail(userOrEmail))
}

function userRole(user: any): string | null {
  if (protectedSuperuserEmail(user)) return 'superuser'

  const rawRole = user?.app_metadata?.role
  const role = typeof rawRole === 'string' ? rawRole.toLowerCase() : null
  if (role && (role === 'superuser' || ASSIGNABLE_ROLES.has(role))) return role
  if (role === 'admin' || role === 'billing' || role === 'billing_admin') return 'owner'
  if (role === 'staff') return 'driver'

  if (userHasAnyRole(user, new Set(['superuser']))) return 'superuser'
  if (userHasAnyRole(user, new Set(['owner', 'admin', 'billing', 'billing_admin']))) return 'owner'
  if (userHasAnyRole(user, new Set(['driver', 'staff']))) return 'driver'

  const email = normalizedEmail(user)
  if (OWNER_EMAILS.includes(email)) return 'owner'
  if (DRIVER_EMAILS.includes(email)) return 'driver'

  return null
}

function userIsSuperuser(user: any): boolean {
  return userRole(user) === 'superuser'
}

function normalizeAssignableRole(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const role = value.trim().toLowerCase()
  return ASSIGNABLE_ROLES.has(role) ? role : null
}

function passwordPolicyError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Password is required'
  if (value.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  if (!/[a-z]/.test(value)) return 'Password must include a lowercase letter'
  if (!/[A-Z]/.test(value)) return 'Password must include an uppercase letter'
  if (!/[0-9]/.test(value)) return 'Password must include a number'
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include a symbol'
  return null
}

function randomInt(max: number): number {
  const bucketCount = Math.floor(0x100000000 / max) * max
  const value = new Uint32Array(1)
  do {
    crypto.getRandomValues(value)
  } while (value[0] >= bucketCount)
  return value[0] % max
}

function randomChar(charset: string): string {
  return charset[randomInt(charset.length)]
}

function generatePassword(): string {
  const requiredSets = Object.values(PASSWORD_CHARSETS)
  const allChars = requiredSets.join('')
  const chars = requiredSets.map(randomChar)

  while (chars.length < GENERATED_PASSWORD_LENGTH) chars.push(randomChar(allChars))

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}

async function authorizeSuperuser(req: Request): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (userIsSuperuser(user)) return null

  return json({ error: 'Forbidden' }, 403)
}

async function getUsers() {
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  return users
}

async function getTargetUser(userId: unknown) {
  if (typeof userId !== 'string' || !userId) return null
  const users = await getUsers()
  return users.find(user => user.id === userId) ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authorizationError = await authorizeSuperuser(req)
  if (authorizationError) return authorizationError

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (req.method === 'GET') {
    try {
      const users = await getUsers()
      const list = users.map(u => {
        const role = userRole(u)
        return {
          id: u.id,
          email: u.email,
          full_name: u.user_metadata?.full_name ?? null,
          role,
          role_label: role ? ROLE_LABELS[role] ?? role : null,
          protected: protectedSuperuserEmail(u) || role === 'superuser',
          last_sign_in_at: u.last_sign_in_at,
          banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
          invited_at: u.invited_at,
          confirmed_at: u.confirmed_at,
        }
      })
      return json(list)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  }

  if (req.method === 'POST') {
    const body = await req.json()

    if (action === 'create') {
      const newEmail = typeof body.email === 'string' ? body.email.trim() : ''
      const suppliedPassword = typeof body.password === 'string' ? body.password : ''
      const password = suppliedPassword || generatePassword()
      const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
      const role = normalizeAssignableRole(body.role)
      if (!fullName) return json({ error: 'Name is required' }, 400)
      if (!newEmail) return json({ error: 'Email is required' }, 400)
      if (protectedSuperuserEmail(newEmail)) return json({ error: 'The superuser account cannot be created here.' }, 400)
      if (!role) return json({ error: 'Choose owner or driver.' }, 400)
      const passwordError = passwordPolicyError(password)
      if (passwordError) return json({ error: passwordError }, 400)
      const { error } = await supabaseAdmin.auth.admin.createUser({
        email: newEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { role },
      })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, temporaryPassword: password })
    }

    if (action === 'reset_password') {
      const target = await getTargetUser(body.userId)
      if (!target) return json({ error: 'User not found' }, 404)
      if (protectedSuperuserEmail(target) || userRole(target) === 'superuser') {
        return json({ error: 'The superuser password cannot be reset here.' }, 403)
      }

      const suppliedPassword = typeof body.password === 'string' ? body.password : ''
      const password = suppliedPassword || generatePassword()
      const passwordError = passwordPolicyError(password)
      if (passwordError) return json({ error: passwordError }, 400)

      const { error } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
        password,
        email_confirm: true,
      })
      if (error) return json({ error: error.message }, 500)

      return json({ ok: true, temporaryPassword: password })
    }

    if (action === 'update_role') {
      const role = normalizeAssignableRole(body.role)
      if (!role) return json({ error: 'Choose owner or driver.' }, 400)

      const target = await getTargetUser(body.userId)
      if (!target) return json({ error: 'User not found' }, 404)
      if (protectedSuperuserEmail(target) || userRole(target) === 'superuser') {
        return json({ error: 'The superuser role cannot be changed.' }, 403)
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
        app_metadata: { ...(target.app_metadata ?? {}), role },
      })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'signout') {
      return json({ error: 'Signing out another user by user id is not supported.' }, 400)
    }

    if (action === 'ban') {
      const target = await getTargetUser(body.userId)
      if (!target) return json({ error: 'User not found' }, 404)
      if (protectedSuperuserEmail(target) || userRole(target) === 'superuser') {
        return json({ error: 'The superuser account cannot be banned.' }, 403)
      }
      const { ban } = body
      const { error } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
        ban_duration: ban ? '876000h' : 'none',
      })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'delete') {
      const target = await getTargetUser(body.userId)
      if (!target) return json({ error: 'User not found' }, 404)
      if (protectedSuperuserEmail(target) || userRole(target) === 'superuser') {
        return json({ error: 'The superuser account cannot be deleted.' }, 403)
      }
      const { error } = await supabaseAdmin.auth.admin.deleteUser(target.id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
})
