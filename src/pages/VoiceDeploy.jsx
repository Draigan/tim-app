import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { AlertCircle, CalendarDays, CheckCircle2, Loader2, LocateFixed, MapPin, Mic, Package, Phone, RotateCcw, Search, Square, Truck, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatPhone, formatPhoneInput, getErrorMessage, newClientId, retryTransient, throwSupabaseError } from '@/lib/utils'
import { useOnlineStatus } from '@/lib/useOnlineStatus'
import { saveVoiceRecording } from '@/lib/voiceRecordings'
import { deleteVoiceDeployDraft, uploadAndTranscribeVoiceRecording } from '@/lib/voiceDeployDrafts'
import { supabase } from '@/lib/supabase'
import { geocodeAddress, reverseGeocode } from '@/lib/mapbox'
import { CUSTOMER_SAFE_COLUMNS } from '@/lib/customerFields'

const MIN_TRANSCRIPTION_SECONDS = 2
// A deploy command takes about ten seconds. Anything near this is a mic left
// running in a truck, so stop it rather than pay to transcribe the drive home.
const MAX_RECORDING_SECONDS = 60
const RECORDING_WARN_SECONDS = 15
const ADDRESS_SEARCH_MIN_CHARS = 3
const ADDRESS_SEARCH_DEBOUNCE_MS = 350
const REQUIRED_PHONE_DIGITS = 10
const PARSE_RETRY_MESSAGE = 'Try again.'
const FIELD_ORDER = ['asset', 'phone', 'customer', 'address', 'notes']

const EMPTY_FIELDS = {
  asset: '',
  customer: '',
  phone: '',
  address: '',
  notes: '',
  expires_at: '',
}

function nowMs() {
  return Date.now()
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
    .find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function digitsOnly(value) {
  const raw = String(value || '').replace(/\D/g, '')
  const trimmed = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw
  return trimmed.length > REQUIRED_PHONE_DIGITS ? trimmed.slice(0, REQUIRED_PHONE_DIGITS) : trimmed
}

// Speech-to-text keeps hearing "pin 6" / "been 6" for "bin 6". The transcriber
// and the parser both get told about this, but the numbers still have to match
// here if either one slips through.
const BIN_MISHEARINGS = /\b(pin|pins|been|bean|bing|pen|ben)\b/g

function normalizeAssetQuery(query) {
  return normalizeText(query).replace(BIN_MISHEARINGS, 'bin')
}

function scoreAsset(asset, query) {
  const q = normalizeAssetQuery(query)
  if (!q) return 0

  const label = normalizeText(asset.label)
  const typeName = normalizeText(asset.type_name)
  const size = normalizeText(asset.size)
  const combined = normalizeText([asset.label, asset.type_name, asset.size, asset.notes].filter(Boolean).join(' '))
  const qDigits = q.replace(/\D/g, '')
  const labelDigits = label.replace(/\D/g, '')

  if (q === label) return 100
  if (label && (q.includes(label) || label.includes(q))) return 88
  if (qDigits && labelDigits && qDigits === labelDigits) {
    if (q.includes('bin') && typeName.includes('dumpster')) return 96
    if (q.includes('dumpster') && typeName.includes('dumpster')) return 94
    if ((q.includes('portable') || q.includes('storage')) && typeName.includes('portable')) return 94
    if (q.includes('trailer') && typeName.includes('trailer')) return 94
    if (label.startsWith('b') && (q.includes('bin') || q.includes('dumpster'))) return 92
    if (label.startsWith('p') && (q.includes('portable') || q.includes('storage'))) return 92
    return 78
  }
  if (combined.includes(q)) return 72
  if (size && q.includes(size)) return 45
  return 0
}

function topAssetMatches(assets, query) {
  return assets
    .map(item => ({ item, score: scoreAsset(item, query) }))
    .filter(match => match.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

function clearAssetMatch(matches) {
  const top = matches[0]
  if (!top || top.score < 70) return null
  const next = matches[1]
  return !next || top.score - next.score >= 12 ? top.item : null
}

function normalizeDateInput(value) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function fieldsFromParseResult(parseResult) {
  if (!parseResult || typeof parseResult !== 'object') return { ...EMPTY_FIELDS }
  return {
    asset: String(parseResult.asset_label || parseResult.asset_text || '').trim(),
    customer: String(parseResult.customer_name || '').trim(),
    phone: digitsOnly(parseResult.customer_phone),
    address: String(parseResult.address_query || parseResult.address_text || '').trim(),
    notes: String(parseResult.notes || '').trim(),
    expires_at: normalizeDateInput(parseResult.expected_pickup_date || parseResult.expires_at),
  }
}

// "Deploy bin 6 to Dave, use my current location" - let the driver pin the drop
// without touching the screen.
const LOCATION_WORD = '(location|position|spot|address|place|gps|coordinates)'
const CURRENT_LOCATION_PATTERNS = [
  new RegExp(`\\b(use|using|take|grab|pin|drop) (my |the )?(current |present )?${LOCATION_WORD}\\b`, 'i'),
  new RegExp(`\\b(my|current) (current )?${LOCATION_WORD}\\b`, 'i'),
  new RegExp(`\\bthis ${LOCATION_WORD}\\b`, 'i'),
  /\bwhere i('m| am)\b/i,
  /\b(right|drop it|drop this|deploy it) here\b/i,
  /\bi('m| am) (standing )?(here|on site|on-site)\b/i,
]

function wantsCurrentLocation(transcript) {
  const text = String(transcript || '')
  return CURRENT_LOCATION_PATTERNS.some(pattern => pattern.test(text))
}

// A GPS fix is dressed up as a Mapbox feature so the rest of the save path -
// coords, address text, validation - needs no special cases. The spoken address
// stays the label; only the pin comes from the device.
function gpsAddressFeature(position, label) {
  const { latitude, longitude, accuracy } = position.coords
  return {
    id: 'gps:' + Date.now(),
    place_name: label,
    center: [longitude, latitude],
    properties: { source: 'gps', accuracy_m: Math.round(accuracy ?? 0) },
  }
}

function coordsFromAddressFeature(feature) {
  if (!feature) return null
  if (Array.isArray(feature.center) && feature.center.length >= 2) {
    const lng = Number(feature.center[0])
    const lat = Number(feature.center[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null
  }

  const lng = Number(feature.lng)
  const lat = Number(feature.lat)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null
}

function sortCustomers(rows) {
  return [...rows].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

function mergeCustomers(current, nextRows) {
  const byId = new Map()
  ;[...current, ...nextRows].forEach(row => {
    if (row?.id) byId.set(row.id, row)
  })
  return sortCustomers([...byId.values()])
}

export default function VoiceDeploy() {
  const isOnline = useOnlineStatus()
  const navigate = useNavigate()
  const location = useLocation()

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const recordingStartedAtRef = useRef(0)
  const handleCaptureCompleteRef = useRef(null)
  const autoStartRef = useRef(location.state?.autoRecord === true)
  const addressReqRef = useRef(0)

  const [capture, setCapture] = useState(null) // null | 'recording' | 'processing'
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const [pendingNote, setPendingNote] = useState('')

  const [fields, setFields] = useState({ ...EMPTY_FIELDS })
  const [hasDraft, setHasDraft] = useState(false) // false → record screen, true → review screen
  const [focusField, setFocusField] = useState(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [assetSearch, setAssetSearch] = useState('')
  const [addressPickerOpen, setAddressPickerOpen] = useState(false)
  const [addressDraft, setAddressDraft] = useState('')

  const [yardAssets, setYardAssets] = useState([])
  const [deployedAssets, setDeployedAssets] = useState([])
  const [customers, setCustomers] = useState([])
  const [resolvedAssetId, setResolvedAssetId] = useState(null)
  const [selectedAddress, setSelectedAddress] = useState(null)
  const [addressChecking, setAddressChecking] = useState(false)
  const [addressSuggestions, setAddressSuggestions] = useState([])
  const [addressError, setAddressError] = useState('')
  const [gpsBusy, setGpsBusy] = useState(false)
  const [savingDeploy, setSavingDeploy] = useState(false)
  const [deploymentId, setDeploymentId] = useState(() => newClientId())
  const [activeDraft, setActiveDraft] = useState(null)

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  const supported = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
  const mimeType = useMemo(() => pickMimeType(), [])

  const resolvedCustomer = useMemo(() => {
    const phone = digitsOnly(fields.phone)
    if (phone.length !== REQUIRED_PHONE_DIGITS) return null
    return customers.find(c => digitsOnly(c.phone) === phone) ?? null
  }, [fields.phone, customers])
  const customerNameMismatch = Boolean(
    resolvedCustomer?.name
    && fields.customer
    && normalizeText(resolvedCustomer.name) !== normalizeText(fields.customer)
  )

  const assetMatches = useMemo(() => topAssetMatches(yardAssets, fields.asset), [yardAssets, fields.asset])
  const autoAssetId = clearAssetMatch(assetMatches)?.id ?? null
  const effectiveAssetId = resolvedAssetId ?? autoAssetId

  const deployedMatch = useMemo(() => {
    if (effectiveAssetId || !fields.asset) return null
    const match = deployedAssets
      .map(item => ({ item, score: scoreAsset(item, fields.asset) }))
      .filter(m => m.score >= 88)
      .sort((a, b) => b.score - a.score)[0]
    return match?.item ?? null
  }, [deployedAssets, fields.asset, effectiveAssetId])

  const status = useMemo(() => computeStatus({
    fields, resolvedCustomer, effectiveAssetId, deployedMatch, selectedAddress,
  }), [fields, resolvedCustomer, effectiveAssetId, deployedMatch, selectedAddress])

  useEffect(() => () => {
    clearInterval(timerRef.current)
    stopStream()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!isOnline) return
    async function loadCandidates() {
      try {
        const [
          { data: assets, error: assetError },
          { data: customerRows, error: customerError },
          { data: deployed, error: deployedError },
        ] = await Promise.all([
          supabase.from('yard_assets').select('id, label, size, type_name, notes').order('label'),
          supabase.from('customers').select(CUSTOMER_SAFE_COLUMNS).is('archived_at', null).order('name'),
          supabase.from('active_deployments').select('asset_id, label, size, type_name, customer_name, address, dropped_at').order('label'),
        ])
        if (assetError) throw assetError
        if (customerError) throw customerError
        if (deployedError) throw deployedError
        if (cancelled) return
        setYardAssets(assets ?? [])
        setCustomers(customerRows ?? [])
        setDeployedAssets(deployed ?? [])
      } catch (err) {
        console.error('voice deploy candidate load failed:', err)
      }
    }
    loadCandidates()
    return () => { cancelled = true }
  }, [isOnline])

  function setField(field, value) {
    if (error) setError('')
    setFields(prev => ({ ...prev, [field]: value }))
    if (field === 'asset') setResolvedAssetId(null)
    if (field === 'address') {
      setSelectedAddress(null)
      setAddressSuggestions([])
      setAddressError('')
    }
  }

  async function startCapture() {
    if (capture) return
    if (!supported) {
      setError('Audio recording is not available in this browser.')
      return
    }
    setError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size > 0) chunksRef.current.push(event.data)
      })
      recorder.addEventListener('stop', () => {
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        const elapsed = Math.max(1, Math.round((nowMs() - recordingStartedAtRef.current) / 1000))
        stopStream()
        handleCaptureCompleteRef.current?.({ blob, type, duration: elapsed })
      })

      recorder.start(1000)
      recordingStartedAtRef.current = nowMs()
      setDuration(0)
      setCapture('recording')
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((nowMs() - recordingStartedAtRef.current) / 1000)
        setDuration(elapsed)
        if (elapsed >= MAX_RECORDING_SECONDS) stopCapture()
      }, 250)
    } catch (err) {
      console.error('audio recording failed:', err)
      stopStream()
      setError(err?.name === 'NotAllowedError'
        ? 'Microphone permission was denied.'
        : 'Could not start microphone recording.')
    }
  }

  function stopCapture() {
    clearInterval(timerRef.current)
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') {
      recorder.stop()
      return
    }
    stopStream()
    setCapture(null)
  }

  useEffect(() => {
    if (!autoStartRef.current) return undefined
    autoStartRef.current = false
    navigate('/voice-deploy', { replace: true, state: {} })
    const timeout = window.setTimeout(() => startCapture(), 250)
    return () => window.clearTimeout(timeout)
    // Run once on entry so the map mic button can hand off to this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function processCommand({ blob, type }) {
    setCapture('processing')
    setError('')
    setPendingNote('')
    try {
      const { draft, error: invokeError } = await uploadAndTranscribeVoiceRecording({ blob, type, size: blob.size })
      if (invokeError || draft.status === 'failed') {
        setError(getErrorMessage(invokeError, draft.error_message || 'Could not transcribe that. Try again.'))
        setCapture(null)
        return
      }
      if (draft.status === 'parse_failed' || !draft.parse_result) {
        setError(PARSE_RETRY_MESSAGE)
        setCapture(null)
        return
      }
      const nextFields = fieldsFromParseResult(draft.parse_result || null)
      setActiveDraft({ id: draft.id, audio_path: draft.audio_path })
      setFields(nextFields)
      setResolvedAssetId(null)
      setSelectedAddress(null)
      setAddressSuggestions([])
      setAddressError('')
      setFocusField(null)
      setHasDraft(true)
      setCapture(null)
      if (wantsCurrentLocation(draft.transcript)) {
        pinCurrentLocation({ closePicker: false })
      } else if (nextFields.address) {
        runGeocode(nextFields.address, { autoSelect: true })
      }
    } catch (err) {
      console.error('voice command processing failed:', err)
      setError(getErrorMessage(err, 'Could not process that recording.'))
      setCapture(null)
    }
  }

  // A second round of speech: send the AI the fields already filled in plus the
  // new speech, and merge its result — keep existing values, apply changes/adds.
  async function processAmendment({ blob, type }) {
    setCapture('processing')
    setError('')
    const candidates = addressSuggestions
    const context = {
      asset_text: fields.asset || null,
      customer_name: fields.customer || null,
      customer_phone: fields.phone || null,
      address_text: fields.address || null,
      expected_pickup_date: fields.expires_at || null,
      notes: fields.notes || null,
      // Include any address options already on screen so a correction like
      // "the Fenelon Falls one" can pick from them in the same call.
      address_candidates: candidates.length
        ? candidates.map((c, i) => ({ index: i, place_name: c.place_name }))
        : null,
    }
    try {
      const { draft, error: invokeError } = await uploadAndTranscribeVoiceRecording({ blob, type, size: blob.size }, context)
      deleteVoiceDeployDraft(draft.id, draft.audio_path).catch(err => console.error('amend draft cleanup failed:', err))
      if (invokeError || draft.status === 'failed') {
        setError(getErrorMessage(invokeError, draft.error_message || 'Could not hear that. Try again.'))
        setCapture(null)
        return
      }
      if (draft.status === 'parse_failed' || !draft.parse_result) {
        setError(PARSE_RETRY_MESSAGE)
        setCapture(null)
        return
      }
      const parseResult = draft.parse_result || null
      const idx = parseResult?.selected_address_index
      const picked = Number.isInteger(idx) && idx >= 0 && idx < candidates.length ? candidates[idx] : null
      applyMergedFields(fieldsFromParseResult(parseResult), { picked })
      if (wantsCurrentLocation(draft.transcript)) pinCurrentLocation({ closePicker: false })
      setCapture(null)
    } catch (err) {
      console.error('voice amendment failed:', err)
      setError(getErrorMessage(err, 'Could not process that.'))
      setCapture(null)
    }
  }

  async function handleCaptureComplete({ blob, type, duration: seconds }) {
    if (seconds < MIN_TRANSCRIPTION_SECONDS) {
      setCapture(null)
      setError(`Hold the mic for at least ${MIN_TRANSCRIPTION_SECONDS} seconds.`)
      return
    }
    if (!isOnline) {
      if (hasDraft) {
        setError('Reconnect to add or fix by voice.')
      } else {
        try {
          await saveVoiceRecording({ blob, type, duration: seconds, createdAt: new Date().toISOString() })
          setPendingNote('Saved on this device. Reconnect to process it.')
        } catch (err) {
          console.error('offline voice save failed:', err)
          setError('Could not save this recording on-device.')
        }
      }
      setCapture(null)
      return
    }
    if (hasDraft) await processAmendment({ blob, type })
    else await processCommand({ blob, type })
  }

  useEffect(() => {
    handleCaptureCompleteRef.current = handleCaptureComplete
    return () => { handleCaptureCompleteRef.current = null }
  })

  // Overwrite with the AI's merged fields, but never blank out a value it
  // dropped, and only reset resolution state for fields that actually changed.
  function applyMergedFields(next, { picked = null } = {}) {
    const merged = {
      asset: next.asset || fields.asset,
      customer: next.customer || fields.customer,
      phone: next.phone || fields.phone,
      // When the AI picked an address candidate, that place name wins.
      address: picked ? picked.place_name : (next.address || fields.address),
      notes: next.notes || fields.notes,
      expires_at: next.expires_at || fields.expires_at,
    }
    const assetChanged = normalizeText(merged.asset) !== normalizeText(fields.asset)
    const addressChanged = normalizeText(merged.address) !== normalizeText(fields.address)

    setFields(merged)
    setFocusField(null)
    if (assetChanged) setResolvedAssetId(null)
    if (picked) {
      setSelectedAddress(picked)
      setAddressSuggestions([picked])
      setAddressError('')
    } else if (addressChanged) {
      setSelectedAddress(null)
      setAddressSuggestions([])
      setAddressError('')
      if (merged.address) runGeocode(merged.address, { autoSelect: true })
    }
  }

  async function runGeocode(address, { autoSelect }) {
    const query = String(address || '').trim()
    if (!query) return
    const reqId = ++addressReqRef.current
    setAddressChecking(true)
    setAddressError('')
    try {
      const results = await geocodeAddress(query)
      if (reqId !== addressReqRef.current) return
      if (results.length === 0) {
        setAddressSuggestions([])
        setAddressError('No Mapbox matches found.')
        return
      }
      if (autoSelect && (results[0].relevance ?? 0) >= 0.9) {
        selectAddress(results[0])
      } else {
        setAddressSuggestions(results)
      }
    } catch (err) {
      if (reqId !== addressReqRef.current) return
      console.error('voice deploy address check failed:', err)
      setAddressError(getErrorMessage(err, 'Could not check address.'))
    } finally {
      if (reqId === addressReqRef.current) setAddressChecking(false)
    }
  }

  function openAddressPicker() {
    const current = fields.address || ''
    setAddressDraft(current)
    setAddressPickerOpen(true)
  }

  useEffect(() => {
    if (!addressPickerOpen || !isOnline) return
    const query = addressDraft.trim()
    if (query.length < ADDRESS_SEARCH_MIN_CHARS) return
    if (selectedAddress && query === selectedAddress.place_name) return
    const timer = setTimeout(() => {
      runGeocode(query, { autoSelect: false })
    }, ADDRESS_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressDraft, addressPickerOpen, isOnline])

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This device cannot provide a location.'))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      })
    })
  }

  function geolocationErrorMessage(err) {
    if (err?.code === 1) return 'Location is blocked. Turn it on for this app in your device settings.'
    if (err?.code === 3) return 'Could not get a fix. Try again with a clear view of the sky.'
    return getErrorMessage(err, 'Could not get your location.')
  }

  async function pinCurrentLocation({ closePicker = true } = {}) {
    setGpsBusy(true)
    setAddressError('')
    try {
      const position = await getPosition()
      const [lng, lat] = [position.coords.longitude, position.coords.latitude]

      // The address text on screen is usually the wrong one - that is why the
      // driver is pinning. Name the pin after where they actually are.
      let label = ''
      try {
        const match = await reverseGeocode(lng, lat)
        label = match?.place_name ?? ''
      } catch (err) {
        console.warn('reverse geocode failed, keeping typed address:', err)
      }
      if (!label) label = String(addressDraft || fields.address || '').trim() || 'Dropped pin'

      const feature = gpsAddressFeature(position, label)
      setAddressDraft(label)
      if (closePicker) chooseAddress(feature)
      else selectAddress(feature)
    } catch (err) {
      setAddressError(geolocationErrorMessage(err))
    } finally {
      setGpsBusy(false)
    }
  }

  function selectAddress(feature) {
    setSelectedAddress(feature)
    setAddressError('')
    setAddressSuggestions([feature])
    setFields(prev => ({ ...prev, address: feature.place_name }))
  }

  function chooseAddress(feature) {
    selectAddress(feature)
    setAddressPickerOpen(false)
  }

  function openAssetPicker() {
    setAssetSearch('')
    setAssetPickerOpen(true)
  }

  function selectAsset(item) {
    setField('asset', item.label)
    setResolvedAssetId(item.id)
    setAssetPickerOpen(false)
  }

  const pickerAssets = (() => {
    const q = normalizeText(assetSearch)
    if (!q) return yardAssets
    return yardAssets.filter(a => normalizeText([a.label, a.type_name, a.size].filter(Boolean).join(' ')).includes(q))
  })()

  function applyCustomerMatch() {
    if (!resolvedCustomer) return
    setFields(prev => ({
      ...prev,
      customer: resolvedCustomer.name || prev.customer,
      address: prev.address || resolvedCustomer.address || '',
    }))
  }

  const recording = capture === 'recording'
  const processing = capture === 'processing'

  async function resolveCustomerForDeploy() {
    const phone = digitsOnly(fields.phone)
    const name = String(fields.customer || '').trim()
    if (phone.length !== REQUIRED_PHONE_DIGITS) throw new Error('Add the customer phone.')

    const { data: latestCustomers, error: customerLoadError } = await supabase
      .from('customers')
      .select(CUSTOMER_SAFE_COLUMNS)
      .is('archived_at', null)

    if (customerLoadError) throw customerLoadError

    const rows = latestCustomers ?? []
    const existing = rows.find(customer => digitsOnly(customer.phone) === phone)
    setCustomers(sortCustomers(rows))
    if (existing) return existing

    if (!name) throw new Error('Add the customer name.')

    const customerId = newClientId()
    const created = await retryTransient(async () => {
      const result = await supabase
        .from('customers')
        .insert({
          id: customerId,
          name,
          phone: formatPhoneInput(phone),
          address: String(fields.address || '').trim() || null,
          notes: null,
        })
        .select(CUSTOMER_SAFE_COLUMNS)
        .single()

      if (result.error?.code === '23505') {
        return throwSupabaseError(
          await supabase.from('customers').select(CUSTOMER_SAFE_COLUMNS).eq('id', customerId).single()
        )
      }

      return throwSupabaseError(result)
    })

    if (!created.data) throw new Error('Could not create customer.')
    setCustomers(prev => mergeCustomers(prev, [created.data]))
    return created.data
  }

  async function handleDeploy() {
    if (savingDeploy || recording || processing) return

    setError('')
    if (!isOnline) { setError('Reconnect to deploy.'); return }
    if (!effectiveAssetId && !String(fields.asset || '').trim()) { setError('Pick an asset.'); return }
    if (digitsOnly(fields.phone).length !== REQUIRED_PHONE_DIGITS) { setError('Add the customer phone.'); return }

    const coords = coordsFromAddressFeature(selectedAddress)
    if (!coords) { setError('Pick an address.'); return }

    setSavingDeploy(true)
    let session = null
    try {
      const { data } = await supabase.auth.getSession()
      session = data?.session ?? null
      if (!session) throw new Error('Sign in required.')

      const assetQuery = supabase
        .from('yard_assets')
        .select('id, label, size, type_name, notes')
      const { data: yardRows, error: assetError } = effectiveAssetId
        ? await assetQuery.eq('id', effectiveAssetId)
        : await assetQuery

      if (assetError) throw assetError
      const yardAsset = effectiveAssetId
        ? (yardRows ?? [])[0]
        : clearAssetMatch(topAssetMatches(yardRows ?? [], fields.asset))
      if (!yardAsset) throw new Error('Pick an asset.')

      const customer = await resolveCustomerForDeploy()
      const user = session.user
      const address = String(fields.address || selectedAddress?.place_name || '').trim()
      const payload = {
        id: deploymentId,
        asset_id: yardAsset.id,
        address,
        lat: coords.lat,
        lng: coords.lng,
        customer_id: customer.id,
        customer_name: customer.name || String(fields.customer || '').trim() || null,
        customer_phone: customer.phone || formatPhoneInput(fields.phone),
        notes: String(fields.notes || '').trim() || null,
        expires_at: fields.expires_at || null,
        dropped_at: new Date().toISOString(),
        deployed_by: user?.user_metadata?.full_name ?? user?.email ?? null,
      }

      await retryTransient(async () => {
        const result = await supabase.from('deployments').insert(payload)
        if (result.error?.code === '23505') {
          return throwSupabaseError(
            await supabase.from('deployments').select('id').eq('id', deploymentId).single()
          )
        }
        return throwSupabaseError(result)
      })

      const today = new Date().toISOString().slice(0, 10)
      supabase.from('reservations').delete().eq('asset_id', yardAsset.id).lte('from_date', today).gte('to_date', today)
        .then(({ error: reservationError }) => {
          if (reservationError) console.warn('Could not clear active reservation after voice deployment:', reservationError)
        })

      const label = yardAsset.label + (yardAsset.size ? ' ' + yardAsset.size : '')
      fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: label + ' deployed',
          body: address + (customer?.name ? ' · ' + customer.name : ''),
          url: '/',
          exclude_user_id: session.user.id,
        }),
      }).catch(() => {})

      if (activeDraft) {
        deleteVoiceDeployDraft(activeDraft.id, activeDraft.audio_path).catch(err => console.error('voice deploy draft cleanup failed:', err))
      }

      setSavingDeploy(false)
      setDeploymentId(newClientId())
      navigate('/', { state: { flyTo: [coords.lng, coords.lat] } })
    } catch (err) {
      console.error('voice deployment save failed:', err)
      setError(getErrorMessage(err, 'Could not deploy asset. Check your connection and try again.'))
      setSavingDeploy(false)
    }
  }

  function startOver() {
    setFields({ ...EMPTY_FIELDS })
    setHasDraft(false)
    setResolvedAssetId(null)
    setSelectedAddress(null)
    setAddressSuggestions([])
    setAddressError('')
    setFocusField(null)
    setError('')
    setPendingNote('')
    setCapture(null)
    setSavingDeploy(false)
    setDeploymentId(newClientId())
    if (activeDraft) {
      deleteVoiceDeployDraft(activeDraft.id, activeDraft.audio_path).catch(err => console.error('voice deploy draft cleanup failed:', err))
    }
    setActiveDraft(null)
  }

  const micDisabled = !supported || processing || savingDeploy || (hasDraft && !isOnline)

  const secondsLeft = MAX_RECORDING_SECONDS - duration
  const statusText = recording
    ? (secondsLeft <= RECORDING_WARN_SECONDS
        ? `${formatDuration(duration)} · stops in ${secondsLeft}s`
        : formatDuration(duration))
    : processing
      ? (hasDraft ? 'Updating…' : 'Transcribing…')
      : ''

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {!hasDraft ? (
          <div className="mx-auto w-full max-w-sm space-y-5 pt-6">
            <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={18} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Every deploy needs all three
                </p>
              </div>
              <ul className="text-sm font-medium space-y-2">
                <li className="flex items-center gap-2.5">
                  <User size={15} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  Real first and last name
                </li>
                <li className="flex items-center gap-2.5">
                  <Phone size={15} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  Real phone number
                </li>
                <li className="flex items-center gap-2.5">
                  <MapPin size={15} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  Real drop-off address
                </li>
              </ul>
              <p className="mt-2.5 text-xs text-amber-700/90 dark:text-amber-400/90">
                No nicknames, no "the usual", no guessing. Check every field before you save.
              </p>
            </div>

            <p className="text-center text-base text-muted-foreground">
              Tap the mic and say it all in one go.
            </p>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium text-primary/70 mb-1.5">New customer — say everything</p>
              <p className="text-sm italic leading-relaxed">
                "Deploy bin 6 to 203 County Rd 8 for John Smith, 705-555-0142."
              </p>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium text-primary/70 mb-1.5">Been here before? Just the number</p>
              <p className="text-sm italic leading-relaxed">
                "Deploy bin 6 to 705-555-0142."
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                A known phone number pulls up their name and last address. Tap to use it, then
                confirm the address.
              </p>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium text-primary/70 mb-1.5">Standing at the drop?</p>
              <p className="text-sm italic leading-relaxed">
                "Deploy bin 6 for John Smith, 705-555-0142, use my current location."
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Pins the exact spot you're at — best for rural addresses Mapbox gets wrong.
              </p>
            </div>

            {pendingNote && <p className="text-center text-sm text-amber-700 dark:text-amber-400">{pendingNote}</p>}
            {error && <p className="text-center text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4 vd-materialize">
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={startOver}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw size={13} />
                Start over
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <AlertCircle size={16} className="mt-0.5 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {deployedMatch && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 text-destructive flex-shrink-0" />
                <p className="text-sm">
                  <span className="font-medium">{deployedMatch.label}</span> is already deployed
                  {deployedMatch.customer_name ? ` to ${deployedMatch.customer_name}` : ''}
                  {deployedMatch.address ? ` at ${deployedMatch.address}` : ''}.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full" disabled title="Pickup not wired yet">
                Pick up {deployedMatch.label} first (coming soon)
              </Button>
            </div>
          )}

          <div className="rounded-lg border bg-card divide-y">
          <FieldRow
            icon={Package}
            label="Asset"
            value={deployedMatch ? deployedMatch.label : (fields.asset || 'Not caught')}
            state={status.asset}
            detail={deployedMatch
              ? `Already deployed${deployedMatch.customer_name ? ` to ${deployedMatch.customer_name}` : ''}${deployedMatch.address ? ` · ${deployedMatch.address}` : ''}`
              : undefined}
            focused={false}
            onClick={openAssetPicker}
            delayIndex={0}
          />

          <FieldRow
            icon={User}
            label="Customer"
            value={resolvedCustomer ? resolvedCustomer.name : (fields.customer || 'Not caught')}
            state={status.customer}
            detail={resolvedCustomer ? 'Phone matched saved customer' : fields.customer ? 'Will create new customer' : undefined}
            focused={focusField === 'customer'}
            onClick={() => setFocusField('customer')}
            delayIndex={1}
          />
          {focusField === 'customer' && (
            <div className="p-3 bg-muted/30">
              <Input autoFocus value={fields.customer} onChange={e => setField('customer', e.target.value)} placeholder="Customer name" />
            </div>
          )}

          <FieldRow
            icon={Mic}
            label="Phone"
            value={fields.phone ? formatPhone(fields.phone) : 'Not caught'}
            state={status.phone}
            detail={customerNameMismatch ? 'Phone number decides the customer' : undefined}
            focused={focusField === 'phone'}
            onClick={() => setFocusField('phone')}
            delayIndex={2}
          />
          {focusField === 'phone' && (
            <div className="p-3 space-y-2 bg-muted/30">
              <Input
                type="tel"
                autoFocus
                value={formatPhoneInput(fields.phone)}
                onChange={e => setField('phone', digitsOnly(e.target.value))}
                placeholder="Phone number"
              />
              {resolvedCustomer && !customerNameMismatch && (
                <div className="rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm">
                  <p className="font-medium">This will use {resolvedCustomer.name || 'the saved customer'}.</p>
                  <p className="mt-1 text-xs text-muted-foreground">This phone number matches a saved customer.</p>
                </div>
              )}
            </div>
          )}
          {customerNameMismatch && (
            <div className="border-t border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">This deploy will use {resolvedCustomer.name}.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The phone number is saved under {resolvedCustomer.name}. To use {fields.customer}, change the phone number.
              </p>
              <button type="button" onClick={applyCustomerMatch} className="mt-2 text-xs font-medium text-primary hover:underline">
                Change name back to {resolvedCustomer.name}
              </button>
            </div>
          )}

          <FieldRow
            icon={MapPin}
            label="Address"
            value={fields.address || 'Not caught'}
            state={status.address}
            detail={
              selectedAddress?.properties?.source === 'gps'
                ? `GPS pin · ±${selectedAddress.properties.accuracy_m}m`
                : selectedAddress ? 'Verified' : addressChecking ? 'Checking…' : fields.address ? 'Not verified' : undefined
            }
            focused={false}
            onClick={openAddressPicker}
            delayIndex={3}
          />

          <FieldRow
            icon={CalendarDays}
            label="Expected pickup"
            value={fields.expires_at || 'None'}
            state="optional"
            focused={focusField === 'expires_at'}
            onClick={() => setFocusField('expires_at')}
            delayIndex={4}
          />
          {focusField === 'expires_at' && (
            <div className="p-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  autoFocus
                  value={fields.expires_at}
                  min={todayDateInputValue()}
                  onChange={e => setField('expires_at', normalizeDateInput(e.target.value))}
                />
                {fields.expires_at && (
                  <button type="button" onClick={() => setField('expires_at', '')} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          )}

          <FieldRow
            icon={Package}
            label="Notes"
            value={fields.notes || 'None'}
            state="optional"
            focused={focusField === 'notes'}
            onClick={() => setFocusField('notes')}
            delayIndex={5}
          />
          {focusField === 'notes' && (
            <div className="p-3 bg-muted/30">
              <Textarea autoFocus value={fields.notes} onChange={e => setField('notes', e.target.value)} placeholder="Placement notes" rows={2} />
            </div>
          )}
            </div>

          </div>
        )}
      </div>

      <div className="border-t bg-background px-4 py-4 flex-shrink-0">
        {hasDraft && (
          <Button
            type="button"
            className="mb-3 w-full"
            onClick={handleDeploy}
            disabled={savingDeploy || recording || processing || !isOnline}
          >
            {savingDeploy ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
            {savingDeploy ? 'Deploying...' : 'Deploy Asset'}
          </Button>
        )}
        {statusText && (
          <p className={cn(
            'text-center text-sm mb-3',
            recording && secondsLeft <= RECORDING_WARN_SECONDS ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground',
          )}>
            {statusText}
          </p>
        )}
        <div className="relative mx-auto h-20 w-20">
          {processing && (
            <>
              <span className="vd-ring pointer-events-none absolute inset-0 rounded-full border-2 border-primary" />
              <span className="vd-ring pointer-events-none absolute inset-0 rounded-full border-2 border-primary" style={{ animationDelay: '0.55s' }} />
            </>
          )}
          <button
            type="button"
            onClick={recording ? stopCapture : startCapture}
            disabled={micDisabled}
            className={cn(
              'relative flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-50',
              recording ? 'bg-destructive animate-pulse' : 'bg-primary'
            )}
          >
            {processing ? <Loader2 size={30} className="animate-spin" /> : recording ? <Square size={30} fill="currentColor" /> : <Mic size={32} />}
          </button>
        </div>
        {!supported && <p className="text-center text-xs text-destructive mt-2">Recording is not supported in this browser.</p>}
      </div>

      {assetPickerOpen && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-background" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-3 border-b px-4 py-3 flex-shrink-0">
            <button type="button" onClick={() => setAssetPickerOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={20} />
            </button>
            <h2 className="text-lg font-semibold flex-1">Select asset</h2>
          </div>
          <div className="p-3 border-b flex-shrink-0">
            <Input value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="Search assets" />
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {pickerAssets.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                {yardAssets.length === 0 ? 'No assets loaded.' : 'No assets match that search.'}
              </p>
            )}
            {pickerAssets.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectAsset(item)}
                className={cn(
                  'w-full rounded-lg border bg-card px-3 py-3 text-left hover:bg-accent',
                  effectiveAssetId === item.id && 'border-primary bg-primary/5'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{item.label}</span>
                  {effectiveAssetId === item.id && <CheckCircle2 size={16} className="text-primary flex-shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground">{item.type_name}{item.size ? ` · ${item.size}` : ''}</p>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {addressPickerOpen && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-background" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-3 border-b px-4 py-3 flex-shrink-0">
            <button type="button" onClick={() => setAddressPickerOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={20} />
            </button>
            <h2 className="text-lg font-semibold flex-1">Delivery address</h2>
          </div>
          <div className="p-3 border-b flex-shrink-0 space-y-2">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={addressDraft}
                onChange={e => {
                  const value = e.target.value
                  setAddressDraft(value)
                  if (selectedAddress && value.trim() !== selectedAddress.place_name) setSelectedAddress(null)
                }}
                placeholder="Enter an address"
                className="pl-9 pr-9"
              />
              {addressChecking && (
                <Loader2 size={16} className="animate-spin pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => pinCurrentLocation()}
              disabled={gpsBusy}
            >
              {gpsBusy ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}
              {gpsBusy ? 'Getting your location…' : 'Use my location'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Standing at the drop? This pins the exact spot and keeps the address you said.
            </p>
            {!isOnline && <p className="text-xs text-muted-foreground">You're offline — address search needs a connection.</p>}
            {addressError && <p className="text-sm text-destructive">{addressError}</p>}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {addressDraft.trim().length < ADDRESS_SEARCH_MIN_CHARS ? (
              <p className="text-sm text-muted-foreground text-center py-8">Keep typing to search.</p>
            ) : (
              <>
                {!addressChecking && addressSuggestions.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No matches yet.</p>
                )}
                {addressSuggestions.map(feature => {
                  const selected = selectedAddress?.id === feature.id
                  return (
                    <button
                      key={feature.id}
                      type="button"
                      onClick={() => chooseAddress(feature)}
                      className={cn('w-full rounded-lg border bg-card px-3 py-3 text-left hover:bg-accent', selected && 'border-primary bg-primary/5')}
                    >
                      <div className="flex items-start gap-2">
                        {selected ? <CheckCircle2 size={16} className="mt-0.5 text-primary flex-shrink-0" /> : <MapPin size={16} className="mt-0.5 text-muted-foreground flex-shrink-0" />}
                        <span className="text-sm">{feature.place_name}</span>
                      </div>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function computeStatus({ fields, resolvedCustomer, effectiveAssetId, deployedMatch, selectedAddress }) {
  const phoneOk = digitsOnly(fields.phone).length === REQUIRED_PHONE_DIGITS
  const assetOk = !!effectiveAssetId
  const customerOk = !!resolvedCustomer || !!String(fields.customer || '').trim()
  const addressOk = !!selectedAddress

  const asset = assetOk ? 'resolved' : deployedMatch ? 'conflict' : fields.asset ? 'needs' : 'missing'
  const phone = phoneOk ? 'resolved' : 'missing'
  const customer = resolvedCustomer ? 'resolved' : fields.customer ? 'needs' : 'missing'
  const address = addressOk ? 'resolved' : fields.address ? 'needs' : 'missing'

  const gaps = FIELD_ORDER.filter(field => {
    if (field === 'asset') return !assetOk
    if (field === 'phone') return !phoneOk
    if (field === 'customer') return !customerOk
    if (field === 'address') return !addressOk
    return false
  })

  return { asset, phone, customer, address, gaps }
}

function FieldRow({ icon, label, value, state, detail, focused, onClick, delayIndex = 0 }) {
  const stateStyles = {
    resolved: 'text-green-700 dark:text-green-400',
    needs: 'text-amber-700 dark:text-amber-400',
    missing: 'text-destructive',
    conflict: 'text-destructive',
    optional: 'text-muted-foreground',
  }
  const stateIcon = {
    resolved: <CheckCircle2 size={16} />,
    needs: <AlertCircle size={16} />,
    missing: <AlertCircle size={16} />,
    conflict: <AlertCircle size={16} />,
    optional: null,
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex w-full items-center gap-3 px-3 py-3 text-left vd-row', focused && 'bg-primary/5')}
      style={{ animationDelay: `${delayIndex * 45}ms` }}
    >
      {createElement(icon, { size: 18, className: 'text-muted-foreground flex-shrink-0' })}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('text-sm font-medium truncate', state === 'missing' && 'text-muted-foreground')}>
          <span key={value} className="vd-value">{value}</span>
        </p>
        {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
      </div>
      <span className={cn('flex-shrink-0', stateStyles[state])}>{stateIcon[state]}</span>
    </button>
  )
}
