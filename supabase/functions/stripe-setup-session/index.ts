import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })

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
const DEFAULT_APP_ORIGIN = 'https://pvpzpkvgdyjujtelwbbs.supabase.co'
const DEFAULT_CUSTOMER_RETURN_ORIGIN = Deno.env.get('CARD_SETUP_RETURN_ORIGIN')
  ?? Deno.env.get('PAYMENT_PORTAL_ORIGIN')
  ?? 'https://timberfellstorage.ca'
const INVITE_DAYS = 30

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

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

async function authorizeBillingUser(req: Request): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (userHasBillingRole(user) || SUPERUSER_EMAILS.includes(user.email.toLowerCase())) {
    return null
  }

  return json({ error: 'Superuser access required for billing.' }, 403)
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
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

function customerReturnOrigin(): string {
  return normalizeOrigin(DEFAULT_CUSTOMER_RETURN_ORIGIN) ?? 'https://timberfellstorage.ca'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorizationError = await authorizeBillingUser(req)
    if (authorizationError) return authorizationError

    const { customer_id, origin, link_type } = await req.json()
    if (!customer_id) return json({ error: 'customer_id required' }, 400)

    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, email, stripe_customer_id')
      .eq('id', customer_id)
      .single()

    if (error || !customer) return json({ error: 'customer not found' }, 404)

    // Create Stripe customer if one doesn't exist yet
    let stripeCustomerId = customer.stripe_customer_id
    if (!stripeCustomerId) {
      const sc = await stripe.customers.create({
        name: customer.name ?? undefined,
        email: customer.email ?? undefined,
        metadata: { customer_id },
      })
      stripeCustomerId = sc.id
      await supabase.from('customers').update({ stripe_customer_id: stripeCustomerId }).eq('id', customer_id)
    }

    const appOrigin = normalizeOrigin(origin)
      ?? normalizeOrigin(req.headers.get('origin'))
      ?? DEFAULT_APP_ORIGIN

    if (link_type === 'invite') {
      const token = newInviteToken()
      const tokenHash = await sha256Hex(token)
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { error: inviteError } = await supabase.from('card_setup_invites').insert({
        customer_id,
        token_hash: tokenHash,
        return_origin: customerReturnOrigin(),
        expires_at: expiresAt,
      })
      if (inviteError) throw inviteError

      return json({ url: inviteUrl(token), invite_url: inviteUrl(token), expires_at: expiresAt })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: stripeCustomerId,
      currency: 'cad',
      client_reference_id: customer_id,
      setup_intent_data: {
        metadata: { customer_id },
      },
      metadata: { customer_id },
      success_url: `${appOrigin}/customers?card=saved`,
      cancel_url:  `${appOrigin}/customers?card=cancelled`,
    })

    return json({ url: session.url })
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
