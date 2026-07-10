import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  DollarSign,
  Package,
  Percent,
  TrendingUp,
  Users,
  Warehouse,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import StorageViewMenu from '@/components/StorageViewMenu'
import { supabase } from '@/lib/supabase'
import { cn, formatPhone } from '@/lib/utils'
import { useRealtime } from '@/lib/useRealtime'

const DAY_MS = 86400000
const COPY_UNPAID_STATUSES = new Set(['overdue', 'due_soon', 'unpaid'])
const STATISTICS_EXCLUDED_CUSTOMER_NAMES = new Set([
  'test customer 1',
  'test customer 2',
  'test customer',
  'draigan le',
  'tim finley',
  'unknown customer',
])

function normalizeCustomerName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isExcludedStatisticsCustomer(...names) {
  const normalizedNames = names.map(normalizeCustomerName).filter(Boolean)
  if (!normalizedNames.length) return STATISTICS_EXCLUDED_CUSTOMER_NAMES.has('unknown customer')
  return normalizedNames.some(name => STATISTICS_EXCLUDED_CUSTOMER_NAMES.has(name))
}

function customerSpendKey({ customerId, name, phone }) {
  if (customerId) return `customer:${customerId}`
  const normalizedPhone = String(phone ?? '').replace(/\D/g, '')
  return `name:${normalizeCustomerName(name) || 'unknown'}:${normalizedPhone}`
}

function lastDayOf(year, month0) {
  return new Date(year, month0 + 1, 0).getDate()
}

function currentPeriodLabel(billingDay) {
  const today = new Date()
  const effective = billingDay ? Math.min(billingDay, lastDayOf(today.getFullYear(), today.getMonth())) : 0
  if (!billingDay || today.getDate() >= effective) {
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  }
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

function parseLocalDate(value) {
  if (!value) return null
  const [y, m, d] = String(value).split('-').map(Number)
  if (![y, m, d].every(Number.isFinite)) return null
  return new Date(y, m - 1, d)
}

function parseDateTime(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDate(value) {
  const date = parseLocalDate(value) ?? parseDateTime(value)
  return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Not set'
}

function isPaidThroughToday(paidThroughDate) {
  const paidThrough = parseLocalDate(paidThroughDate)
  if (!paidThrough) return false
  const today = parseLocalDate(localDateStr())
  return paidThrough >= today
}

function paymentStatus(billingDay, frequency, isPaid, moveInDate, paidThroughDate) {
  if (!billingDay || !frequency || frequency === 'one_time' || frequency === 'other') {
    return isPaid || isPaidThroughToday(paidThroughDate) ? 'paid' : 'unpaid'
  }
  if (isPaid || isPaidThroughToday(paidThroughDate)) return 'paid'
  const today = parseLocalDate(localDateStr())
  const paidThrough = parseLocalDate(paidThroughDate)
  if (paidThrough && paidThrough < today) return 'overdue'

  const [y, m] = currentPeriodLabel(billingDay).split('-').map(Number)
  let dueDate = new Date(y, m - 1, Math.min(billingDay, lastDayOf(y, m - 1)))
  const moveIn = parseLocalDate(moveInDate)
  if (moveIn && dueDate < moveIn) dueDate = moveIn

  const daysUntilDue = Math.round((dueDate - today) / DAY_MS)
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue <= 3) return 'due_soon'
  return 'upcoming'
}

function money(value, digits = 0) {
  const amount = Number(value) || 0
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function percent(value, total) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

function amountOf(payment) {
  const amount = Number(payment.amount)
  if (Number.isFinite(amount)) return amount
  return (Number(payment.subtotal_amount) || 0) + (Number(payment.tax_amount) || 0)
}

function sumAmounts(items, getter = item => item) {
  return items.reduce((sum, item) => sum + (Number(getter(item)) || 0), 0)
}

function statusLabel(status) {
  if (status === 'due_soon') return 'Due soon'
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'
}

function periodDisplay(label) {
  if (!label || !/^\d{4}-\d{2}$/.test(label)) return label || ''
  const [year, month] = label.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}

function buildStats({
  units,
  tenancies,
  storagePayments,
  assets,
  portableRentals,
  portablePayments,
  openCredits,
  deployments,
}) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const last30 = new Date(now.getTime() - 30 * DAY_MS)
  const labels = Array.from({ length: 6 }, (_, index) => monthLabel(addMonths(now, index - 5)))
  const currentLabel = monthLabel(now)

  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const activeTenancies = tenancies.filter(tenancy => !tenancy.end_date)
  const activeUnitIds = new Set(activeTenancies.map(tenancy => tenancy.unit_id))
  const portableAssets = assets.filter(asset => asset.asset_types?.is_storage)
  const portableAssetIds = new Set(portableAssets.map(asset => asset.id))
  const activePortableRentals = portableRentals.filter(rental => portableAssetIds.has(rental.asset_id) || !portableAssetIds.size)
  const portableByAssetId = new Map(portableAssets.map(asset => [asset.id, asset]))
  const deployedPortableIds = new Set((deployments ?? []).map(deployment => deployment.asset_id).filter(id => portableAssetIds.has(id)))

  const storagePaymentKeys = new Set(storagePayments.map(payment => `${payment.tenancy_id}:${payment.period_label}`))
  const portablePaymentKeys = new Set(portablePayments.map(payment => `${payment.asset_id}:${payment.period_label}`))
  const tenancyById = new Map(tenancies.map(tenancy => [tenancy.id, tenancy]))
  const portableRentalByAssetId = new Map(portableRentals.map(rental => [rental.asset_id, rental]))

  const billingRecords = [
    ...activeTenancies.map(tenancy => {
      const unit = unitById.get(tenancy.unit_id)
      const currentPeriod = currentPeriodLabel(tenancy.billing_day)
      const paidCurrentPeriod = storagePaymentKeys.has(`${tenancy.id}:${currentPeriod}`)
      return {
        id: tenancy.id,
        type: 'fixed',
        label: `Unit ${unit?.unit_number ?? 'Unknown'}`,
        tenant: tenancy.customers?.name ?? tenancy.tenant_name ?? 'Unknown customer',
        customerId: tenancy.customer_id,
        hasPaymentMethod: tenancy.customers?.has_payment_method === true,
        phone: tenancy.customers?.phone ?? tenancy.tenant_phone,
        rate: Number(tenancy.monthly_rate) || 0,
        billingDay: tenancy.billing_day,
        moveInDate: tenancy.move_in_date,
        paidThroughDate: tenancy.paid_through_date,
        status: paymentStatus(tenancy.billing_day, tenancy.payment_frequency, paidCurrentPeriod, tenancy.move_in_date, tenancy.paid_through_date),
      }
    }),
    ...activePortableRentals.map(rental => {
      const asset = portableByAssetId.get(rental.asset_id)
      const currentPeriod = currentPeriodLabel(rental.billing_day)
      const paidCurrentPeriod = portablePaymentKeys.has(`${rental.asset_id}:${currentPeriod}`)
      return {
        id: rental.id,
        type: 'portable',
        label: asset?.label ?? 'Portable unit',
        tenant: rental.customers?.name ?? rental.tenant_name ?? 'Unknown customer',
        customerId: rental.customer_id,
        hasPaymentMethod: rental.customers?.has_payment_method === true,
        phone: rental.customers?.phone ?? rental.tenant_phone,
        rate: Number(rental.monthly_rate) || 0,
        billingDay: rental.billing_day,
        moveInDate: rental.move_in_date,
        paidThroughDate: rental.paid_through_date,
        status: paymentStatus(rental.billing_day, rental.payment_frequency, paidCurrentPeriod, rental.move_in_date, rental.paid_through_date),
      }
    }),
  ]

  const statusCounts = billingRecords.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] ?? 0) + 1
    return counts
  }, {})

  function resolveFixedMeta(payment) {
    const tenancy = tenancyById.get(payment.tenancy_id)
    const unit = tenancy ? unitById.get(tenancy.unit_id) : null
    return {
      customer: tenancy?.customers?.name ?? tenancy?.tenant_name ?? 'Unknown customer',
      label: unit ? `Unit ${unit.unit_number}` : 'Fixed unit',
    }
  }

  function resolvePortableMeta(payment) {
    const rental = portableRentalByAssetId.get(payment.asset_id)
    const asset = portableByAssetId.get(payment.asset_id)
    return {
      customer: rental?.customers?.name ?? rental?.tenant_name ?? 'Unknown customer',
      label: asset?.label ?? 'Portable unit',
    }
  }

  const allPayments = [
    ...storagePayments.map(payment => ({ ...payment, source: 'fixed', ...resolveFixedMeta(payment) })),
    ...portablePayments.map(payment => ({ ...payment, source: 'portable', ...resolvePortableMeta(payment) })),
  ]
  const customerSpendingByKey = new Map()

  function addCustomerSpend({ source, payment, customerId, name, phone, hasPaymentMethod }) {
    const amount = amountOf(payment)
    if (amount <= 0) return

    const key = customerSpendKey({ customerId, name, phone })
    const existing = customerSpendingByKey.get(key) ?? {
      key,
      customerId,
      customer: name || 'Unknown customer',
      phone,
      total: 0,
      fixedTotal: 0,
      portableTotal: 0,
      paymentCount: 0,
      hasPaymentMethod: false,
      firstPaidAt: null,
      lastPaidAt: null,
    }
    existing.total += amount
    existing.paymentCount += 1
    existing.hasPaymentMethod = existing.hasPaymentMethod || hasPaymentMethod === true
    if (source === 'fixed') existing.fixedTotal += amount
    else existing.portableTotal += amount

    const paidAt = parseDateTime(payment.paid_at)
    if (paidAt && (!existing.firstPaidAt || paidAt < existing.firstPaidAt)) existing.firstPaidAt = paidAt
    if (paidAt && (!existing.lastPaidAt || paidAt > existing.lastPaidAt)) existing.lastPaidAt = paidAt
    customerSpendingByKey.set(key, existing)
  }

  storagePayments.forEach(payment => {
    const tenancy = tenancyById.get(payment.tenancy_id)
    if (!tenancy) return
    addCustomerSpend({
      source: 'fixed',
      payment,
      customerId: tenancy.customer_id,
      name: tenancy.customers?.name ?? tenancy.tenant_name,
      phone: tenancy.customers?.phone ?? tenancy.tenant_phone,
      hasPaymentMethod: tenancy.customers?.has_payment_method === true,
    })
  })

  portablePayments.forEach(payment => {
    const rental = portableRentalByAssetId.get(payment.asset_id)
    if (!rental) return
    addCustomerSpend({
      source: 'portable',
      payment,
      customerId: rental.customer_id,
      name: rental.customers?.name ?? rental.tenant_name,
      phone: rental.customers?.phone ?? rental.tenant_phone,
      hasPaymentMethod: rental.customers?.has_payment_method === true,
    })
  })

  const customerSpending = [...customerSpendingByKey.values()]
    .sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer))

  const paidThisMonth = allPayments.filter(payment => {
    const paidAt = parseDateTime(payment.paid_at)
    return paidAt && paidAt >= monthStart
  })
  const paidLast30 = allPayments.filter(payment => {
    const paidAt = parseDateTime(payment.paid_at)
    return paidAt && paidAt >= last30
  })

  const revenueByPeriod = labels.map(label => ({
    label,
    amount: sumAmounts(allPayments.filter(payment => payment.period_label === label), amountOf),
  }))
  const maxPeriodRevenue = Math.max(...revenueByPeriod.map(row => row.amount), 1)

  const areaStats = ['up_top', 'down_below', 'unassigned'].map(area => {
    const areaUnits = area === 'unassigned'
      ? units.filter(unit => !unit.area)
      : units.filter(unit => unit.area === area)
    const areaActive = activeTenancies.filter(tenancy => {
      const unit = unitById.get(tenancy.unit_id)
      return area === 'unassigned' ? !unit?.area : unit?.area === area
    })
    return {
      key: area,
      label: area === 'up_top' ? 'Up Top' : area === 'down_below' ? 'Down Below' : 'Unassigned',
      total: areaUnits.length,
      occupied: areaActive.length,
      revenue: sumAmounts(areaActive, tenancy => tenancy.monthly_rate),
    }
  })

  const uniqueMissingCards = new Map()
  const uniqueCardsOnFile = new Map()
  billingRecords
    .forEach(record => {
      const key = customerSpendKey({
        customerId: record.customerId,
        name: record.tenant,
        phone: record.phone,
      })
      const row = { ...record, cardKey: key }
      if (!record.hasPaymentMethod && !uniqueMissingCards.has(key)) {
        uniqueMissingCards.set(key, row)
      }
      if (record.hasPaymentMethod && !uniqueCardsOnFile.has(key)) {
        uniqueCardsOnFile.set(key, row)
      }
    })
  const missingCardRows = [...uniqueMissingCards.values()]
    .sort((a, b) => a.tenant.localeCompare(b.tenant))
  const cardOnFileRows = [...uniqueCardsOnFile.values()]
    .sort((a, b) => a.tenant.localeCompare(b.tenant))

  const newMoveIns = [
    ...activeTenancies.map(tenancy => ({ type: 'fixed', date: tenancy.move_in_date })),
    ...activePortableRentals.map(rental => ({ type: 'portable', date: rental.move_in_date })),
  ].filter(row => {
    const date = parseLocalDate(row.date)
    return date && date >= last30
  })

  const recentMoveOuts = tenancies.filter(tenancy => {
    const date = parseLocalDate(tenancy.end_date)
    return date && date >= last30
  })

  const fixedMonthly = sumAmounts(activeTenancies, tenancy => tenancy.monthly_rate)
  const portableMonthly = sumAmounts(activePortableRentals, rental => rental.monthly_rate)
  const monthlyRunRate = fixedMonthly + portableMonthly
  const openCreditTotal = sumAmounts(openCredits, credit => credit.amount)

  const rateRows = billingRecords
    .filter(record => record.rate > 0)
    .sort((a, b) => b.rate - a.rate)

  const unpaidContactsByCustomer = new Map()
  billingRecords
    .filter(record => COPY_UNPAID_STATUSES.has(record.status))
    .forEach(record => {
      const key = record.customerId ?? `${record.tenant}:${record.phone ?? ''}`
      if (!unpaidContactsByCustomer.has(key)) {
        unpaidContactsByCustomer.set(key, {
          customerId: record.customerId,
          tenant: record.tenant,
          phone: record.phone,
        })
      }
    })

  const vacantUnits = units
    .filter(unit => !activeUnitIds.has(unit.id))
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))

  const portableRentedIds = new Set(activePortableRentals.map(rental => rental.asset_id))
  const availablePortable = portableAssets.filter(asset => !portableRentedIds.has(asset.id))

  const sizeMix = [...units.reduce((map, unit) => {
    const size = unit.size || 'Unspecified'
    map.set(size, (map.get(size) ?? 0) + 1)
    return map
  }, new Map())]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }))

  return {
    generatedAt: new Date().toISOString(),
    overview: {
      fixedTotal: units.length,
      fixedOccupied: activeTenancies.length,
      fixedVacant: Math.max(0, units.length - activeTenancies.length),
      portableTotal: portableAssets.length,
      portableRented: activePortableRentals.length,
      portableAvailable: Math.max(0, portableAssets.length - activePortableRentals.length),
      portableDeployed: deployedPortableIds.size,
      monthlyRunRate,
      fixedMonthly,
      portableMonthly,
      annualizedRunRate: monthlyRunRate * 12,
      averageFixedRate: activeTenancies.length ? fixedMonthly / activeTenancies.length : 0,
      averagePortableRate: activePortableRentals.length ? portableMonthly / activePortableRentals.length : 0,
      occupiedBillingCount: billingRecords.length,
    },
    billing: {
      statusCounts,
      paidCount: statusCounts.paid ?? 0,
      dueSoonCount: statusCounts.due_soon ?? 0,
      overdueCount: statusCounts.overdue ?? 0,
      unpaidCount: statusCounts.unpaid ?? 0,
      upcomingCount: statusCounts.upcoming ?? 0,
      missingCardCount: uniqueMissingCards.size,
      missingCardRows,
      cardOnFileCount: uniqueCardsOnFile.size,
      cardOnFileRows,
      overdueRows: billingRecords.filter(record => record.status === 'overdue').slice(0, 8),
      dueSoonRows: billingRecords.filter(record => record.status === 'due_soon').slice(0, 8),
      unpaidContactRows: [...unpaidContactsByCustomer.values()]
        .sort((a, b) => a.tenant.localeCompare(b.tenant)),
      openCreditCount: openCredits.length,
      openCreditTotal,
    },
    payments: {
      collectedThisMonth: sumAmounts(paidThisMonth, amountOf),
      collectedLast30: sumAmounts(paidLast30, amountOf),
      taxThisMonth: sumAmounts(paidThisMonth, payment => payment.tax_amount),
      subtotalThisMonth: sumAmounts(paidThisMonth, amountOf) - sumAmounts(paidThisMonth, payment => payment.tax_amount),
      paymentCountThisMonth: paidThisMonth.length,
      monthName: now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      monthPayments: [...paidThisMonth]
        .map(payment => ({
          key: `${payment.source}-${payment.tenancy_id ?? payment.asset_id}-${payment.period_label}-${payment.paid_at}`,
          customer: payment.customer,
          label: payment.label,
          source: payment.source,
          periodLabel: payment.period_label,
          paidAt: parseDateTime(payment.paid_at),
          amount: amountOf(payment),
          tax: Number(payment.tax_amount) || 0,
        }))
        .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0)),
      revenueByPeriod,
      maxPeriodRevenue,
      currentLabel,
      customerSpending,
    },
    activity: {
      newMoveInsLast30: newMoveIns.length,
      moveOutsLast30: recentMoveOuts.length,
      vacantUnits: vacantUnits.slice(0, 12),
      availablePortable: availablePortable.slice(0, 12),
      highestRates: rateRows.slice(0, 5),
      lowestRates: [...rateRows].reverse().slice(0, 5),
      sizeMix,
      areaStats,
    },
  }
}

async function loadStorageStats() {
  const [
    unitsResult,
    tenanciesResult,
    storagePaymentsResult,
    assetsResult,
    portableRentalsResult,
    portablePaymentsResult,
    creditsResult,
    deploymentsResult,
  ] = await Promise.all([
    supabase.from('storage_units').select('id, unit_number, size, area, created_at').order('unit_number'),
    supabase
      .from('storage_tenancies')
      .select('id, unit_id, customer_id, tenant_name, tenant_phone, monthly_rate, billing_day, payment_frequency, move_in_date, end_date, paid_through_date, created_at, customers(id, name, phone, has_payment_method)')
      .order('created_at', { ascending: false }),
    supabase
      .from('storage_payments')
      .select('tenancy_id, period_label, paid_at, amount, subtotal_amount, tax_amount'),
    supabase
      .from('assets')
      .select('id, label, size, archived, asset_types(name, is_storage)')
      .eq('archived', false)
      .order('label'),
    supabase
      .from('portable_storage_rentals')
      .select('id, asset_id, customer_id, tenant_name, tenant_phone, monthly_rate, billing_day, payment_frequency, move_in_date, paid_through_date, created_at, customers(id, name, phone, has_payment_method)'),
    supabase
      .from('portable_storage_payments')
      .select('asset_id, period_label, paid_at, amount, subtotal_amount, tax_amount'),
    supabase
      .from('customer_credits')
      .select('id, customer_id, amount, status, created_at, customers(name)')
      .eq('status', 'open'),
    supabase.from('active_deployments').select('asset_id, customer_name'),
  ])

  const error = [
    unitsResult.error,
    tenanciesResult.error,
    storagePaymentsResult.error,
    assetsResult.error,
    portableRentalsResult.error,
    portablePaymentsResult.error,
    creditsResult.error,
    deploymentsResult.error,
  ].find(Boolean)

  if (error) throw error

  const tenancies = tenanciesResult.data ?? []
  const portableRentals = portableRentalsResult.data ?? []
  const credits = creditsResult.data ?? []
  const excludedTenancies = tenancies.filter(tenancy =>
    isExcludedStatisticsCustomer(tenancy.customers?.name, tenancy.tenant_name)
  )
  const excludedPortableRentals = portableRentals.filter(rental =>
    isExcludedStatisticsCustomer(rental.customers?.name, rental.tenant_name)
  )
  const excludedCredits = credits.filter(credit =>
    isExcludedStatisticsCustomer(credit.customers?.name)
  )
  const excludedTenancyIds = new Set(excludedTenancies.map(tenancy => tenancy.id))
  const excludedPortableAssetIds = new Set(excludedPortableRentals.map(rental => rental.asset_id))
  const excludedCustomerIds = new Set([
    ...excludedTenancies.map(tenancy => tenancy.customer_id),
    ...excludedPortableRentals.map(rental => rental.customer_id),
    ...excludedCredits.map(credit => credit.customer_id),
  ].filter(Boolean))

  return buildStats({
    units: unitsResult.data ?? [],
    tenancies: tenancies.filter(tenancy => !excludedTenancyIds.has(tenancy.id)),
    storagePayments: (storagePaymentsResult.data ?? []).filter(payment => !excludedTenancyIds.has(payment.tenancy_id)),
    assets: assetsResult.data ?? [],
    portableRentals: portableRentals.filter(rental => !excludedPortableAssetIds.has(rental.asset_id)),
    portablePayments: (portablePaymentsResult.data ?? []).filter(payment => !excludedPortableAssetIds.has(payment.asset_id)),
    openCredits: credits.filter(credit =>
      !excludedCustomerIds.has(credit.customer_id) &&
      !isExcludedStatisticsCustomer(credit.customers?.name)
    ),
    deployments: (deploymentsResult.data ?? []).filter(deployment =>
      !isExcludedStatisticsCustomer(deployment.customer_name)
    ),
  })
}

function MetricCard({ title, value, detail, icon: Icon, tone = 'default' }) {
  const toneClass = {
    default: 'text-primary bg-primary/10',
    green: 'text-green-600 bg-green-500/10',
    amber: 'text-amber-600 bg-amber-500/10',
    red: 'text-red-600 bg-red-500/10',
  }[tone]

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
        </div>
        {Icon && (
          <span className={cn('w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0', toneClass)}>
            <Icon size={16} />
          </span>
        )}
      </div>
    </div>
  )
}

function Section({ title, children, action }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function StatusBadge({ status }) {
  const className = {
    paid: 'bg-green-500/10 text-green-700',
    due_soon: 'bg-amber-500/10 text-amber-700',
    overdue: 'bg-red-500/10 text-red-700',
    unpaid: 'bg-muted text-muted-foreground',
    upcoming: 'bg-blue-500/10 text-blue-700',
  }[status] ?? 'bg-muted text-muted-foreground'

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>
      {statusLabel(status)}
    </span>
  )
}

function BillingRow({ row }) {
  return (
    <div className="rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{row.label}</p>
          <StatusBadge status={row.status} />
        </div>
        <p className="text-xs text-muted-foreground truncate">{row.tenant}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-medium">{money(row.rate)}</p>
        <p className="text-xs text-muted-foreground">Paid thru {formatDate(row.paidThroughDate)}</p>
      </div>
    </div>
  )
}

function CompactRow({ label, value, detail }) {
  return (
    <div className="rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
      </div>
      <p className="text-sm font-semibold flex-shrink-0">{value}</p>
    </div>
  )
}

function PaymentRow({ row }) {
  const detail = [
    row.label,
    row.paidAt && row.paidAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    row.source === 'portable' ? 'Portable' : 'Fixed',
    row.periodLabel && `for ${periodDisplay(row.periodLabel)}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.customer}</p>
        {detail && <p className="text-xs text-muted-foreground truncate mt-0.5">{detail}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold">{money(row.amount, 2)}</p>
        {row.tax > 0 && <p className="text-xs text-muted-foreground">{money(row.tax, 2)} HST</p>}
      </div>
    </div>
  )
}

function CustomerSpendingRow({ row }) {
  const detail = [
    row.phone && formatPhone(row.phone),
    row.fixedTotal > 0 && `${money(row.fixedTotal, 2)} fixed`,
    row.portableTotal > 0 && `${money(row.portableTotal, 2)} portable`,
    row.lastPaidAt && `Last paid ${row.lastPaidAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.customer}</p>
        {detail && <p className="text-xs text-muted-foreground truncate mt-0.5">{detail}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold">{money(row.total, 2)}</p>
        <p className="text-xs text-muted-foreground">{row.paymentCount} payment{row.paymentCount !== 1 ? 's' : ''}</p>
      </div>
    </div>
  )
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('Clipboard copy failed.')
}

export default function StorageStatistics() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [copyError, setCopyError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await loadStorageStats()
      setStats(next)
      setError('')
    } catch (err) {
      console.error('storage statistics error:', err)
      setError(err instanceof Error ? err.message : 'Could not load storage statistics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    loadStorageStats()
      .then(next => {
        if (cancelled) return
        setStats(next)
        setError('')
      })
      .catch(err => {
        if (cancelled) return
        console.error('storage statistics error:', err)
        setError(err instanceof Error ? err.message : 'Could not load storage statistics.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])
  useRealtime(['storage_units', 'storage_tenancies', 'storage_payments', 'assets', 'asset_types', 'deployments', 'portable_storage_rentals', 'portable_storage_payments', 'customer_credits'], refresh)

  const statusTotal = stats?.overview.occupiedBillingCount ?? 0
  const statusBars = useMemo(() => {
    if (!stats) return []
    return [
      { key: 'paid', label: 'Paid', count: stats.billing.paidCount, className: 'bg-green-500' },
      { key: 'due_soon', label: 'Due soon', count: stats.billing.dueSoonCount, className: 'bg-amber-500' },
      { key: 'overdue', label: 'Overdue', count: stats.billing.overdueCount, className: 'bg-red-500' },
      { key: 'upcoming', label: 'Upcoming', count: stats.billing.upcomingCount, className: 'bg-blue-500' },
      { key: 'unpaid', label: 'Unpaid', count: stats.billing.unpaidCount, className: 'bg-muted-foreground' },
    ].filter(row => row.count > 0)
  }, [stats])
  const monthlyCutRate = 0.25
  const monthlyCut = stats ? stats.overview.monthlyRunRate * monthlyCutRate : 0
  const fixedMonthlyCut = stats ? stats.overview.fixedMonthly * monthlyCutRate : 0
  const portableMonthlyCut = stats ? stats.overview.portableMonthly * monthlyCutRate : 0
  const unpaidContactText = useMemo(() => {
    if (!stats) return ''
    return stats.billing.unpaidContactRows
      .map(row => `${row.tenant} - ${formatPhone(row.phone) || 'No phone'}`)
      .join('\n')
  }, [stats])

  async function copyUnpaidContacts() {
    if (!unpaidContactText) return
    try {
      await writeClipboard(unpaidContactText)
      setCopyError('')
      setCopyNotice(`Copied ${stats.billing.unpaidContactRows.length} unpaid contact${stats.billing.unpaidContactRows.length === 1 ? '' : 's'}.`)
    } catch (err) {
      console.error('copy unpaid contacts error:', err)
      setCopyNotice('')
      setCopyError('Could not copy unpaid contacts.')
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b bg-background flex-shrink-0">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
          <Link to="/storage" aria-label="Back to storage">
            <ArrowLeft size={18} />
          </Link>
        </Button>
        <h1 className="text-base sm:text-lg font-semibold flex-1">Storage Statistics</h1>
        <StorageViewMenu current="statistics" />
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <div>
            <AlertTriangle size={28} className="text-amber-500 mx-auto mb-3" />
            <p className="font-medium">Statistics unavailable</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
        </div>
      ) : stats && (
        <main className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <Section title="Snapshot">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                title="Fixed occupancy"
                value={`${stats.overview.fixedOccupied}/${stats.overview.fixedTotal}`}
                detail={`${percent(stats.overview.fixedOccupied, stats.overview.fixedTotal)}% occupied · ${stats.overview.fixedVacant} vacant`}
                icon={Percent}
                tone="green"
              />
              <MetricCard
                title="Portable rented"
                value={`${stats.overview.portableRented}/${stats.overview.portableTotal}`}
                detail={`${stats.overview.portableAvailable} available · ${stats.overview.portableDeployed} deployed`}
                icon={Package}
              />
              <MetricCard
                title="Monthly run rate"
                value={money(stats.overview.monthlyRunRate)}
                detail={`${money(stats.overview.annualizedRunRate)} annualized`}
                icon={DollarSign}
                tone="green"
              />
              <MetricCard
                title="Billing attention"
                value={stats.billing.overdueCount + stats.billing.dueSoonCount}
                detail={`${stats.billing.overdueCount} overdue · ${stats.billing.dueSoonCount} due soon`}
                icon={AlertTriangle}
                tone={stats.billing.overdueCount ? 'red' : stats.billing.dueSoonCount ? 'amber' : 'green'}
              />
            </div>
          </Section>

          <Section title="Revenue">
            <div className="rounded-lg border bg-card px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Gross collected · {stats.payments.monthName}</p>
                  <p className="text-3xl font-semibold mt-1">{money(stats.payments.collectedThisMonth, 2)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {money(stats.payments.subtotalThisMonth, 2)} subtotal · {money(stats.payments.taxThisMonth, 2)} HST · {stats.payments.paymentCountThisMonth} payment{stats.payments.paymentCountThisMonth !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="w-10 h-10 rounded-md bg-green-500/10 text-green-600 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={20} />
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                title="Collected this month"
                value={money(stats.payments.collectedThisMonth)}
                detail={`${stats.payments.paymentCountThisMonth} payment${stats.payments.paymentCountThisMonth !== 1 ? 's' : ''}`}
                icon={CheckCircle2}
                tone="green"
              />
              <MetricCard
                title="Collected last 30 days"
                value={money(stats.payments.collectedLast30)}
                detail={`${money(stats.payments.taxThisMonth)} HST this month`}
                icon={TrendingUp}
              />
              <MetricCard
                title="Fixed monthly"
                value={money(stats.overview.fixedMonthly)}
                detail={`${money(stats.overview.averageFixedRate)} avg occupied unit`}
                icon={Warehouse}
              />
              <MetricCard
                title="Portable monthly"
                value={money(stats.overview.portableMonthly)}
                detail={`${money(stats.overview.averagePortableRate)} avg portable rental`}
                icon={Package}
              />
            </div>

            <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Six-month collection trend</p>
                <p className="text-xs text-muted-foreground">By billing period</p>
              </div>
              <div className="space-y-2">
                {stats.payments.revenueByPeriod.map(row => (
                  <div key={row.label} className="grid grid-cols-[3rem_1fr_4.5rem] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{periodDisplay(row.label)}</span>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: row.amount > 0 ? `${Math.max(3, Math.round((row.amount / stats.payments.maxPeriodRevenue) * 100))}%` : 0 }}
                      />
                    </div>
                    <span className="text-right font-medium">{money(row.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="This Month's Payments">
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {stats.payments.paymentCountThisMonth} payment{stats.payments.paymentCountThisMonth !== 1 ? 's' : ''} · {stats.payments.monthName}
                </p>
                <p className="text-sm font-semibold">{money(stats.payments.collectedThisMonth, 2)}</p>
              </div>
              {stats.payments.monthPayments.length > 0 ? (
                <div className="divide-y">
                  {stats.payments.monthPayments.map(row => (
                    <PaymentRow key={row.key} row={row} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground px-4 py-3">No payments collected this month yet.</p>
              )}
            </div>
          </Section>

          <Section title="Customer Spending">
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {stats.payments.customerSpending.length} customer{stats.payments.customerSpending.length !== 1 ? 's' : ''} with storage payments
                </p>
                <p className="text-xs text-muted-foreground">All recorded fixed and portable storage payments</p>
              </div>
              {stats.payments.customerSpending.length > 0 ? (
                <div className="divide-y">
                  {stats.payments.customerSpending.map(row => (
                    <CustomerSpendingRow key={row.key} row={row} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground px-4 py-3">No storage payments recorded.</p>
              )}
            </div>
          </Section>

          <Section
            title="Billing Health"
            action={
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!stats.billing.unpaidContactRows.length}
                onClick={copyUnpaidContacts}
              >
                {copyNotice ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                {copyNotice ? 'Copied' : `Copy unpaid (${stats.billing.unpaidContactRows.length})`}
              </Button>
            }
          >
            <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{statusTotal} active billing item{statusTotal !== 1 ? 's' : ''}</p>
                <p className="text-xs text-muted-foreground">{stats.payments.currentLabel}</p>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                {statusBars.length === 0 ? (
                  <div className="h-full w-full bg-muted" />
                ) : statusBars.map(row => (
                  <div
                    key={row.key}
                    className={row.className}
                    style={{ width: `${percent(row.count, statusTotal)}%` }}
                    title={`${row.label}: ${row.count}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { label: 'Paid', count: stats.billing.paidCount, icon: CheckCircle2, color: 'text-green-600' },
                  { label: 'Due soon', count: stats.billing.dueSoonCount, icon: Clock, color: 'text-amber-600' },
                  { label: 'Overdue', count: stats.billing.overdueCount, icon: XCircle, color: 'text-red-600' },
                  { label: 'Upcoming', count: stats.billing.upcomingCount, icon: Clock, color: 'text-blue-600' },
                  { label: 'Unpaid', count: stats.billing.unpaidCount, icon: AlertTriangle, color: 'text-muted-foreground' },
                ].map(item => {
                  const StatusIcon = item.icon
                  return (
                  <div key={item.label} className="rounded-md bg-muted/40 px-3 py-2">
                    <p className={cn('flex items-center gap-1.5 text-xs', item.color)}>
                      <StatusIcon size={12} />
                      {item.label}
                    </p>
                    <p className="text-lg font-semibold">{item.count}</p>
                  </div>
                  )
                })}
              </div>
              {(copyNotice || copyError) && (
                <p className={cn('text-xs', copyError ? 'text-destructive' : 'text-green-600')}>
                  {copyError || copyNotice}
                </p>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Overdue</h3>
                {stats.billing.overdueRows.length > 0 ? (
                  stats.billing.overdueRows.map(row => <BillingRow key={`${row.type}-${row.id}`} row={row} />)
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border px-3 py-3">No overdue storage billing.</p>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Due Soon</h3>
                {stats.billing.dueSoonRows.length > 0 ? (
                  stats.billing.dueSoonRows.map(row => <BillingRow key={`${row.type}-${row.id}`} row={row} />)
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border px-3 py-3">No billing due in the next few days.</p>
                )}
              </div>
            </div>
          </Section>

          <Section title="Customer Risk">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <MetricCard
                title="Customers missing cards"
                value={stats.billing.missingCardCount}
                detail="Active storage customers"
                icon={CreditCard}
                tone={stats.billing.missingCardCount ? 'amber' : 'green'}
              />
              <MetricCard
                title="Cards on file"
                value={stats.billing.cardOnFileCount}
                detail="Active storage customers"
                icon={CreditCard}
                tone="green"
              />
              <MetricCard
                title="Open credits"
                value={money(stats.billing.openCreditTotal)}
                detail={`${stats.billing.openCreditCount} unresolved credit${stats.billing.openCreditCount !== 1 ? 's' : ''}`}
                icon={DollarSign}
                tone={stats.billing.openCreditCount ? 'amber' : 'green'}
              />
              <MetricCard
                title="Move-ins last 30"
                value={stats.activity.newMoveInsLast30}
                detail="Fixed and portable storage"
                icon={Users}
              />
              <MetricCard
                title="Move-outs last 30"
                value={stats.activity.moveOutsLast30}
                detail="Fixed storage tenancies"
                icon={Warehouse}
              />
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Missing Payment Cards</h3>
                {stats.billing.missingCardRows.length > 0 ? (
                  stats.billing.missingCardRows.map(row => (
                    <BillingRow key={`missing-card-${row.cardKey}-${row.id}`} row={{ ...row, status: 'unpaid' }} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border px-3 py-3">No active storage customers missing cards.</p>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cards On File</h3>
                {stats.billing.cardOnFileRows.length > 0 ? (
                  stats.billing.cardOnFileRows.map(row => (
                    <BillingRow key={`card-on-file-${row.cardKey}-${row.id}`} row={{ ...row, status: 'paid' }} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border px-3 py-3">No active storage customers have cards on file.</p>
                )}
              </div>
            </div>
          </Section>

          <Section title="Capacity">
            <div className="grid lg:grid-cols-3 gap-3">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Area Utilization</h3>
                {stats.activity.areaStats.map(area => (
                  <CompactRow
                    key={area.key}
                    label={area.label}
                    value={`${area.occupied}/${area.total}`}
                    detail={`${percent(area.occupied, area.total)}% occupied · ${money(area.revenue)}/mo`}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vacant Fixed Units</h3>
                {stats.activity.vacantUnits.length > 0 ? (
                  stats.activity.vacantUnits.map(unit => (
                    <CompactRow key={unit.id} label={`Unit ${unit.unit_number}`} value={unit.size || ''} detail={unit.area || 'No area assigned'} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border px-3 py-3">No fixed vacancies.</p>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Portable</h3>
                {stats.activity.availablePortable.length > 0 ? (
                  stats.activity.availablePortable.map(asset => (
                    <CompactRow key={asset.id} label={asset.label} value={asset.size || ''} detail={asset.asset_types?.name} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border px-3 py-3">No available portable storage assets.</p>
                )}
              </div>
            </div>
          </Section>

          <Section title="Rates And Mix">
            <div className="grid lg:grid-cols-3 gap-3">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Highest Rates</h3>
                {stats.activity.highestRates.map(row => (
                  <CompactRow key={`high-${row.type}-${row.id}`} label={row.label} value={money(row.rate)} detail={row.tenant} />
                ))}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lowest Rates</h3>
                {stats.activity.lowestRates.map(row => (
                  <CompactRow key={`low-${row.type}-${row.id}`} label={row.label} value={money(row.rate)} detail={row.tenant} />
                ))}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fixed Unit Sizes</h3>
                {stats.activity.sizeMix.map(row => (
                  <CompactRow key={row.label} label={row.label} value={row.count} />
                ))}
              </div>
            </div>
          </Section>

          <Section title="Your 25% Cut">
            <div className="rounded-lg border bg-card px-4 py-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Based on current monthly run rate</p>
                  <p className="text-3xl font-semibold mt-1">{money(monthlyCut)}</p>
                </div>
                <span className="w-10 h-10 rounded-md bg-green-500/10 text-green-600 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={20} />
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Annualized</p>
                  <p className="text-sm font-semibold mt-0.5">{money(monthlyCut * 12)}</p>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Fixed</p>
                  <p className="text-sm font-semibold mt-0.5">{money(fixedMonthlyCut)}</p>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Portable</p>
                  <p className="text-sm font-semibold mt-0.5">{money(portableMonthlyCut)}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                25% of {money(stats.overview.monthlyRunRate)} monthly run rate.
              </p>
            </div>
          </Section>

          <p className="text-[11px] text-muted-foreground text-center pb-2">
            Updated {new Date(stats.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </p>
        </main>
      )}
    </div>
  )
}
