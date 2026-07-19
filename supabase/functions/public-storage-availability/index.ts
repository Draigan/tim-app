import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type FixedUnit = {
  id: string
  unit_number: string | null
  size: string | null
}

type StorageTenancy = {
  unit_id: string | null
}

type AssetType = {
  id: string
  name: string | null
}

type PortableAsset = {
  id: string
  asset_type_id: string | null
  label: string | null
  size: string | null
}

type Deployment = {
  asset_id: string | null
}

type PortableRental = {
  asset_id: string | null
}

type PendingBooking = {
  unit_id: string | null
  asset_id: string | null
}

type PublicUnit = {
  unitNumber: string
  size: string | null
}

type PublicPortableUnit = PublicUnit & {
  assetType: string | null
}

const DEFAULT_CACHE_SECONDS = 60

function serviceRoleKey(): string {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!secretKeys) throw new Error('Supabase service key is not configured.')

  const parsed = JSON.parse(secretKeys) as Record<string, string>
  const firstKey = parsed.default ?? Object.values(parsed)[0]
  if (!firstKey) throw new Error('Supabase service key is not configured.')
  return firstKey
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  serviceRoleKey(),
  { auth: { autoRefreshToken: false, persistSession: false } },
)

function allowedOrigins(): string[] {
  const raw = Deno.env.get('PUBLIC_STORAGE_AVAILABILITY_ORIGINS')?.trim()
  if (!raw) return ['https://timberfellstorage.ca']
  return raw.split(',').map(origin => origin.trim()).filter(Boolean)
}

function cacheSeconds(): number {
  const configured = Number(Deno.env.get('PUBLIC_STORAGE_AVAILABILITY_CACHE_SECONDS'))
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_CACHE_SECONDS
  return Math.round(configured)
}

function corsHeaders(req: Request): HeadersInit {
  const origins = allowedOrigins()
  const origin = req.headers.get('origin')
  const allowOrigin = origins.includes('*')
    ? '*'
    : origin && origins.includes(origin)
      ? origin
      : origins[0] ?? 'null'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, data: unknown, status = 200) {
  const seconds = cacheSeconds()

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}`,
    },
  })
}

function originAllowed(req: Request): boolean {
  const origins = allowedOrigins()
  if (origins.includes('*')) return true

  const origin = req.headers.get('origin')
  if (!origin) return true
  return origins.includes(origin)
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function byUnitNumber(a: PublicUnit, b: PublicUnit): number {
  return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true, sensitivity: 'base' })
}

function failIfError(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(req, { error: 'Method not allowed' }, 405)
  }
  if (!originAllowed(req)) return json(req, { error: 'Forbidden' }, 403)

  try {
    const [
      fixedUnitsResult,
      activeTenanciesResult,
      storageTypesResult,
      activeDeploymentsResult,
      portableRentalsResult,
      pendingBookingsResult,
    ] = await Promise.all([
      supabase.from('storage_units').select('id, unit_number, size'),
      supabase.from('storage_tenancies').select('unit_id').eq('storage_kind', 'fixed_unit').is('end_date', null),
      supabase.from('asset_types').select('id, name').eq('is_storage', true),
      supabase.from('deployments').select('asset_id').is('picked_up_at', null),
      supabase.from('portable_storage_rentals').select('asset_id'),
      supabase.from('storage_booking_sessions').select('unit_id, asset_id').eq('status', 'pending').gt('expires_at', new Date().toISOString()),
    ])

    failIfError('storage units', fixedUnitsResult.error)
    failIfError('active tenancies', activeTenanciesResult.error)
    failIfError('storage asset types', storageTypesResult.error)
    failIfError('active deployments', activeDeploymentsResult.error)
    failIfError('portable rentals', portableRentalsResult.error)
    failIfError('pending booking sessions', pendingBookingsResult.error)

    const fixedUnits = (fixedUnitsResult.data ?? []) as FixedUnit[]
    const activeTenancies = (activeTenanciesResult.data ?? []) as StorageTenancy[]
    const storageTypes = (storageTypesResult.data ?? []) as AssetType[]
    const activeDeployments = (activeDeploymentsResult.data ?? []) as Deployment[]
    const portableRentals = (portableRentalsResult.data ?? []) as PortableRental[]
    const pendingBookings = (pendingBookingsResult.data ?? []) as PendingBooking[]

    const occupiedFixedUnitIds = new Set(activeTenancies.map(row => row.unit_id).filter(Boolean))
    const heldFixedUnitIds = new Set(pendingBookings.map(row => row.unit_id).filter(Boolean))
    const fixedAvailable = fixedUnits
      .filter(unit => !occupiedFixedUnitIds.has(unit.id) && !heldFixedUnitIds.has(unit.id))
      .map(unit => ({
        unitNumber: cleanText(unit.unit_number) ?? 'Unnumbered',
        size: cleanText(unit.size),
      }))
      .sort(byUnitNumber)

    const storageTypeIds = storageTypes.map(type => type.id)
    let portableAvailable: PublicPortableUnit[] = []

    if (storageTypeIds.length > 0) {
      const portableAssetsResult = await supabase
        .from('assets')
        .select('id, asset_type_id, label, size')
        .eq('archived', false)
        .in('asset_type_id', storageTypeIds)

      failIfError('portable storage assets', portableAssetsResult.error)

      const portableAssets = (portableAssetsResult.data ?? []) as PortableAsset[]
      const deployedAssetIds = new Set(activeDeployments.map(row => row.asset_id).filter(Boolean))
      const rentedAssetIds = new Set(portableRentals.map(row => row.asset_id).filter(Boolean))
      const heldAssetIds = new Set(pendingBookings.map(row => row.asset_id).filter(Boolean))
      const typeNameById = new Map(storageTypes.map(type => [type.id, cleanText(type.name)]))

      portableAvailable = portableAssets
        .filter(asset => !deployedAssetIds.has(asset.id) && !rentedAssetIds.has(asset.id) && !heldAssetIds.has(asset.id))
        .map(asset => ({
          unitNumber: cleanText(asset.label) ?? 'Unnumbered',
          size: cleanText(asset.size),
          assetType: asset.asset_type_id ? typeNameById.get(asset.asset_type_id) ?? null : null,
        }))
        .sort(byUnitNumber)
    }

    const totalAvailable = fixedAvailable.length + portableAvailable.length
    const body = {
      available: totalAvailable > 0,
      totalAvailable,
      fixed: {
        availableCount: fixedAvailable.length,
        units: fixedAvailable,
      },
      portable: {
        availableCount: portableAvailable.length,
        units: portableAvailable,
      },
      generatedAt: new Date().toISOString(),
    }

    if (req.method === 'HEAD') return new Response(null, { headers: corsHeaders(req) })
    return json(req, body)
  } catch (err) {
    console.error(err)
    return json(req, { error: 'Unable to load storage availability.' }, 500)
  }
})
