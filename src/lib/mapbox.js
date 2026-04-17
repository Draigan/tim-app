export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export async function geocodeAddress(address) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&limit=5`
  const res = await fetch(url)
  const data = await res.json()
  return data.features ?? []
}
