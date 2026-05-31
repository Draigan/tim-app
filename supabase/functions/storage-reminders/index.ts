import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function currentPeriodLabel(billingDay: number): string {
  const today = new Date()
  const effectiveDay = Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth()))
  if (today.getDate() >= effectiveDay) {
    return today.toISOString().slice(0, 7)
  }
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return d.toISOString().slice(0, 7)
}

function lastDayOf(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

function daysOverdue(billingDay: number): number {
  const today = new Date()
  const todayDate = today.getDate()
  const effectiveDay = Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth()))
  const dueDate = todayDate >= effectiveDay
    ? new Date(today.getFullYear(), today.getMonth(), effectiveDay)
    : new Date(today.getFullYear(), today.getMonth() - 1, Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth() - 1)))
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), todayDate)
  return Math.floor((todayMidnight.getTime() - dueDate.getTime()) / 86400000)
}

function shouldSend(overdue: number, settings: Record<string, any>): boolean {
  if (overdue < 0) return false
  if (overdue === 0) return settings.remind_on_due_day
  if (overdue === settings.first_reminder_days_after) return true
  if (overdue > settings.first_reminder_days_after) {
    return (overdue - settings.first_reminder_days_after) % settings.repeat_interval_days === 0
  }
  return false
}

function generatePeriods(billingDay: number, moveInDate: string | null): string[] {
  const current = currentPeriodLabel(billingDay)
  if (!moveInDate) return [current]
  const [sy, sm_raw, sd] = moveInDate.split('-').map(Number)
  const sm = sm_raw - 1
  let [y, m] = current.split('-').map(Number)
  m -= 1
  const periods: string[] = []
  while ((y > sy || (y === sy && m >= sm)) && periods.length < 24) {
    periods.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    if (--m < 0) { m = 11; y-- }
  }
  const moveIn = new Date(sy, sm, sd)
  return periods.filter(p => {
    const [py, pm] = p.split('-').map(Number)
    return new Date(py, pm - 1, Math.min(billingDay, lastDayOf(py, pm - 1))) >= moveIn
  })
}

function formatPeriod(label: string): string {
  const [y, m] = label.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

function buildMessage(
  name: string,
  descriptor: string,
  unpaidPeriods: string[],
  monthlyRate: number | null,
  overdue: number,
  businessName: string
): string {
  const count = unpaidPeriods.length
  const total = monthlyRate ? monthlyRate * count : null
  const contact = 'Please call Tim at (705) 340-8842 to arrange payment. Do not reply to this number.'

  let detail: string
  if (count === 1) {
    const dueLabel = overdue === 0 ? 'due today' : `${overdue} day${overdue === 1 ? '' : 's'} overdue`
    detail = `your ${descriptor} payment${monthlyRate ? ` of $${monthlyRate}` : ''} is ${dueLabel}`
  } else {
    const periodList = unpaidPeriods.map(formatPeriod).join(', ')
    detail = `your ${descriptor} account is ${count} months behind`
    if (total) detail += ` — $${total} outstanding`
    detail += ` (${periodList})`
  }

  return `Hi ${name}, ${detail}. ${contact} - ${businessName}`
}

function normalizePhone(to: string): string {
  const digits = to.replace(/\D/g, '')
  return digits.length === 10 ? '+1' + digits : '+' + digits
}

async function sendTwilio(to: string, body: string): Promise<void> {
  to = normalizePhone(to)
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
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } })

  try {
    const { data: settings } = await supabase
      .from('sms_settings').select('*').eq('id', 1).single()

    if (!settings?.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: 'disabled' }), { headers: { 'Content-Type': 'application/json' } })
    }

    const today = new Date().toISOString().slice(0, 10)

    const { data: todayLogs } = await supabase
      .from('sms_reminder_log').select('ref_id').eq('sent_date', today)

    const sentToday = new Set((todayLogs ?? []).map((l: any) => l.ref_id))

    let sent = 0
    const errors: string[] = []

    // ── Fixed units — query active tenancies directly ────────────────────────
    const { data: tenancies } = await supabase
      .from('storage_tenancies')
      .select('id, unit_id, tenant_name, tenant_phone, billing_day, monthly_rate, move_in_date, storage_units(unit_number)')
      .eq('payment_frequency', 'monthly')
      .not('billing_day', 'is', null)
      .not('tenant_phone', 'is', null)
      .not('tenant_name', 'is', null)
      .is('end_date', null)

    for (const tenancy of tenancies ?? []) {
      if (sentToday.has(tenancy.unit_id)) continue

      const overdue = daysOverdue(tenancy.billing_day)
      if (!shouldSend(overdue, settings)) continue

      const expectedPeriods = generatePeriods(tenancy.billing_day, tenancy.move_in_date)

      const { data: payments } = await supabase
        .from('storage_payments')
        .select('period_label')
        .eq('tenancy_id', tenancy.id)
        .in('period_label', expectedPeriods)

      const paidSet = new Set((payments ?? []).map((p: any) => p.period_label))
      const unpaidPeriods = expectedPeriods.filter(p => !paidSet.has(p))

      if (unpaidPeriods.length === 0) continue

      const unitNumber = (tenancy.storage_units as any)?.unit_number ?? tenancy.unit_id
      const message = buildMessage(
        tenancy.tenant_name,
        `storage unit ${unitNumber}`,
        unpaidPeriods,
        tenancy.monthly_rate,
        overdue,
        settings.business_name
      )

      try {
        await sendTwilio(tenancy.tenant_phone, message)
        await supabase.from('sms_reminder_log').insert({
          ref_id: tenancy.unit_id, unit_type: 'fixed', phone: tenancy.tenant_phone,
          sent_date: today, days_overdue: overdue, message,
        })
        sent++
      } catch (e) {
        errors.push(`unit ${unitNumber}: ${e}`)
      }
    }

    // ── Portable units (unchanged) ───────────────────────────────────────────
    const { data: rentals } = await supabase
      .from('portable_storage_rentals')
      .select('asset_id, tenant_name, tenant_phone, billing_day, monthly_rate, move_in_date, assets(label)')
      .eq('payment_frequency', 'monthly')
      .not('billing_day', 'is', null)
      .not('tenant_phone', 'is', null)
      .not('tenant_name', 'is', null)

    for (const rental of rentals ?? []) {
      if (sentToday.has(rental.asset_id)) continue

      const overdue = daysOverdue(rental.billing_day)
      if (!shouldSend(overdue, settings)) continue

      const expectedPeriods = generatePeriods(rental.billing_day, rental.move_in_date)

      const { data: payments } = await supabase
        .from('portable_storage_payments')
        .select('period_label')
        .eq('asset_id', rental.asset_id)
        .in('period_label', expectedPeriods)

      const paidSet = new Set((payments ?? []).map((p: any) => p.period_label))
      const unpaidPeriods = expectedPeriods.filter(p => !paidSet.has(p))

      if (unpaidPeriods.length === 0) continue

      const label = (rental.assets as any)?.label ?? 'portable unit'
      const message = buildMessage(
        rental.tenant_name,
        'portable storage',
        unpaidPeriods,
        rental.monthly_rate,
        overdue,
        settings.business_name
      )

      try {
        await sendTwilio(rental.tenant_phone, message)
        await supabase.from('sms_reminder_log').insert({
          ref_id: rental.asset_id, unit_type: 'portable', phone: rental.tenant_phone,
          sent_date: today, days_overdue: overdue, message,
        })
        sent++
      } catch (e) {
        errors.push(`asset ${label}: ${e}`)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, errors }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
