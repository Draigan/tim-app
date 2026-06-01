import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function StorageLayout() {
  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b bg-background flex-shrink-0">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
          <Link to="/storage" aria-label="Back to storage">
            <ArrowLeft size={18} />
          </Link>
        </Button>
        <h1 className="text-base sm:text-lg font-semibold">Storage Layout</h1>
      </header>

      <div className="flex-1 min-h-0 bg-background" />
    </div>
  )
}
