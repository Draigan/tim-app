import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VOICE_BUCKET = 'voice-deploy-audio'
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
const DEFAULT_PARSE_MODEL = 'gpt-5.5'
const MIN_AUDIO_BYTES = 40_000
// The client stops recording at 60s. This is the backstop so a long upload can
// never reach the transcription API and run up a bill.
const MAX_AUDIO_BYTES = 5_000_000
const TRANSCRIPTION_PROMPT = [
  'Dispatch for a dumpster and storage yard near Fenelon Falls, Ontario.',
  'Assets are called bins: bin 1, bin 6, bin 12. Also dumpsters, portables, trailers, bleachers.',
  'Example: Deploy bin 6 to 203 County Rd 8, Fenelon Falls for John Smith, 705-555-0142.',
].join(' ')

function supabaseUrl(): string {
  const url = Deno.env.get('APP_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('Supabase URL is not configured.')
  return url
}

function serviceRoleKey(): string {
  const appKey = Deno.env.get('APP_SUPABASE_SERVICE_ROLE_KEY')
  if (appKey) return appKey

  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!secretKeys) throw new Error('Supabase service key is not configured.')

  const parsed = JSON.parse(secretKeys) as Record<string, string>
  const firstKey = parsed.default ?? Object.values(parsed)[0]
  if (!firstKey) throw new Error('Supabase service key is not configured.')
  return firstKey
}

const supabaseAdmin = createClient(supabaseUrl(), serviceRoleKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
})

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fileNameFromPath(path: string, mimeType: string | null): string {
  const last = path.split('/').filter(Boolean).pop()
  if (last?.includes('.')) return last

  if (mimeType?.includes('mp4')) return 'voice-deploy.m4a'
  if (mimeType?.includes('aac')) return 'voice-deploy.aac'
  if (mimeType?.includes('mpeg')) return 'voice-deploy.mp3'
  if (mimeType?.includes('wav')) return 'voice-deploy.wav'
  if (mimeType?.includes('ogg')) return 'voice-deploy.ogg'
  return 'voice-deploy.webm'
}

function truncate(value: string, max = 1000): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function localDateISO(timeZone = 'America/Toronto'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return values.year + '-' + values.month + '-' + values.day
}

function responseOutputText(body: Record<string, unknown>): string {
  if (typeof body.output_text === 'string') return body.output_text.trim()

  const output = Array.isArray(body.output) ? body.output : []
  for (const item of output) {
    const content = Array.isArray((item as any)?.content) ? (item as any).content : []
    for (const part of content) {
      if (typeof part?.text === 'string') return part.text.trim()
    }
  }

  return ''
}

async function authorizeUser(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return { response: json({ error: 'Unauthorized' }, 401), user: null }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return { response: json({ error: 'Unauthorized' }, 401), user: null }

  return { response: null, user }
}

async function markDraft(draftId: string, values: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from('voice_deploy_drafts')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', draftId)

  if (error) console.error('voice draft status update failed', error)
}

async function transcribeAudio(params: {
  audio: Blob
  fileName: string
  mimeType: string | null
}): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OpenAI API key is not configured.')
  if (params.audio.size < MIN_AUDIO_BYTES) {
    throw new Error('That recording is too short or quiet to transcribe reliably.')
  }
  if (params.audio.size > MAX_AUDIO_BYTES) {
    throw new Error('That recording is too long. Keep it under a minute.')
  }

  const form = new FormData()
  form.append('model', Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') || DEFAULT_TRANSCRIPTION_MODEL)
  form.append('language', 'en')
  // Bias the transcriber toward yard vocabulary. Without this "bin six" comes
  // back as "pin six" and the asset never matches.
  form.append('prompt', TRANSCRIPTION_PROMPT)
  form.append('file', new File([params.audio], params.fileName, { type: params.mimeType || params.audio.type || 'audio/webm' }))

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  const body = await response.json().catch(async () => ({ error: { message: await response.text() } }))
  if (!response.ok) {
    const message = cleanText((body as any)?.error?.message) || `OpenAI transcription failed with ${response.status}`
    throw new Error(message)
  }

  const transcript = cleanText((body as any)?.text)
  if (!transcript) throw new Error('OpenAI transcription returned no text.')
  return transcript
}

async function fetchAssetHints(): Promise<string> {
  // Every non-archived asset, in-yard or deployed, so the parser can always
  // resolve a spoken asset to its real label. Deployment conflicts are handled
  // downstream on the client.
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('label, archived, asset_types(name)')
    .eq('archived', false)
    .order('label')

  if (error) {
    console.error('voice deploy asset hint load failed', error)
    return ''
  }

  return (data ?? [])
    .map((a) => {
      const typeName = (a as { asset_types?: { name?: string } }).asset_types?.name
      return typeName ? `${a.label} (${typeName})` : a.label
    })
    .filter(Boolean)
    .join(', ')
}

async function parseVoiceDeployTranscript(
  transcript: string,
  assetHints: string,
  context: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OpenAI API key is not configured.')

  const model = Deno.env.get('OPENAI_PARSE_MODEL') || DEFAULT_PARSE_MODEL
  const today = localDateISO()
  const input = context
    ? `Current draft: ${JSON.stringify(context)}\n\nCorrection to apply (spoken): ${transcript}`
    : transcript
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      input,
      instructions: [
        'Extract a draft asset deployment command from the transcript.',
        'If a "Current draft" is provided, treat the spoken correction as an update to it: return the complete set of fields, keeping every current value unless the correction changes it, and filling in any values the correction adds. Never drop an existing value that the correction does not mention.',
        'Only use information that is actually present in the transcript or the current draft.',
        'Do not infer customer names, local towns, or addresses.',
        'If a value is missing or unclear, return null and add a short warning.',
        'Normalize Canadian/US phone numbers to digits only, dropping a leading 1 when there are 11 digits.',
        'The asset may be spoken as bin 6, b 6, trailer 2, p 4, portable 4, bleacher 1, etc.',
        'We call the dumpsters "bins". Speech-to-text often mishears this: "pin 6", "been 6", "bing 6", "pen 6" and similar all mean "bin 6". Treat them as bin.',
        'Set asset_text to the raw spoken asset exactly as heard.',
        'Set address_text to the address as spoken. Also set address_query to a clean, single-line version suitable for a map geocoder: use digits for street and civic numbers, standard abbreviations (Rd, St, County Rd, Hwy), and append the town and province (ON) when known. If no address is present, set both to null.',
        'Today in America/Toronto is ' + today + '. If the transcript includes an expected pickup date or duration, such as "pickup tomorrow", "pick up Friday", "for 7 days", or "in two weeks", set expected_pickup_date to YYYY-MM-DD. If no pickup timing is mentioned or it is unclear, set expected_pickup_date to null.',
        'If the current draft includes address_candidates and the spoken correction points to one of them (by town, street number, or an ordinal such as "the first one" or "the Fenelon Falls one"), set selected_address_index to that candidate index. Otherwise set selected_address_index to null.',
        assetHints
          ? `Known assets (label and type): ${assetHints}. If the spoken asset clearly matches one of these labels, set asset_label to that exact label (for example "bin 6" or "bin six" should map to the label "b6", and "portable 6" or "portable six" should map to "p6"). If it does not clearly match any known asset, set asset_label to null and add a warning.`
          : 'Set asset_label to null.',
        'The address should not include the customer name or phone number.',
      ].join(' '),
      text: {
        format: {
          type: 'json_schema',
          name: 'voice_deploy_parse',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'intent',
              'asset_text',
              'asset_label',
              'address_text',
              'address_query',
              'expected_pickup_date',
              'selected_address_index',
              'customer_name',
              'customer_phone',
              'notes',
              'confidence',
              'warnings',
            ],
            properties: {
              intent: {
                type: 'string',
                enum: ['deploy_asset', 'other', 'unclear'],
              },
              asset_text: {
                type: ['string', 'null'],
                description: 'The raw spoken asset identifier, such as bin 6 or p4.',
              },
              asset_label: {
                type: ['string', 'null'],
                description: 'The exact matching label from the known yard assets, or null if none clearly matches.',
              },
              address_text: {
                type: ['string', 'null'],
                description: 'The spoken deployment address, without customer details.',
              },
              address_query: {
                type: ['string', 'null'],
                description: 'A clean, single-line, geocoder-ready address (digits, standard abbreviations, town, province).',
              },
              expected_pickup_date: {
                type: ['string', 'null'],
                description: 'Expected pickup date in YYYY-MM-DD format, or null when not mentioned or unclear.',
              },
              selected_address_index: {
                type: ['integer', 'null'],
                description: 'Index of the address candidate the correction selects, or null when none is chosen.',
              },
              customer_name: {
                type: ['string', 'null'],
                description: 'The spoken customer name.',
              },
              customer_phone: {
                type: ['string', 'null'],
                description: 'Digits only phone number, usually 10 digits.',
              },
              notes: {
                type: ['string', 'null'],
                description: 'Any placement notes or extra instructions.',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
              },
              warnings: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    }),
  })

  const body = await response.json().catch(async () => ({ error: { message: await response.text() } })) as Record<string, unknown>
  if (!response.ok) {
    const message = cleanText((body as any)?.error?.message) || `OpenAI parse failed with ${response.status}`
    throw new Error(message)
  }

  const text = responseOutputText(body)
  if (!text) throw new Error('OpenAI parse returned no text.')

  const parsed = JSON.parse(text) as Record<string, unknown>
  return {
    version: 1,
    source: 'openai_responses',
    model,
    parsed_at: new Date().toISOString(),
    ...parsed,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const { response: authError, user } = await authorizeUser(req)
  if (authError || !user) return authError

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const draftId = cleanText(body.draftId)
  if (!draftId) return json({ error: 'draftId required' }, 400)

  const context = body.context && typeof body.context === 'object'
    ? body.context as Record<string, unknown>
    : null

  const { data: draft, error: draftError } = await supabaseAdmin
    .from('voice_deploy_drafts')
    .select('id, user_id, audio_path, audio_mime_type, status')
    .eq('id', draftId)
    .maybeSingle()

  if (draftError) return json({ error: draftError.message }, 500)
  if (!draft) return json({ error: 'Draft not found.' }, 404)
  if (draft.user_id !== user.id) return json({ error: 'Draft not found.' }, 404)

  await markDraft(draftId, { status: 'transcribing', error_message: null })

  try {
    const { data: audio, error: downloadError } = await supabaseAdmin
      .storage
      .from(VOICE_BUCKET)
      .download(draft.audio_path)

    if (downloadError || !audio) throw new Error(downloadError?.message || 'Could not download audio.')

    const transcript = await transcribeAudio({
      audio,
      fileName: fileNameFromPath(draft.audio_path, draft.audio_mime_type),
      mimeType: draft.audio_mime_type,
    })

    let parseResult: Record<string, unknown> | null = null
    let parseError: string | null = null

    try {
      const assetHints = await fetchAssetHints()
      parseResult = await parseVoiceDeployTranscript(transcript, assetHints, context)
    } catch (err) {
      parseError = truncate(err instanceof Error ? err.message : String(err))
      console.error('voice deploy parse failed', { draftId, message: parseError })
    }

    const updatedAt = new Date().toISOString()
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('voice_deploy_drafts')
      .update({
        status: parseError ? 'parse_failed' : 'transcribed',
        transcript,
        parse_result: parseResult,
        error_message: parseError,
        updated_at: updatedAt,
      })
      .eq('id', draftId)
      .select('id, status, transcript, parse_result, error_message, updated_at')
      .single()

    if (updateError) throw updateError

    return json({ ok: true, draft: updated })
  } catch (err) {
    const message = truncate(err instanceof Error ? err.message : String(err))
    console.error('voice deploy processing failed', { draftId, message })
    await markDraft(draftId, { status: 'failed', error_message: message })
    return json({ error: message }, 500)
  }
})
