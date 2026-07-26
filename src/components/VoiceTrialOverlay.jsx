import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAccess } from '@/lib/useAccess'
import {
  acceptVoiceTrial,
  declineVoiceTrial,
  shouldShowVoiceTrial,
  TRIAL_DAYS,
  VOICE_TRIAL_EVENT,
} from '@/lib/voiceTrial'

export default function VoiceTrialOverlay() {
  // Poster is off for everyone right now. Set this to `isOwner` to show Tim the
  // pitch, or `isSuperuser` to demo it (superuser also ignores a stored accept,
  // so it returns on every launch).
  const { isSuperuser } = useAccess()
  const isPitchTarget = false
  const [stage, setStage] = useState('pitch')
  const [, setTick] = useState(0)

  useEffect(() => {
    function bump() {
      setTick(t => t + 1)
      if (shouldShowVoiceTrial({ ignoreAccepted: isSuperuser })) setStage('pitch')
    }
    window.addEventListener(VOICE_TRIAL_EVENT, bump)
    return () => window.removeEventListener(VOICE_TRIAL_EVENT, bump)
  }, [isSuperuser])

  const visible = stage === 'accepted' ||
    (stage === 'pitch' && isPitchTarget && shouldShowVoiceTrial({ ignoreAccepted: isSuperuser }))

  useEffect(() => {
    if (!visible) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [visible])

  if (!visible) return null

  if (stage === 'accepted') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 px-8 text-center">
        <div className="space-y-3">
          <p className="text-2xl font-black uppercase tracking-tight text-amber-400">Trial activated</p>
          <p className="text-sm text-white/80">
            {TRIAL_DAYS} days of Voice Deploy.
          </p>
          <p className="text-sm text-white/80">
            Hit the <span className="font-semibold text-amber-400">mic button</span> on the
            bottom right of the map. Also under More → Voice Deploy.
          </p>
          <button
            type="button"
            onClick={() => setStage('done')}
            className="mt-2 rounded-lg bg-amber-400 px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-black"
          >
            Let's go
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black">
      <div className="relative mx-auto min-h-full w-full max-w-md">
        <img
          src="/voice-trial.webp"
          alt={`Voice Deploy — free ${TRIAL_DAYS} day trial`}
          className="block w-full select-none"
          draggable={false}
        />

        {/* The whole lower half of the poster is the accept target — the drawn
            button sits inside it, so a thumb anywhere down there works. */}
        <button
          type="button"
          onClick={() => { acceptVoiceTrial(); setStage('accepted') }}
          aria-label={`Accept free ${TRIAL_DAYS} day trial`}
          className="absolute inset-x-0 bottom-0 top-1/2 cursor-pointer bg-transparent"
        />

        <button
          type="button"
          onClick={declineVoiceTrial}
          aria-label="No thanks"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur-sm active:bg-black/80"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
