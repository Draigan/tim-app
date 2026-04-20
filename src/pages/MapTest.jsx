import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAPBOX_TOKEN, YARD, geocodeAddress } from '@/lib/mapbox'
import { supabase } from '@/lib/supabase'

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

export default function MapTest() {
  const mapContainer = useRef(null)
  const map = useRef(null)

  useEffect(() => {
    if (map.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-78.73, 44.53],
      zoom: 12,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.current.once('load', () => {
      geocodeAddress(YARD.address).then(results => {
        if (!results.length) return
        const [lng, lat] = results[0].center
        new mapboxgl.Marker({ element: createYardElement(), anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map.current)
      })

      // hardcoded at yard coords — does this drift?
      const el = document.createElement('div')
      el.style.cssText = 'position:relative; cursor:pointer; width:32px; height:40px;'
      el.innerHTML = `
        <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24S32 28 32 16C32 7.163 24.837 0 16 0z" fill="#3b82f6"/>
          <circle cx="16" cy="15" r="9" fill="white"/>
        </svg>
      `
      new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([-78.72, 44.53])
        .addTo(map.current)

      supabase.from('active_deployments').select('*').then(({ data }) => {
        if (!data) return
        console.log('deployment coords:', data.map(d => ({ address: d.address, lat: d.lat, lng: d.lng })))
        data.forEach(dep => {
          const el = document.createElement('div')
          el.style.cssText = 'position:relative; cursor:pointer; width:32px; height:40px;'
          el.innerHTML = `
            <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24S32 28 32 16C32 7.163 24.837 0 16 0z" fill="#22c55e"/>
              <circle cx="16" cy="15" r="9" fill="white"/>
            </svg>
          `
          new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([dep.lng, dep.lat])
            .addTo(map.current)
        })
      })
    })
  }, [])

  return <div ref={mapContainer} className="h-full w-full" />
}
