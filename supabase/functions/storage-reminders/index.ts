import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const BUSINESS_TIME_ZONE = 'America/Toronto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-storage-reminders-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

function authorizeCron(req: Request): Response | null {
  const expected = Deno.env.get('STORAGE_REMINDERS_CRON_SECRET')?.trim()
  if (!expected) return json({ error: 'Storage reminders cron secret is not configured.' }, 500)

  const supplied = req.headers.get('x-storage-reminders-cron-secret')?.trim() ?? ''
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return json({ error: 'Forbidden' }, 403)
  }

  return null
}

function todayParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const value = (type: string) => Number(parts.find(p => p.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function dateLabel(year: number, month: number, day: number): string {
  return `${periodLabel(year, month)}-${String(day).padStart(2, '0')}`
}

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + offset, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

function currentPeriodLabel(billingDay: number): string {
  const today = todayParts()
  const effectiveDay = Math.min(billingDay, lastDayOf(today.year, today.month))
  if (today.day >= effectiveDay) {
    return periodLabel(today.year, today.month)
  }
  const prev = addMonths(today.year, today.month, -1)
  return periodLabel(prev.year, prev.month)
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function periodStartForPeriod(period: string, billingDay: number): string | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  const [year, month] = period.split('-').map(Number)
  return dateLabel(year, month, Math.min(billingDay, lastDayOf(year, month)))
}

function paidThroughForPeriod(period: string, billingDay: number): string | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  const [year, month] = period.split('-').map(Number)
  const next = addMonths(year, month, 1)
  const nextStartDay = Math.min(billingDay, lastDayOf(next.year, next.month))
  const paidThrough = new Date(Date.UTC(next.year, next.month - 1, nextStartDay) - 86400000)
  return dateLabel(paidThrough.getUTCFullYear(), paidThrough.getUTCMonth() + 1, paidThrough.getUTCDate())
}

function periodLabelForDate(value: string, billingDay: number): string | null {
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const effectiveDay = Math.min(billingDay, lastDayOf(year, month))
  if (day >= effectiveDay) return periodLabel(year, month)
  const prev = addMonths(year, month, -1)
  return periodLabel(prev.year, prev.month)
}

function dueDateForPeriod(period: string, billingDay: number, moveInDate: string | null): string | null {
  const start = periodStartForPeriod(period, billingDay)
  const end = paidThroughForPeriod(period, billingDay)
  if (!start || !end) return null
  if (moveInDate && moveInDate > end) return null
  if (moveInDate && moveInDate > start) return moveInDate
  return start
}

function dateMs(label: string): number | null {
  const [year, month, day] = label.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  return Date.UTC(year, month - 1, day)
}

function daysInclusive(start: string, end: string): number {
  const startMs = dateMs(start)
  const endMs = dateMs(end)
  if (startMs === null || endMs === null || endMs < startMs) return 0
  return Math.floor((endMs - startMs) / 86400000) + 1
}

function amountForPeriod(period: string, billingDay: number, moveInDate: string | null, monthlyRate: number | null): number | null {
  const rate = Number(monthlyRate ?? 0)
  if (!Number.isFinite(rate) || rate <= 0) return null

  const start = periodStartForPeriod(period, billingDay)
  const end = paidThroughForPeriod(period, billingDay)
  if (!start || !end) return rate
  if (moveInDate && moveInDate > end) return null

  const chargeStart = moveInDate && moveInDate > start ? moveInDate : start
  const totalDays = daysInclusive(start, end)
  const billableDays = daysInclusive(chargeStart, end)
  if (totalDays <= 0 || billableDays <= 0) return null
  if (billableDays >= totalDays) return rate
  return Number((Math.round(rate * 100) * billableDays / totalDays / 100).toFixed(2))
}

function daysOverdue(billingDay: number, moveInDate: string | null): number {
  const today = todayParts()
  const due = dueDateForPeriod(currentPeriodLabel(billingDay), billingDay, moveInDate)
  if (!due) return -1
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day)
  const dueUtc = dateMs(due)
  if (dueUtc === null) return -1
  return Math.floor((todayUtc - dueUtc) / 86400000)
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

function isPaidThroughToday(paidThroughDate: string | null | undefined, today: string): boolean {
  return !!paidThroughDate && paidThroughDate >= today
}

function generatePeriods(billingDay: number, moveInDate: string | null): string[] {
  const current = currentPeriodLabel(billingDay)
  const first = moveInDate ? periodLabelForDate(moveInDate, billingDay) : current
  if (!first) return [current]

  let [y, m] = current.split('-').map(Number)
  const periods: string[] = []
  while (periods.length < 24) {
    const label = periodLabel(y, m)
    if (label < first) break
    periods.push(label)
    const prev = addMonths(y, m, -1)
    y = prev.year
    m = prev.month
  }
  return periods
}

function formatPeriod(label: string): string {
  const [y, m] = label.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

function buildMessage(
  name: string,
  descriptor: string,
  unpaidPeriods: string[],
  unpaidAmounts: Array<number | null>,
  monthlyRate: number | null,
  overdue: number,
  businessName: string
): string {
  const count = unpaidPeriods.length
  const knownAmounts = unpaidAmounts.filter((amount): amount is number => typeof amount === 'number' && amount > 0)
  const total = knownAmounts.length === count
    ? knownAmounts.reduce((sum, amount) => sum + amount, 0)
    : monthlyRate ? monthlyRate * count : null
  const contact = 'Please call Tim at (705) 340-8842 to arrange payment. Do not reply to this number.'

  let detail: string
  if (count === 1) {
    const dueLabel = overdue === 0 ? 'due today' : `${overdue} day${overdue === 1 ? '' : 's'} overdue`
    const amount = knownAmounts[0] ?? monthlyRate
    detail = `your ${descriptor} payment${amount ? ` of $${amount.toFixed(2)}` : ''} is ${dueLabel}`
  } else {
    const periodList = unpaidPeriods.map(formatPeriod).join(', ')
    detail = `your ${descriptor} account is ${count} months behind`
    if (total) detail += ` — $${total.toFixed(2)} outstanding`
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
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorizationError = authorizeCron(req)
  if (authorizationError) return authorizationError

  try {
    const { data: settings } = await supabase
      .from('sms_settings').select('*').eq('id', 1).single()

    if (!settings?.enabled) {
      return json({ ok: true, skipped: 'disabled' })
    }

    const todayLocal = todayParts()
    const today = dateLabel(todayLocal.year, todayLocal.month, todayLocal.day)

    const { data: todayLogs } = await supabase
      .from('sms_reminder_log').select('ref_id').eq('sent_date', today)

    const sentToday = new Set((todayLogs ?? []).map((l: any) => l.ref_id))

    let sent = 0
    const errors: string[] = []

    // ── Fixed units — query active tenancies directly ────────────────────────
    const { data: tenancies } = await supabase
      .from('storage_tenancies')
      .select('id, unit_id, tenant_name, tenant_phone, billing_day, monthly_rate, move_in_date, paid_through_date, storage_units(unit_number)')
      .eq('payment_frequency', 'monthly')
      .not('billing_day', 'is', null)
      .not('tenant_phone', 'is', null)
      .not('tenant_name', 'is', null)
      .is('end_date', null)

    for (const tenancy of tenancies ?? []) {
      if (sentToday.has(tenancy.unit_id)) continue
      if (isPaidThroughToday(tenancy.paid_through_date, today)) continue

      const overdue = daysOverdue(tenancy.billing_day, tenancy.move_in_date)
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
      const unpaidAmounts = unpaidPeriods.map(period =>
        amountForPeriod(period, tenancy.billing_day, tenancy.move_in_date, tenancy.monthly_rate)
      )

      const unitNumber = (tenancy.storage_units as any)?.unit_number ?? tenancy.unit_id
      const message = buildMessage(
        tenancy.tenant_name,
        `storage unit ${unitNumber}`,
        unpaidPeriods,
        unpaidAmounts,
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
      .select('asset_id, tenant_name, tenant_phone, billing_day, monthly_rate, move_in_date, paid_through_date, assets(label)')
      .eq('payment_frequency', 'monthly')
      .not('billing_day', 'is', null)
      .not('tenant_phone', 'is', null)
      .not('tenant_name', 'is', null)

    for (const rental of rentals ?? []) {
      if (sentToday.has(rental.asset_id)) continue
      if (isPaidThroughToday(rental.paid_through_date, today)) continue

      const overdue = daysOverdue(rental.billing_day, rental.move_in_date)
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
      const unpaidAmounts = unpaidPeriods.map(period =>
        amountForPeriod(period, rental.billing_day, rental.move_in_date, rental.monthly_rate)
      )

      const label = (rental.assets as any)?.label ?? 'portable unit'
      const message = buildMessage(
        rental.tenant_name,
        'portable storage',
        unpaidPeriods,
        unpaidAmounts,
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

    return json({ ok: true, sent, errors })
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
