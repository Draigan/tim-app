import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAPBOX_TOKEN, YARD, geocodeAddress } from '@/lib/mapbox'
import { useRealtime } from '@/lib/useRealtime'
import { supabase } from '@/lib/supabase'
import { getMarkerColor } from '@/lib/utils'
import AssetBottomSheet from '@/components/AssetBottomSheet'
import { Button } from '@/components/ui/button'
import { Plus, LocateFixed, Layers } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

mapboxgl.accessToken = MAPBOX_TOKEN

const ICON_KEYS = ['trash', 'package', 'car', 'stairs', 'tool', 'toilet-paper']
const COLORS = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' }

function colorKey(expires_at) {
  const hex = getMarkerColor(expires_at)
  return hex === '#ef4444' ? 'red' : hex === '#f59e0b' ? 'yellow' : 'green'
}

function worstColorKey(deps) {
  const keys = deps.map(d => colorKey(d.expires_at))
  return keys.includes('red') ? 'red' : keys.includes('yellow') ? 'yellow' : 'green'
}

function toGeoJSON(deps) {
  const groups = deps.reduce((acc, dep) => {
    ;(acc[dep.address] = acc[dep.address] ?? []).push(dep)
    return acc
  }, {})

  return {
    type: 'FeatureCollection',
    features: Object.values(groups).map(group => {
      const ck = worstColorKey(group)
      const coords = [group[0].lng, group[0].lat]
      if (group.length === 1) {
        const dep = group[0]
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: {
            ck,
            ik: ICON_KEYS.includes(dep.type_icon) ? dep.type_icon : 'package',
            dep: JSON.stringify(dep),
            count: 1,
          },
        }
      }
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
          ck,
          count: group.length,
          deps: JSON.stringify(group),
        },
      }
    }),
  }
}

async function loadPinImages(map) {
  const contents = {}
  await Promise.all(ICON_KEYS.map(async k => {
    try {
      const text = await fetch(`https://api.iconify.design/tabler/${k}.svg`).then(r => r.text())
      contents[k] = (text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i)?.[1] ?? '').replace(/currentColor/g, 'STROKE')
    } catch (e) {
      console.error('icon fetch failed', k, e)
      contents[k] = ''
    }
  }))

  const PIN_BODY = (hex, gradId) => `
    <ellipse cx="13.5" cy="34.8" rx="10.5" ry="5.25" fill="url(#${gradId})"/>
    <path fill="${hex}" d="M27,13.5C27,19.07 20.25,27 14.75,34.5C14.02,35.5 12.98,35.5 12.25,34.5C6.75,27 0,19.22 0,13.5C0,6.04 6.04,0 13.5,0C20.96,0 27,6.04 27,13.5Z"/>
    <path opacity="0.25" d="M13.5,0C6.04,0 0,6.04 0,13.5C0,19.22 6.75,27 12.25,34.5C13,35.52 14.02,35.5 14.75,34.5C20.25,27 27,19.07 27,13.5C27,6.04 20.96,0 13.5,0ZM13.5,1C20.42,1 26,6.58 26,13.5C26,15.9 24.5,19.18 22.22,22.74C19.95,26.3 16.71,30.14 13.94,33.91C13.74,34.18 13.61,34.32 13.5,34.44C13.39,34.32 13.26,34.18 13.06,33.91C10.28,30.13 7.41,26.31 5.02,22.77C2.62,19.23 1,15.95 1,13.5C1,6.58 6.58,1 13.5,1Z"/>
    <circle fill="white" cx="13.5" cy="13.5" r="8"/>
  `

  function renderPin(name, svgInner) {
    return new Promise(resolve => {
      const svg = `<svg display="block" height="41px" width="27px" viewBox="0 0 27 41" xmlns="http://www.w3.org/2000/svg">${svgInner}</svg>`
      const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 27; canvas.height = 41
        canvas.getContext('2d').drawImage(img, 0, 0, 27, 41)
        try {
          const { data } = canvas.getContext('2d').getImageData(0, 0, 27, 41)
          if (!map.hasImage(name)) map.addImage(name, { width: 27, height: 41, data: new Uint8Array(data) })
        } catch (e) { console.error('pin failed', name, e) }
        resolve()
      }
      img.onerror = () => resolve()
      img.src = url
    })
  }

  // Count pins (2–9 and 10+)
  const COUNT_VALS = [2, 3, 4, 5, 6, 7, 8, 9, 'many']
  await Promise.all(
    Object.entries(COLORS).flatMap(([ck, hex]) =>
      COUNT_VALS.map(n => {
        const label = n === 'many' ? '9+' : String(n)
        const gradId = `sgn-${ck}-${n}`
        return renderPin(`pin-count-${ck}-${n}`, `
          <defs><radialGradient id="${gradId}"><stop offset="10%" stop-opacity="0.4"/><stop offset="100%" stop-opacity="0.05"/></radialGradient></defs>
          ${PIN_BODY(hex, gradId)}
          <text x="13.5" y="17.5" text-anchor="middle" font-size="${n === 'many' ? '8' : '10'}" font-weight="700" fill="${hex}" font-family="system-ui,sans-serif">${label}</text>
        `)
      })
    )
  )

  await Promise.all(
    Object.entries(COLORS).flatMap(([ck, hex]) =>
      ICON_KEYS.map(ik => {
        const inner = contents[ik].replace(/STROKE/g, '#1e293b')
        const gradId = `sg-${ck}-${ik}`
        return renderPin(`pin-${ck}-${ik}`, `
          <defs><radialGradient id="${gradId}"><stop offset="10%" stop-opacity="0.4"/><stop offset="100%" stop-opacity="0.05"/></radialGradient></defs>
          ${PIN_BODY(hex, gradId)}
          <g transform="translate(6,6) scale(0.625)" fill="none" stroke="#1e293b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
        `)
      })
    )
  )

  // Yard pin — white pin with logo image drawn on top
  if (!map.hasImage('pin-yard')) {
    await new Promise(resolve => {
      const gradId = 'sg-yard'
      const svgInner = `
        <defs><radialGradient id="${gradId}"><stop offset="10%" stop-opacity="0.4"/><stop offset="100%" stop-opacity="0.05"/></radialGradient></defs>
        ${PIN_BODY('#ffffff', gradId)}
      `
      const svg = `<svg display="block" height="41px" width="27px" viewBox="0 0 27 41" xmlns="http://www.w3.org/2000/svg">${svgInner}</svg>`
      const pinImg = new Image()
      pinImg.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 27; canvas.height = 41
        const ctx = canvas.getContext('2d')
        ctx.drawImage(pinImg, 0, 0, 27, 41)
        const logoImg = new Image()
        logoImg.onload = () => {
          const size = 12
          ctx.drawImage(logoImg, 13.5 - size / 2 + 1.5, 13.5 - size / 2 + 1.5, size, size)
          try {
            const { data } = ctx.getImageData(0, 0, 27, 41)
            map.addImage('pin-yard', { width: 27, height: 41, data: new Uint8Array(data) })
          } catch (e) { console.error('yard pin failed', e) }
          resolve()
        }
        logoImg.onerror = () => resolve()
        logoImg.src = '/favicon.png'
      }
      pinImg.onerror = () => resolve()
      pinImg.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    })
  }
}

async function addDeploymentLayer(map, deps) {
  await loadPinImages(map)

  if (map.getSource('deployments')) {
    ;['deployment-pins', 'deployment-groups'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id)
    })
    map.removeSource('deployments')
  }

  map.addSource('deployments', { type: 'geojson', data: toGeoJSON(deps) })

  map.addLayer({
    id: 'deployment-pins',
    type: 'symbol',
    source: 'deployments',
    filter: ['==', ['get', 'count'], 1],
    layout: {
      'icon-image': ['concat', 'pin-', ['get', 'ck'], '-', ['get', 'ik']],
      'icon-size': 1,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  map.addLayer({
    id: 'deployment-groups',
    type: 'symbol',
    source: 'deployments',
    filter: ['>', ['get', 'count'], 1],
    layout: {
      'icon-image': ['concat', 'pin-count-', ['get', 'ck'], '-',
        ['case', ['>=', ['get', 'count'], 10], 'many', ['to-string', ['get', 'count']]]
      ],
      'icon-size': 1,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
}

function addYardLayer(map, coords) {
  if (map.getLayer('yard-pin')) map.removeLayer('yard-pin')
  if (map.getSource('yard')) map.removeSource('yard')
  map.addSource('yard', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} },
  })
  map.addLayer({
    id: 'yard-pin',
    type: 'symbol',
    source: 'yard',
    layout: {
      'icon-image': 'pin-yard',
      'icon-size': 1,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
}

const MAP_STYLES = [
  { id: 'mapbox://styles/mapbox/streets-v12',        label: 'Streets' },
  { id: 'mapbox://styles/mapbox/outdoors-v12',       label: 'Outdoors' },
  { id: 'mapbox://styles/mapbox/light-v11',          label: 'Light' },
  { id: 'mapbox://styles/mapbox/dark-v11',           label: 'Dark' },
  { id: 'mapbox://styles/mapbox/satellite-v9',       label: 'Satellite' },
  { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Sat + Streets' },
  { id: 'mapbox://styles/mapbox/navigation-day-v1',  label: 'Nav Day' },
  { id: 'mapbox://styles/mapbox/navigation-night-v1',label: 'Nav Night' },
]

export default function MapView() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const mapReady = useRef(false)
  const yardCoords = useRef(null)
  const deploymentsRef = useRef([])
  const [deployments, setDeployments] = useState([])
  const [selected, setSelected] = useState(null)
  const [showStyles, setShowStyles] = useState(false)
  const [activeStyle, setActiveStyle] = useState(
    () => localStorage.getItem('mapStyle') ?? 'mapbox://styles/mapbox/streets-v12'
  )
  const stylesRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const pendingFlyTo = useRef(location.state?.flyTo ?? null)

  const fetchDeployments = useCallback(async () => {
    const { data } = await supabase.from('active_deployments').select('*')
    if (data) setDeployments(data)
  }, [])

  const changeStyle = useCallback(styleId => {
    if (!map.current) return
    setActiveStyle(styleId)
    localStorage.setItem('mapStyle', styleId)
    setShowStyles(false)
    mapReady.current = false
    map.current.setStyle(styleId)
    map.current.once('style.load', async () => {
      await addDeploymentLayer(map.current, deploymentsRef.current)
      if (yardCoords.current) addYardLayer(map.current, yardCoords.current)
      mapReady.current = true
    })
  }, [])

  useEffect(() => { fetchDeployments() }, [fetchDeployments])
  useRealtime(['deployments', 'assets'], fetchDeployments)
  useEffect(() => { deploymentsRef.current = deployments }, [deployments])

  useEffect(() => {
    if (map.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: localStorage.getItem('mapStyle') ?? 'mapbox://styles/mapbox/streets-v12',
      center: [-78.73, 44.53],
      zoom: 12,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: [[-80.5, 43.5], [-76.5, 45.8]],
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.current.on('click', 'deployment-pins', e => {
      const dep = JSON.parse(e.features[0].properties.dep)
      setSelected([dep])
    })
    map.current.on('click', 'deployment-groups', e => {
      const deps = JSON.parse(e.features[0].properties.deps)
      setSelected(deps)
    })
    ;['deployment-pins', 'deployment-groups'].forEach(layer => {
      map.current.on('mouseenter', layer, () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', layer, () => {
        map.current.getCanvas().style.cursor = ''
      })
    })

    map.current.on('load', async () => {
      if (pendingFlyTo.current) {
        map.current.flyTo({ center: pendingFlyTo.current, zoom: 16 })
        pendingFlyTo.current = null
      }

      await addDeploymentLayer(map.current, deploymentsRef.current)

      geocodeAddress(YARD.address).then(results => {
        if (!results.length) return
        const [lng, lat] = results[0].center
        yardCoords.current = [lng, lat]
        addYardLayer(map.current, [lng, lat])
      })

      mapReady.current = true
    })
  }, [])


  useEffect(() => {
    if (!mapReady.current || !map.current) return
    const source = map.current.getSource('deployments')
    if (source) source.setData(toGeoJSON(deployments))
  }, [deployments])

  useEffect(() => {
    if (!showStyles) return
    function handleClickOutside(e) {
      if (stylesRef.current && !stylesRef.current.contains(e.target)) {
        setShowStyles(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStyles])

  return (
    <div className="relative h-full">
      <div ref={mapContainer} className="h-full w-full" />

      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <Button size="sm" variant="secondary" className="shadow-md" onClick={() => yardCoords.current && map.current.flyTo({ center: yardCoords.current, zoom: 12, bearing: 0, pitch: 0 })}>
          <LocateFixed size={15} />
        </Button>
        <div className="relative" ref={stylesRef}>
          <Button size="sm" variant="secondary" className="shadow-md" onClick={() => setShowStyles(s => !s)}>
            <Layers size={15} />
          </Button>
          {showStyles && (
            <div className="absolute top-10 left-0 bg-background border rounded-lg shadow-lg py-1 min-w-36 z-20">
              {MAP_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => changeStyle(s.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${activeStyle === s.id ? 'text-primary font-medium' : 'text-foreground'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
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
