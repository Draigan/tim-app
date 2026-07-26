import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// One-time (idempotent) backfill: pull email / address / name / phone from Stripe
// into customers that are linked to a Stripe customer but missing that info in
// our records. Fills only empty fields — never overwrites curated data.
// Superuser-gated. Safe to re-run.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-04-22.dahlia' as any })

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function emailsFromEnv(...names: string[]): string[] {
  const values = names
    .flatMap(name => (Deno.env.get(name) ?? '').split(','))
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(values.length ? values : ['d@d.d'])]
}

const SUPERUSER_EMAILS = emailsFromEnv('SUPERUSER_EMAILS')

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function isSuperuser(user: any): boolean {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : ''
  if (SUPERUSER_EMAILS.includes(email)) return true
  const role = user?.app_metadata?.role
  return typeof role === 'string' && role.toLowerCase() === 'superuser'
}

function formatStripeAddress(address: any): string | null {
  if (!address || typeof address !== 'object') return null
  const line = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
    address.country,
  ].map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean).join(', ')
  return line || null
}

function stripeContactFields(source: any): { name?: string; email?: string; phone?: string; address?: string } {
  if (!source || typeof source !== 'object') return {}
  const fields: { name?: string; email?: string; phone?: string; address?: string } = {}
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  const email = typeof source.email === 'string' ? source.email.trim() : ''
  const phone = typeof source.phone === 'string' ? source.phone.trim() : ''
  const address = formatStripeAddress(source.address)
  if (name) fields.name = name
  if (email) fields.email = email
  if (phone) fields.phone = phone
  if (address) fields.address = address
  return fields
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user?.email) return json({ error: 'Unauthorized' }, 401)
  if (!isSuperuser(user)) return json({ error: 'Forbidden' }, 403)

  const summary = { scanned: 0, updated: 0, stillMissingEmail: 0, stillMissingAddress: 0, errors: 0 }
  const PAGE = 200

  for (let from = 0; ; from += PAGE) {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, name, email, phone, address, stripe_customer_id')
      .not('stripe_customer_id', 'is', null)
      .or('email.is.null,address.is.null')
      .range(from, from + PAGE - 1)

    if (error) return json({ error: error.message, summary }, 500)
    if (!customers || customers.length === 0) break

    for (const customer of customers) {
      summary.scanned += 1
      try {
        const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id as string)
        if ((stripeCustomer as any).deleted) continue
        const contact = stripeContactFields(stripeCustomer)

        const updates: Record<string, string> = {}
        if (contact.name && !customer.name) updates.name = contact.name
        if (contact.email && !customer.email) updates.email = contact.email
        if (contact.phone && !customer.phone) updates.phone = contact.phone
        if (contact.address && !customer.address) updates.address = contact.address

        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase.from('customers').update(updates).eq('id', customer.id)
          if (updateError) { summary.errors += 1; continue }
          summary.updated += 1
        }

        if (!(customer.email || updates.email)) summary.stillMissingEmail += 1
        if (!(customer.address || updates.address)) summary.stillMissingAddress += 1
      } catch (err) {
        console.error('backfill failed for customer', customer.id, err)
        summary.errors += 1
      }
    }

    if (customers.length < PAGE) break
  }

  return json({ ok: true, summary })
})
