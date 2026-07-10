import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function emailsFromEnv(...names: string[]): string[] {
  const values = names
    .flatMap(name => (Deno.env.get(name) ?? '').split(','))
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(values.length ? values : ['d@d.d', 'tim@timberfell.ca', 'beau@timberfell.ca'])]
}

const STAFF_EMAILS = emailsFromEnv('STAFF_EMAILS', 'STAFF_ADMIN_EMAILS', 'ADMIN_EMAILS')
const STAFF_ROLES = new Set(['superuser', 'owner', 'driver', 'admin', 'staff'])

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function userHasStaffRole(user: any): boolean {
  const appMetadata = user?.app_metadata ?? {}
  const role = appMetadata.role
  if (typeof role === 'string' && STAFF_ROLES.has(role.toLowerCase())) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => STAFF_ROLES.has(String(role).toLowerCase()))
  if (roles && typeof roles === 'object') {
    return [...STAFF_ROLES].some(role => Boolean(roles[role]))
  }

  return false
}

async function authorizeStaffUser(req: Request): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (userHasStaffRole(user) || STAFF_EMAILS.includes(user.email.toLowerCase())) {
    return null
  }

  return json({ error: 'Staff access required for this account.' }, 403)
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')

  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`

  return null
}

function phoneMatches(supplied: string, storedPhones: unknown[]): boolean {
  return storedPhones.some(phone => normalizePhone(phone) === supplied)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorizationError = await authorizeStaffUser(req)
  if (authorizationError) return authorizationError

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const phone = normalizePhone(body.phone)
  const deploymentId = typeof body.deploymentId === 'string' ? body.deploymentId.trim() : ''

  if (!phone) return json({ error: 'phone required' }, 400)
  if (!deploymentId) return json({ error: 'deploymentId required' }, 400)

  const { data: deployment, error: deploymentError } = await supabaseAdmin
    .from('deployments')
    .select('id, customer_name, customer_phone, customer_id, customers(name, phone)')
    .eq('id', deploymentId)
    .maybeSingle()

  if (deploymentError) return json({ error: deploymentError.message }, 500)
  if (!deployment) return json({ error: 'deployment not found' }, 404)

  if (!phoneMatches(phone, [deployment.customer_phone, (deployment.customers as any)?.phone])) {
    return json({ error: 'phone does not match this deployment' }, 403)
  }

  const customerName = deployment.customer_name || (deployment.customers as any)?.name || undefined

  const apiKey = Deno.env.get('REVIEW_API_KEY')
  if (!apiKey) return json({ error: 'Review API not configured' }, 500)

  const res = await fetch('https://dashboard.lodestonesystems.ca/api/external/review-request/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientId: 'timberfell', phone, customerName }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('review API error', res.status, text)
    return json({ error: 'Review API request failed' }, 502)
  }

  await supabaseAdmin
    .from('deployments')
    .update({ review_requested_at: new Date().toISOString() })
    .eq('id', deploymentId)

  return json({ ok: true })
})
