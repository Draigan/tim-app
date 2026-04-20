import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAPBOX_TOKEN, YARD, geocodeAddress } from '@/lib/mapbox'
import { supabase } from '@/lib/supabase'
import { getMarkerColor } from '@/lib/utils'
import AssetBottomSheet from '@/components/AssetBottomSheet'
import { Button } from '@/components/ui/button'
import { Plus, LocateFixed } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTheme } from '@/lib/theme'

mapboxgl.accessToken = MAPBOX_TOKEN

function createYardElement() {
  const el = document.createElement('div')
  el.style.cssText = 'cursor:default; width:40px; height:48px; position:relative;'
  el.innerHTML = `
    <svg width="40" height="48" viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 0C8.954 0 0 8.954 0 20c0 15 20 28 20 28S40 35 40 20C40 8.954 31.046 0 20 0z" fill="#1e293b"/>
      <circle cx="20" cy="19" r="13" fill="white"/>
    </svg>
    <img src="/logo.webp" style="position:absolute;top:5px;left:5px;width:30px;height:28px;object-fit:contain;pointer-events:none;" />
  `
  return el
}

export default function MapView() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const markers = useRef([])
  const yardCoords = useRef(null)
  const [deployments, setDeployments] = useState([])
  const [selected, setSelected] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { dark } = useTheme()
  const pendingFlyTo = useRef(location.state?.flyTo ?? null)
  const darkInitialized = useRef(false)

  const fetchDeployments = useCallback(async () => {
    const { data } = await supabase.from('active_deployments').select('*')
    if (data) setDeployments(data)
  }, [])

  useEffect(() => {
    fetchDeployments()
  }, [fetchDeployments])

  useEffect(() => {
    if (map.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12',
      center: [-78.73, 44.53],
      zoom: 12,
      minZoom: 4,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.current.once('load', () => {
      if (pendingFlyTo.current) {
        map.current.flyTo({ center: pendingFlyTo.current, zoom: 16 })
        pendingFlyTo.current = null
      }
    })

    geocodeAddress(YARD.address).then(results => {
      if (!results.length) return
      const [lng, lat] = results[0].center
      yardCoords.current = [lng, lat]
      new mapboxgl.Marker({ element: createYardElement(), anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map.current)
    })
  }, [])

  useEffect(() => {
    if (!darkInitialized.current) { darkInitialized.current = true; return }
    if (!map.current) return
    map.current.setStyle(dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12')
  }, [dark])

  useEffect(() => {
    if (!map.current) return
    markers.current.forEach(m => m.remove())
    markers.current = []

    deployments.forEach(dep => {
      const color = getMarkerColor(dep.expires_at)
      const marker = new mapboxgl.Marker({ color, anchor: 'bottom' })
        .setLngLat([dep.lng, dep.lat])
        .addTo(map.current)
      marker.getElement().addEventListener('click', e => { e.stopPropagation(); setSelected([dep]) })
      markers.current.push(marker)
    })
  }, [deployments])

  return (
    <div className="relative h-full">
      <div ref={mapContainer} className="h-full w-full" />

      <div className="absolute top-4 left-4 z-10">
        <Button size="sm" variant="secondary" className="shadow-md" onClick={() => yardCoords.current && map.current.flyTo({ center: yardCoords.current, zoom: 12 })}>
          <LocateFixed size={15} />
        </Button>
      </div>

      <Button
        className="absolute bottom-6 right-4 z-10 shadow-lg rounded-full h-14 w-14"
        size="icon"
        onClick={() => navigate('/inventory')}
      >
        <Plus size={22} />
      </Button>

      <AssetBottomSheet
        deployments={selected}
        onClose={() => setSelected(null)}
        onPickup={() => { fetchDeployments(); setSelected(null) }}
      />
    </div>
  )
}
