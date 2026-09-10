import { createClient } from '@supabase/supabase-js'
import { fetchWithTimeout, NetworkError, REQUEST_TIMEOUT_MS } from './network'

const RETRY_DELAY_MS = 600

function isReadOnly(input, init) {
  const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase()
  return method === 'GET' || method === 'HEAD'
}

// Every request the client makes — queries, auth token refreshes, storage,
// edge functions — goes through here, so none of them can hang forever. Reads
// get one silent retry: on a phone the first request after the screen wakes
// often dies while the radio is still coming back.
async function supabaseFetch(input, init) {
  try {
    return await fetchWithTimeout(input, init, REQUEST_TIMEOUT_MS)
  } catch (err) {
    if (!(err instanceof NetworkError) || !isReadOnly(input, init) || init?.signal?.aborted) throw err
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    return fetchWithTimeout(input, init, REQUEST_TIMEOUT_MS)
  }
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: supabaseFetch } }
)
