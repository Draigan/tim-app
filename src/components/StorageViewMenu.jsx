import { useNavigate } from 'react-router-dom'
import { BarChart3, ClipboardCheck, List, Map, Move } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const STORAGE_VIEWS = [
  { value: 'list', label: 'List', to: '/storage', icon: List },
  { value: 'layout', label: 'Layout', to: '/storage/layout', icon: Map },
  { value: 'floorplan', label: 'Plan', to: '/storage/floorplan', icon: Move },
  { value: 'statistics', label: 'Statistics', to: '/storage/statistics', icon: BarChart3 },
  { value: 'customer-notes', label: 'Customer Notes', to: '/storage/customer-notes', icon: ClipboardCheck },
]

export default function StorageViewMenu({ current = 'list', className }) {
  const navigate = useNavigate()
  const currentView = STORAGE_VIEWS.find(view => view.value === current) ?? STORAGE_VIEWS[0]
  const CurrentIcon = currentView.icon

  return (
    <Select
      value={currentView.value}
      onValueChange={value => {
        const next = STORAGE_VIEWS.find(view => view.value === value)
        if (next && next.value !== currentView.value) navigate(next.to)
      }}
    >
      <SelectTrigger
        aria-label="Storage view"
        className={cn('h-9 w-[156px] gap-2 px-2.5', className)}
      >
        <CurrentIcon size={14} className="text-muted-foreground flex-shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STORAGE_VIEWS.map(view => (
          <SelectItem key={view.value} value={view.value}>
            {view.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
