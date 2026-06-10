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
  if (typeof role === 'string' && BILLING_ROLES.has(role)) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => BILLING_ROLES.has(String(role)))
  if (roles && typeof roles === 'object') {
    return [...BILLING_ROLES].some(role => Boolean(roles[role]))
  }

  return false
}

async function authorizeBillingUser(req: Request, body: Record<string, unknown>): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  if (userHasBillingRole(user) || BILLING_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return validateBillingPin(body)
  }

  return json({ error: 'Billing access required for this account.' }, 403)
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
      .select('id, name, phone, email, stripe_customer_id')
      .eq('id', customer_id)
      .single()

    if (error || !customer) return json({ error: 'customer not found' }, 404)
    if (!customer.phone) return json({ error: 'customer has no phone number' }, 400)

    // Create or reuse Stripe customer
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

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: stripeCustomerId,
      currency: 'cad',
      setup_intent_data: { metadata: { customer_id } },
      metadata: { customer_id },
      success_url: 'https://fenelonless.ca/card-saved',
      cancel_url:  'https://fenelonless.ca/card-cancelled',
    })

    const digits = customer.phone.replace(/\D/g, '')
    const normalized = digits.length === 10 ? '+1' + digits : '+' + digits
    const firstName = customer.name?.split(' ')[0] ?? 'there'
    const msg = [
      `Hi ${firstName}, Fenelon Less Storage, a Timberfell Company, is inviting you to save a payment card for automatic billing.`,
      'Secure card link:',
      session.url,
    ].join('\n')
    await sendTwilio(normalized, msg)

    return json({ ok: true })
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
