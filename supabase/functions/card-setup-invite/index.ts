import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const FALLBACK_ORIGIN = Deno.env.get('CARD_SETUP_RETURN_ORIGIN')
  ?? Deno.env.get('PAYMENT_PORTAL_ORIGIN')
  ?? 'https://timberfellstorage.ca'

function html(title: string, message: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
      main { width: min(28rem, calc(100vw - 2rem)); border: 1px solid #e2e8f0; border-radius: 12px; background: white; padding: 1.5rem; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 .5rem; font-size: 1.25rem; }
      p { margin: 0; color: #475569; line-height: 1.5; }
    </style>
  </head>
  <body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function redirect(url: string) {
  return new Response(null, { status: 303, headers: { Location: url } })
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

function allowedReturnOrigins(): string[] {
  const fallback = normalizeOrigin(FALLBACK_ORIGIN) ?? 'https://timberfellstorage.ca'
  const raw = Deno.env.get('CARD_SETUP_ALLOWED_RETURN_ORIGINS')?.trim()
  if (!raw) return [fallback, 'https://www.timberfellstorage.ca']
  return raw
    .split(',')
    .map(origin => normalizeOrigin(origin))
    .filter(Boolean) as string[]
}

function cardSetupReturnOrigin(value: unknown): string {
  const origin = normalizeOrigin(value)
  const allowed = allowedReturnOrigins()
  if (origin && allowed.includes(origin)) return origin
  return allowed[0] ?? 'https://timberfellstorage.ca'
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return html('Method not allowed', 'Open this link in your browser.', 405)

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')?.trim()
    if (!token) return html('Invalid link', 'This card setup link is missing its secure token.', 400)

    const tokenHash = await sha256Hex(token)
    const { data: invite, error: inviteError } = await supabase
      .from('card_setup_invites')
      .select('id, customer_id, return_origin, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (inviteError) throw inviteError
    if (!invite) return html('Link not found', 'Ask us to send you a fresh card setup link.', 404)
    if (invite.revoked_at) return html('Link no longer active', 'Ask us to send you a fresh card setup link.', 410)
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return html('Link expired', 'Ask us to send you a fresh card setup link.', 410)
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email, stripe_customer_id')
      .eq('id', invite.customer_id)
      .single()

    if (customerError || !customer) return html('Customer not found', 'Ask us to send you a fresh card setup link.', 404)

    let stripeCustomerId = customer.stripe_customer_id
    if (!stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        name: customer.name ?? undefined,
        email: customer.email ?? undefined,
        metadata: { customer_id: customer.id },
      })
      stripeCustomerId = stripeCustomer.id
      await supabase.from('customers').update({ stripe_customer_id: stripeCustomerId }).eq('id', customer.id)
    }

    const returnOrigin = cardSetupReturnOrigin(invite.return_origin)
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: stripeCustomerId,
      currency: 'cad',
      client_reference_id: customer.id,
      setup_intent_data: {
        metadata: { customer_id: customer.id, invite_id: invite.id },
      },
      metadata: { customer_id: customer.id, invite_id: invite.id },
      success_url: `${returnOrigin}/card-saved`,
      cancel_url: `${returnOrigin}/card-cancelled`,
    })

    await supabase
      .from('card_setup_invites')
      .update({ last_opened_at: new Date().toISOString() })
      .eq('id', invite.id)

    if (!session.url) throw new Error('Stripe did not return a setup URL.')
    return redirect(session.url)
  } catch (err) {
    console.error(err)
    return html('Could not open card setup', 'Please ask us to send a fresh card setup link.', 500)
  }
})
