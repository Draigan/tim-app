// Returns the billing identity Stripe holds for a customer: the Stripe customer
// record plus the billing details attached to their default card. Those often
// differ from what we have on file (the person who books storage is not always
// the person whose name is on the card, and Stripe has the card's billing
// address), and an invoice has to show the payer Stripe actually charged.
//
// Amounts and tax never come from here — we compute HST ourselves, so Stripe
// only ever sees a single tax-inclusive total. Line items come from
// storage_payments / portable_storage_payments.
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

function normalizeAddress(address: any) {
  if (!address) return null
  const normalized = {
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    postal_code: address.postal_code ?? '',
    country: address.country ?? '',
  }
  return Object.values(normalized).some(Boolean) ? normalized : null
}

// The default card first, then the most recently attached one. A customer we
// bill always has at least one card, but a lapsed customer may have none.
async function defaultCardFor(customer: any) {
  const attached = customer?.invoice_settings?.default_payment_method
  let paymentMethod = attached && typeof attached === 'object' ? attached : null

  if (!paymentMethod) {
    const list = await stripe.paymentMethods.list({ customer: customer.id, type: 'card', limit: 1 })
    paymentMethod = list.data[0] ?? null
  }
  if (!paymentMethod) return null

  return {
    name: paymentMethod.billing_details?.name ?? '',
    email: paymentMethod.billing_details?.email ?? '',
    phone: paymentMethod.billing_details?.phone ?? '',
    address: normalizeAddress(paymentMethod.billing_details?.address),
    brand: paymentMethod.card?.brand ?? '',
    last4: paymentMethod.card?.last4 ?? '',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorizationError = await authorizeBillingUser(req)
    if (authorizationError) return authorizationError

    const { customer_id } = await req.json()
    if (!customer_id) return json({ error: 'customer_id required' }, 400)

    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, email, phone, address, stripe_customer_id')
      .eq('id', customer_id)
      .maybeSingle()

    if (error) throw error
    if (!customer) return json({ error: 'Customer not found' }, 404)
    if (!customer.stripe_customer_id) {
      return json({ error: 'This customer has no Stripe record — they have never been charged by card.' }, 409)
    }

    const stripeCustomer: any = await stripe.customers.retrieve(customer.stripe_customer_id, {
      expand: ['invoice_settings.default_payment_method'],
    })

    if (stripeCustomer?.deleted) {
      return json({ error: 'The Stripe customer record for this customer was deleted.' }, 409)
    }

    return json({
      stripe_customer_id: stripeCustomer.id,
      customer: {
        name: stripeCustomer.name ?? '',
        email: stripeCustomer.email ?? '',
        phone: stripeCustomer.phone ?? '',
        address: normalizeAddress(stripeCustomer.address),
      },
      card: await defaultCardFor(stripeCustomer),
    })
  } catch (error) {
    console.error('stripe-billing-details failed', error)
    return json({ error: (error as Error).message ?? 'Failed to load Stripe billing details' }, 500)
  }
})
