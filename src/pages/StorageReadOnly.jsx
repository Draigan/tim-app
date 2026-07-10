import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X, Phone, Warehouse, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { cn, formatPhone } from '@/lib/utils'

const CUSTOMER_STORAGE_TYPE_LABELS = { boat: 'Boat', trailer: 'Trailer', rv: 'RV', custom: 'Custom' }

function money(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? `$${amount.toFixed(2)}/mo` : 'No rate'
}

function tenantName(record) {
  return record?.customers?.name || record?.tenant_name || ''
}

function storageTypeLabel(record) {
  if (record?.storage_kind !== 'customer_item') return 'Storage'
  if (record.item_type === 'custom') return record.custom_item_type || 'Custom'
  return CUSTOMER_STORAGE_TYPE_LABELS[record.item_type] ?? 'Storage'
}

function storageItemLabel(record) {
  if (record?.storage_kind !== 'customer_item') return record?.storage_units?.unit_number ? `Unit ${record.storage_units.unit_number}` : 'Storage'
  const type = storageTypeLabel(record)
  return record.item_label ? `${type} ${record.item_label}` : type
}

function fmtDate(value) {
  if (!value) return null
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function Detail({ label, value }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  )
}

function PhoneLine({ phone }) {
  if (!phone) return null
  return (
    <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 text-xs text-primary">
      <Phone size={12} />
      {formatPhone(phone)}
    </a>
  )
}

function StatusPill({ occupied }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
      occupied ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground',
    )}>
      {occupied ? 'Occupied' : 'Vacant'}
    </span>
  )
}

function StorageCard({ title, subtitle, tenant, phone, rate, moveInDate, paidThroughDate, vacant = false }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
        </div>
        <StatusPill occupied={!vacant} />
      </div>

      <div className="space-y-1.5">
        <Detail label="Customer" value={tenant || 'Vacant'} />
        <Detail label="Rate" value={money(rate)} />
        <Detail label="Move in" value={fmtDate(moveInDate)} />
        <Detail label="Paid through" value={fmtDate(paidThroughDate)} />
      </div>
      <PhoneLine phone={phone} />
    </div>
  )
}

export default function StorageReadOnly() {
  const [query, setQuery] = useState('')
  const [units, setUnits] = useState([])
  const [customerItems, setCustomerItems] = useState([])
  const [portableAssets, setPortableAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [
      unitsResult,
      fixedTenanciesResult,
      customerItemsResult,
      assetsResult,
      rentalsResult,
    ] = await Promise.all([
      supabase.from('storage_units').select('id, unit_number, size, area').order('unit_number'),
      supabase
        .from('storage_tenancies')
        .select('id, unit_id, customer_id, tenant_name, tenant_phone, monthly_rate, billing_day, move_in_date, paid_through_date, customers(name, phone)')
        .eq('storage_kind', 'fixed_unit')
        .is('end_date', null),
      supabase
        .from('storage_tenancies')
        .select('id, storage_kind, item_type, custom_item_type, item_label, customer_id, tenant_name, tenant_phone, monthly_rate, billing_day, move_in_date, paid_through_date, customers(name, phone)')
        .eq('storage_kind', 'customer_item')
        .is('end_date', null)
        .order('item_label'),
      supabase.from('assets').select('id, label, size, asset_types(name, is_storage)').eq('archived', false).order('label'),
      supabase
        .from('portable_storage_rentals')
        .select('asset_id, customer_id, tenant_name, tenant_phone, monthly_rate, billing_day, move_in_date, paid_through_date, customers(name, phone)'),
    ])

    const firstError = [unitsResult, fixedTenanciesResult, customerItemsResult, assetsResult, rentalsResult].find(result => result.error)?.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const tenancyByUnit = new Map((fixedTenanciesResult.data ?? []).map(tenancy => [tenancy.unit_id, tenancy]))
    setUnits((unitsResult.data ?? []).map(unit => ({ ...unit, tenancy: tenancyByUnit.get(unit.id) ?? null })))
    setCustomerItems(customerItemsResult.data ?? [])

    const rentalByAsset = new Map((rentalsResult.data ?? []).map(rental => [rental.asset_id, rental]))
    setPortableAssets(
      (assetsResult.data ?? [])
        .filter(asset => asset.asset_types?.is_storage)
        .map(asset => ({ ...asset, rental: rentalByAsset.get(asset.id) ?? null })),
    )
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useRealtime(['storage_units', 'storage_tenancies', 'portable_storage_rentals', 'assets', 'asset_types'], load)

  const q = query.trim().toLowerCase()
  const matches = useCallback((...fields) => !q || fields.some(field => String(field ?? '').toLowerCase().includes(q)), [q])

  const filteredUnits = useMemo(() => units.filter(unit => {
    const tenancy = unit.tenancy
    return matches(unit.unit_number, unit.size, unit.area, tenantName(tenancy), tenancy?.tenant_phone)
  }), [matches, units])

  const filteredCustomerItems = useMemo(() => customerItems.filter(item =>
    matches(storageItemLabel(item), storageTypeLabel(item), tenantName(item), item.tenant_phone),
  ), [customerItems, matches])

  const filteredPortable = useMemo(() => portableAssets.filter(asset => {
    const rental = asset.rental
    return matches(asset.label, asset.size, tenantName(rental), rental?.tenant_phone)
  }), [matches, portableAssets])

  const occupiedUnits = units.filter(unit => unit.tenancy).length
  const activeCustomerItems = customerItems.length
  const rentedPortable = portableAssets.filter(asset => asset.rental).length

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Storage</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Read-only occupancy and rates</p>
      </div>

      <div className="px-4 pb-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-lg font-semibold">{occupiedUnits}/{units.length}</p>
            <p className="text-[11px] text-muted-foreground">Fixed units</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-lg font-semibold">{activeCustomerItems}</p>
            <p className="text-[11px] text-muted-foreground">Customer items</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-lg font-semibold">{rentedPortable}/{portableAssets.length}</p>
            <p className="text-[11px] text-muted-foreground">Portable</p>
          </div>
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search storage..."
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-6">
        {loading && <p className="text-sm text-muted-foreground text-center mt-8">Loading...</p>}
        {error && <p className="text-sm text-destructive text-center mt-8">{error}</p>}

        {!loading && !error && (
          <>
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Warehouse size={15} className="text-muted-foreground" />
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fixed Units</h2>
              </div>
              <div className="space-y-2">
                {filteredUnits.map(unit => {
                  const tenancy = unit.tenancy
                  return (
                    <StorageCard
                      key={unit.id}
                      title={`Unit ${unit.unit_number}`}
                      subtitle={[unit.size, unit.area].filter(Boolean).join(' - ')}
                      tenant={tenantName(tenancy)}
                      phone={tenancy?.customers?.phone || tenancy?.tenant_phone}
                      rate={tenancy?.monthly_rate}
                      moveInDate={tenancy?.move_in_date}
                      paidThroughDate={tenancy?.paid_through_date}
                      vacant={!tenancy}
                    />
                  )
                })}
                {filteredUnits.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No fixed units match.</p>}
              </div>
            </section>

            {filteredCustomerItems.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Package size={15} className="text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer Items</h2>
                </div>
                <div className="space-y-2">
                  {filteredCustomerItems.map(item => (
                    <StorageCard
                      key={item.id}
                      title={storageItemLabel(item)}
                      subtitle={storageTypeLabel(item)}
                      tenant={tenantName(item)}
                      phone={item.customers?.phone || item.tenant_phone}
                      rate={item.monthly_rate}
                      moveInDate={item.move_in_date}
                      paidThroughDate={item.paid_through_date}
                    />
                  ))}
                </div>
              </section>
            )}

            {filteredPortable.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Package size={15} className="text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Portable Storage</h2>
                </div>
                <div className="space-y-2">
                  {filteredPortable.map(asset => {
                    const rental = asset.rental
                    return (
                      <StorageCard
                        key={asset.id}
                        title={asset.label}
                        subtitle={asset.size}
                        tenant={tenantName(rental)}
                        phone={rental?.customers?.phone || rental?.tenant_phone}
                        rate={rental?.monthly_rate}
                        moveInDate={rental?.move_in_date}
                        paidThroughDate={rental?.paid_through_date}
                        vacant={!rental}
                      />
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
