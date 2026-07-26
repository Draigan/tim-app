export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export const YARD = {
  label: 'Yard',
  address: '114 County Rd 8, Fenelon Falls, ON',
}

// Turns a GPS fix into the nearest civic address, so a pinned drop reads like a
// real address instead of a pair of coordinates.
export async function reverseGeocode(lng, lat) {
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    country: 'ca',
    types: 'address',
    limit: 1,
  })
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params}`
  const res = await fetch(url)
  const data = await res.json()
  return (data.features ?? [])[0] ?? null
}

export async function geocodeAddress(address) {
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    country: 'ca',
    proximity: '-78.73,44.53',
    limit: 5,
  })
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?${params}`
  const res = await fetch(url)
  const data = await res.json()
  return data.features ?? []
}
