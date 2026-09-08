import { supabase } from '@/lib/supabase'
import { newClientId, throwSupabaseError } from '@/lib/utils'

export const VOICE_DEPLOY_BUCKET = 'voice-deploy-audio'

function extensionForType(type) {
  if (type?.includes('mp4')) return 'm4a'
  if (type?.includes('aac')) return 'aac'
  if (type?.includes('mpeg')) return 'mp3'
  if (type?.includes('wav')) return 'wav'
  if (type?.includes('ogg')) return 'ogg'
  return 'webm'
}

function baseMimeType(type) {
  return String(type || 'audio/webm').split(';')[0].trim() || 'audio/webm'
}

async function currentUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Sign in required.')
  return data.user
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function errorMessageFromBody(body) {
  if (!body || typeof body !== 'object') return ''
  return cleanText(body.error)
    || cleanText(body.message)
    || cleanText(body.error?.message)
}

async function readableFunctionError(error, response) {
  const source = response || error?.context
  let message = ''

  try {
    const clone = typeof source?.clone === 'function' ? source.clone() : null
    const contentType = clone?.headers?.get('Content-Type') ?? ''
    if (clone && contentType.includes('application/json')) {
      message = errorMessageFromBody(await clone.json())
    } else if (clone) {
      message = cleanText(await clone.text())
    }
  } catch {
    // Keep the Supabase error if the response body is unavailable.
  }

  if (!message) return error

  const next = new Error(message)
  next.name = error?.name || 'FunctionsHttpError'
  next.cause = error
  if (typeof source?.status === 'number') next.status = source.status
  return next
}

async function fetchDraft(draftId) {
  const result = await supabase
    .from('voice_deploy_drafts')
    .select('id, audio_path, audio_mime_type, audio_size, status, transcript, parse_result, error_message, updated_at')
    .eq('id', draftId)
    .single()

  return throwSupabaseError(result).data
}

export async function uploadAndTranscribeVoiceRecording(recording, context = null) {
  if (!recording?.blob) throw new Error('No recording selected.')

  const user = await currentUser()
  const draftId = newClientId()
  const type = baseMimeType(recording.type || recording.blob.type || 'audio/webm')
  const path = `${user.id}/${draftId}.${extensionForType(type)}`

  throwSupabaseError(await supabase.storage
    .from(VOICE_DEPLOY_BUCKET)
    .upload(path, recording.blob, {
      contentType: type,
      upsert: false,
    }))

  const inserted = throwSupabaseError(await supabase
    .from('voice_deploy_drafts')
    .insert({
      id: draftId,
      user_id: user.id,
      audio_path: path,
      audio_mime_type: type,
      audio_size: recording.size || recording.blob.size || null,
      status: 'uploaded',
    })
    .select('id, audio_path, audio_mime_type, audio_size, status, transcript, parse_result, error_message, updated_at')
    .single()).data

  const { data, error, response } = await supabase.functions.invoke('process-voice-deploy', {
    body: context ? { draftId, context } : { draftId },
  })

  if (error) {
    const invokeError = await readableFunctionError(error, response)
    try {
      return { draft: await fetchDraft(draftId), error: invokeError }
    } catch {
      return { draft: inserted, error: invokeError }
    }
  }

  return { draft: data?.draft ? { ...inserted, ...data.draft } : await fetchDraft(draftId), error: null }
}

export async function deleteVoiceDeployDraft(draftId, audioPath) {
  if (audioPath) {
    const { error } = await supabase.storage.from(VOICE_DEPLOY_BUCKET).remove([audioPath])
    if (error) console.error('voice deploy audio delete failed', error)
  }
  if (draftId) {
    const { error } = await supabase.from('voice_deploy_drafts').delete().eq('id', draftId)
    if (error) console.error('voice deploy draft delete failed', error)
  }
}

export async function updateVoiceDeployDraftReview(draftId, parseResult) {
  if (!draftId) throw new Error('No voice deploy draft selected.')

  const result = await supabase
    .from('voice_deploy_drafts')
    .update({
      parse_result: parseResult,
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftId)
    .select('id, audio_path, audio_mime_type, audio_size, status, transcript, parse_result, error_message, updated_at')
    .single()

  return throwSupabaseError(result).data
}
