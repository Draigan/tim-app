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

  return [...new Set(values.length ? values : ['tim@timberfell.ca'])]
}

const STAFF_ADMIN_EMAILS = emailsFromEnv('STAFF_ADMIN_EMAILS', 'ADMIN_EMAILS')
const BILLING_ADMIN_EMAILS = emailsFromEnv('BILLING_ADMIN_EMAILS', 'ADMIN_EMAILS')
const STAFF_ROLES = new Set(['admin', 'staff'])
const BILLING_ROLES = new Set(['admin', 'billing', 'billing_admin'])
const MAX_SMS_BODY_LENGTH = 500

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function userHasAnyRole(user: any, allowedRoles: Set<string>): boolean {
  const appMetadata = user?.app_metadata ?? {}
  const role = appMetadata.role
  if (typeof role === 'string' && allowedRoles.has(role)) return true

  const roles = appMetadata.roles
  if (Array.isArray(roles)) return roles.some(role => allowedRoles.has(String(role)))
  if (roles && typeof roles === 'object') {
    return [...allowedRoles].some(role => Boolean(roles[role]))
  }

  return false
}

async function authorizeSmsUser(req: Request): Promise<Response | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user?.email) return json({ error: 'Unauthorized' }, 401)

  const email = user.email.toLowerCase()
  const hasStaffAccess = userHasAnyRole(user, STAFF_ROLES) || STAFF_ADMIN_EMAILS.includes(email)
  const hasBillingAccess = userHasAnyRole(user, BILLING_ROLES) || BILLING_ADMIN_EMAILS.includes(email)

  return hasStaffAccess || hasBillingAccess
    ? null
    : json({ error: 'SMS access required for this account.' }, 403)
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

function bodyIncludes(value: string, token: unknown): boolean {
  if (token === null || token === undefined) return true
  const needle = String(token).trim().toLowerCase()
  if (!needle) return true
  return value.toLowerCase().includes(needle)
}

async function validateSmsTarget(params: {
  to: string
  body: string
  refId: string
  unitType: string
}): Promise<Response | null> {
  const { to, body, refId, unitType } = params

  if (unitType === 'fixed') {
    const { data: tenancy, error } = await supabaseAdmin
      .from('storage_tenancies')
      .select('id, unit_id, tenant_phone, customers(phone), storage_units(unit_number)')
      .eq('unit_id', refId)
      .is('end_date', null)
      .maybeSingle()

    if (error) return json({ error: error.message }, 500)
    if (!tenancy) return json({ error: 'active tenancy not found for SMS target' }, 404)

    if (!phoneMatches(to, [tenancy.tenant_phone, (tenancy.customers as any)?.phone])) {
      return json({ error: 'SMS phone does not match this tenancy.' }, 403)
    }

    const unitNumber = (tenancy.storage_units as any)?.unit_number
    if (!bodyIncludes(body, unitNumber)) {
      return json({ error: 'SMS body must reference the storage unit.' }, 400)
    }

    return null
  }

  if (unitType === 'portable') {
    const { data: rental, error } = await supabaseAdmin
      .from('portable_storage_rentals')
      .select('id, asset_id, tenant_phone, customers(phone), assets(label)')
      .eq('asset_id', refId)
      .maybeSingle()

    if (error) return json({ error: error.message }, 500)
    if (!rental) return json({ error: 'portable rental not found for SMS target' }, 404)

    if (!phoneMatches(to, [rental.tenant_phone, (rental.customers as any)?.phone])) {
      return json({ error: 'SMS phone does not match this rental.' }, 403)
    }

    const label = (rental.assets as any)?.label
    if (!bodyIncludes(body, label)) {
      return json({ error: 'SMS body must reference the portable unit.' }, 400)
    }

    return null
  }

  return json({ error: 'unit_type must be fixed or portable' }, 400)
}

async function sendTwilio(to: string, body: string): Promise<void> {
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

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio ${res.status}: ${err}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorizationError = await authorizeSmsUser(req)
  if (authorizationError) return authorizationError

  const requestBody = await req.json().catch(() => ({})) as Record<string, unknown>
  const to = normalizePhone(requestBody.to)
  const body = typeof requestBody.body === 'string' ? requestBody.body.trim() : ''
  const refId = typeof requestBody.ref_id === 'string' ? requestBody.ref_id.trim() : ''
  const unitType = typeof requestBody.unit_type === 'string' ? requestBody.unit_type.trim() : ''

  if (!to || !body) return json({ error: 'to and body are required' }, 400)
  if (body.length > MAX_SMS_BODY_LENGTH) return json({ error: 'SMS body is too long' }, 400)
  if (!refId || !unitType) return json({ error: 'ref_id and unit_type are required' }, 400)

  const targetError = await validateSmsTarget({ to, body, refId, unitType })
  if (targetError) return targetError

  await sendTwilio(to, body)

  const today = new Date().toISOString().slice(0, 10)
  await supabaseAdmin.from('sms_reminder_log').upsert({
    ref_id: refId, unit_type: unitType, phone: to,
    sent_date: today, days_overdue: null, message: body,
  }, { onConflict: 'ref_id,sent_date', ignoreDuplicates: true })

  return json({ ok: true })
})
