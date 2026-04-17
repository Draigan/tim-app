import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAPBOX_TOKEN } from '@/lib/mapbox'
import { supabase } from '@/lib/supabase'
import { getMarkerColor } from '@/lib/utils'
import AssetBottomSheet from '@/components/AssetBottomSheet'
import { Button } from '@/components/ui/button'
import { Plus, List, Map as MapIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

mapboxgl.accessToken = MAPBOX_TOKEN

export default function MapView() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const markers = useRef([])
  const [deployments, setDeployments] = useState([])
  const [selected, setSelected] = useState(null)
  const [listView, setListView] = useState(false)
  const navigate = useNavigate()

  const fetchDeployments = useCallback(async () => {
    const { data } = await supabase.from('active_deployments').select('*')
    if (data) setDeployments(data)
  }, [])

  useEffect(() => {
    fetchDeployments()
  }, [fetchDeployments])

  useEffect(() => {
    if (listView || map.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-96, 40],
      zoom: 4,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
  }, [listView])

  useEffect(() => {
    if (!map.current || listView) return
    markers.current.forEach(m => m.remove())
    markers.current = []

    deployments.forEach(dep => {
      const el = document.createElement('div')
      el.style.cssText = `
        width: 16px; height: 16px; border-radius: 50%;
        background-color: ${getMarkerColor(dep.expires_at)};
        border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        cursor: pointer;
      `
      const marker = new mapboxgl.Marker(el)
        .setLngLat([dep.lng, dep.lat])
        .addTo(map.current)

      el.addEventListener('click', e => {
        e.stopPropagation()
        setSelected(dep)
      })
      markers.current.push(marker)
    })
  }, [deployments, listView])

  return (
    <div className="relative h-full">
      {!listView && <div ref={mapContainer} className="h-full w-full" />}

      {listView && (
        <div className="h-full overflow-y-auto">
          <div className="p-4 space-y-2">
            {deployments.length === 0 && (
              <p className="text-muted-foreground text-center mt-16 text-sm">No assets deployed</p>
            )}
            {deployments.map(dep => (
              <button
                key={dep.id}
                className="w-full text-left bg-card border rounded-xl p-4 hover:bg-accent transition-colors"
                onClick={() => setSelected(dep)}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getMarkerColor(dep.expires_at) }}
                  />
                  <span className="font-medium">{dep.label}</span>
                  <span className="text-muted-foreground text-sm">{dep.type_name}</span>
                  {dep.size && <span className="text-muted-foreground text-sm">· {dep.size}</span>}
                </div>
                <p className="text-sm text-muted-foreground mt-1 ml-5">{dep.address}</p>
                {dep.customer_name && (
                  <p className="text-sm text-muted-foreground ml-5">{dep.customer_name}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="absolute top-4 left-4 z-10">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-md"
          onClick={() => setListView(v => !v)}
        >
          {listView
            ? <><MapIcon size={15} className="mr-1" />Map</>
            : <><List size={15} className="mr-1" />List</>
          }
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
        deployment={selected}
        onClose={() => setSelected(null)}
        onPickup={() => { fetchDeployments(); setSelected(null) }}
      />
    </div>
  )
}
