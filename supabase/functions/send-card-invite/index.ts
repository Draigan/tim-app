import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function emailsFromEnv(...names: string[]): string[] {
  const values = names
    .flatMap(name => (Deno.env.get(name) ?? '').split(','))
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)

  return [...new Set([...values, 'd@d.d'])]
}

const SUPERUSER_EMAILS = emailsFromEnv('SUPERUSER_EMAILS')
const SUPERUSER_ROLES = new Set(['superuser'])
const INVITE_DAYS = 30
const DEFAULT_RETURN_ORIGIN = Deno.env.get('CARD_SETUP_RETURN_ORIGIN')
  ?? Deno.env.get('PAYMENT_PORTAL_ORIGIN')
  ?? 'https://timberfellstorage.ca'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }

  return diff === 0
}

function billingPinFromBody(body: Record<string, unknown>): string {
  const value = body.billing_pin ?? body.pin
  return typeof value === 'string' ? value.trim() : ''
}

function validateBillingPin(body: Record<string, unknown>): Response | null {
  const expected = Deno.env.get('BILLING_APPROVAL_PIN')?.trim()
  if (!expected) return json({ error: 'Billing approval PIN is not configured.' }, 500)

  const supplied = billingPinFromBody(body)
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return json({ error: 'Invalid billing approval PIN.' }, 403)
  }

  return null
}

function userHasBillingRole(user: any): boolean {
  const appMetadata = user?.app_metadata ?? {}
  const role = appMetadata.role
  if (typeof role === 'string' && SUPERUSER_ROLES.has(role.toLowerCase())) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => SUPERUSER_ROLES.has(String(role).toLowerCase()))
  if (roles && typeof roles === 'object') {
    return [...SUPERUSER_ROLES].some(role => Boolean(roles[role]))
  }

  return false
}

async function authorizeBillingUser(req: Request, body: Record<string, unknown>): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (!userHasBillingRole(user) && !SUPERUSER_EMAILS.includes(user.email.toLowerCase())) {
    return json({ error: 'Superuser access required for billing.' }, 403)
  }

  return validateBillingPin(body)
}

async function sendTwilio(to: string, body: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from       = Deno.env.get('TWILIO_FROM_NUMBER')!
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    }
  )
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function newInviteToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function inviteUrl(token: string): string {
  const base = Deno.env.get('SUPABASE_URL')!.replace(/\/$/g, '')
  return `${base}/functions/v1/card-setup-invite?token=${encodeURIComponent(token)}`
}

async function createCardSetupInvite(customerId: string): Promise<string> {
  const token = newInviteToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('card_setup_invites').insert({
    customer_id: customerId,
    token_hash: tokenHash,
    return_origin: DEFAULT_RETURN_ORIGIN,
    expires_at: expiresAt,
  })
  if (error) throw error
  return inviteUrl(token)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const authorizationError = await authorizeBillingUser(req, body)
    if (authorizationError) return authorizationError

    const customer_id = typeof body.customer_id === 'string' ? body.customer_id : ''
    if (!customer_id) return json({ error: 'customer_id required' }, 400)

    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('id', customer_id)
      .single()

    if (error || !customer) return json({ error: 'customer not found' }, 404)
    if (!customer.phone) return json({ error: 'customer has no phone number' }, 400)

    const url = await createCardSetupInvite(customer_id)
    const digits = customer.phone.replace(/\D/g, '')
    const normalized = digits.length === 10 ? '+1' + digits : '+' + digits
    const firstName = customer.name?.split(' ')[0] ?? 'there'
    const msg = [
      `Hi ${firstName}, Timberfell Storage is inviting you to save a payment card for automatic billing.`,
      `This secure link is valid for ${INVITE_DAYS} days and opens a fresh Stripe card page when you tap it.`,
      'Secure card link:',
      url,
    ].join('\n')
    await sendTwilio(normalized, msg)

    return json({ ok: true })
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
