type MapboxContext = {
  id?: string
  text?: string
  short_code?: string
}

type MapboxFeature = {
  id?: string
  place_name?: string
  text?: string
  address?: string
  center?: [number, number]
  context?: MapboxContext[]
}

function allowedOrigins(): string[] {
  const raw = Deno.env.get('STORAGE_ADDRESS_SEARCH_ORIGINS')?.trim() || Deno.env.get('STORAGE_BOOKING_ALLOWED_ORIGINS')?.trim()
  if (!raw) {
    return ['https://timberfellstorage.ca', 'https://www.timberfellstorage.ca']
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function corsHeaders(req: Request): HeadersInit {
  const origins = allowedOrigins()
  const origin = req.headers.get('origin')
  const allowOrigin = origins.includes('*') ? '*' : origin && origins.includes(origin) ? origin : (origins[0] ?? 'null')

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
}

function originAllowed(req: Request): boolean {
  const origins = allowedOrigins()
  if (origins.includes('*')) return true

  const origin = req.headers.get('origin')
  if (!origin) return true
  return origins.includes(origin)
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapboxToken(): string {
  return cleanText(Deno.env.get('MAPBOX_TOKEN')) || cleanText(Deno.env.get('VITE_MAPBOX_TOKEN'))
}

function context(feature: MapboxFeature, prefix: string): MapboxContext | null {
  return feature.context?.find((item) => item.id?.startsWith(prefix)) ?? null
}

function contextText(feature: MapboxFeature, prefix: string): string {
  return cleanText(context(feature, prefix)?.text)
}

function provinceCode(feature: MapboxFeature): string {
  const region = context(feature, 'region.')
  const shortCode = cleanText(region?.short_code).split('-').pop()
  return shortCode?.toUpperCase() || cleanText(region?.text)
}

function normalizeFeature(feature: MapboxFeature) {
  const firstLine =
    cleanText(feature.address) && cleanText(feature.text)
      ? `${cleanText(feature.address)} ${cleanText(feature.text)}`
      : cleanText(feature.place_name).split(',')[0]?.trim() || cleanText(feature.text)
  const city = contextText(feature, 'place.') || contextText(feature, 'locality.') || contextText(feature, 'district.')
  const province = provinceCode(feature)
  const postalCode = contextText(feature, 'postcode.')
  const country = contextText(feature, 'country.') || 'Canada'
  const label = cleanText(feature.place_name) || [firstLine, city, province, postalCode].filter(Boolean).join(', ')

  if (!firstLine || !label) return null

  return {
    id: cleanText(feature.id) || label,
    label,
    address: firstLine,
    city,
    province,
    country,
    postalCode,
    lng: Array.isArray(feature.center) ? feature.center[0] : null,
    lat: Array.isArray(feature.center) ? feature.center[1] : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req) })
  }
  if (req.method !== 'GET') {
    return json(req, { error: 'Method not allowed' }, 405)
  }
  if (!originAllowed(req)) return json(req, { error: 'Forbidden' }, 403)

  const url = new URL(req.url)
  const query = cleanText(url.searchParams.get('q'))
  if (query.length < 4) return json(req, { suggestions: [] })

  const token = mapboxToken()
  if (!token) {
    return json(req, { error: 'Mapbox token is not configured.' }, 500)
  }

  const params = new URLSearchParams({
    access_token: token,
    country: 'ca',
    proximity: cleanText(Deno.env.get('STORAGE_ADDRESS_SEARCH_PROXIMITY')) || '-78.73,44.53',
    types: 'address',
    limit: '6',
  })

  const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`
  const response = await fetch(mapboxUrl, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    console.error('Mapbox address search failed', response.status, await response.text())
    return json(req, { error: 'Could not search addresses.' }, 502)
  }

  const payload = (await response.json()) as { features?: MapboxFeature[] }
  const suggestions = (payload.features ?? []).map(normalizeFeature).filter(Boolean)
  return json(req, { suggestions })
})
