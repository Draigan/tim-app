import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PIN_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
]
const PIN_LENGTH = 4

export default function PinModal({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
  subtitle,
  icon: Icon,
  iconBg = 'bg-primary/10',
  iconColor = 'text-primary',
  confirmLabel = 'Confirm',
  confirmClassName = '',
  pinLabel = 'Enter billing PIN',
  children,
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setPin('')
      setError('')
    })
  }, [open])

  const handleConfirm = useCallback(async () => {
    if (loading || pin.length !== PIN_LENGTH) return
    setError('')
    const result = await onConfirm(pin)
    if (result?.error) {
      setError(result.error)
      setPin('')
    }
  }, [loading, onConfirm, pin])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event) {
      if (loading) return

      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        setError('')
        setPin(current => current.length >= PIN_LENGTH ? current : current + event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        setError('')
        setPin(current => current.slice(0, -1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handleConfirm()
      } else if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleConfirm, loading, onClose, open])

  if (!open) return null

  function tap(key) {
    setError('')
    if (key === 'del') {
      setPin(current => current.slice(0, -1))
      return
    }
    setPin(current => current.length >= PIN_LENGTH ? current : current + key)
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 pointer-events-auto"
      onClick={onClose}
      onPointerDown={e => e.stopPropagation()}
    >
      <div
        className="w-full max-w-sm bg-background rounded-t-2xl shadow-xl pb-safe pointer-events-auto"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        <div className="px-5 pt-3 pb-6 space-y-5">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0', iconBg)}>
                <Icon size={22} className={iconColor} />
              </div>
            )}
            <div>
              <h2 className="text-base font-bold leading-tight">{title}</h2>
              {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>

          {children}

          <div className="flex flex-col items-center gap-1">
            <p className="text-xs text-muted-foreground mb-2">{pinLabel}</p>
            <div className="flex gap-3.5">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-3 h-3 rounded-full transition-all duration-100',
                    i < pin.length ? 'bg-primary scale-110' : 'bg-muted-foreground/25'
                  )}
                />
              ))}
            </div>
            {error && <p className="text-xs text-destructive mt-2 text-center">{error}</p>}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PIN_KEYS.flat().map((key, i) => {
              if (!key) return <div key={i} />
              return (
                <button
                  key={i}
                  type="button"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    tap(key)
                  }}
                  className={cn(
                    'h-14 rounded-xl text-lg font-medium transition-colors active:scale-95',
                    key === 'del'
                      ? 'text-muted-foreground hover:bg-muted active:bg-muted/70'
                      : 'bg-muted hover:bg-muted/70 active:bg-muted/50'
                  )}
                >
                  {key === 'del' ? '⌫' : key}
                </button>
              )
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onPointerDown={e => e.stopPropagation()}
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              className={cn('flex-1 gap-2', confirmClassName)}
              disabled={pin.length !== PIN_LENGTH || loading}
              onPointerDown={e => e.stopPropagation()}
              onClick={handleConfirm}
            >
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Loading…</>
                : confirmLabel
              }
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
