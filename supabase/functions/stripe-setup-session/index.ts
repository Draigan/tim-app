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

  return [...new Set(values.length ? values : ['tim@timberfell.ca'])]
}

const BILLING_ADMIN_EMAILS = emailsFromEnv('BILLING_ADMIN_EMAILS', 'ADMIN_EMAILS')
const BILLING_ROLES = new Set(['admin', 'billing', 'billing_admin'])
const DEFAULT_APP_ORIGIN = 'https://pvpzpkvgdyjujtelwbbs.supabase.co'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

function userHasBillingRole(user: any): boolean {
  const appMetadata = user?.app_metadata ?? {}
  const role = appMetadata.role
  if (typeof role === 'string' && BILLING_ROLES.has(role)) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => BILLING_ROLES.has(String(role)))
  if (roles && typeof roles === 'object') {
    return [...BILLING_ROLES].some(role => Boolean(roles[role]))
  }

  return false
}

async function authorizeBillingUser(req: Request): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (userHasBillingRole(user) || BILLING_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return null
  }

  return json({ error: 'Billing access required for this account.' }, 403)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorizationError = await authorizeBillingUser(req)
    if (authorizationError) return authorizationError

    const { customer_id, origin } = await req.json()
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
