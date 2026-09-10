import { supabase } from './supabase'
import { fetchWithTimeout, NetworkError, REQUEST_TIMEOUT_MS } from './network'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const RETRY_DELAY_MS = 700

// Anything that talks to Stripe on the way answers well after a normal request
// would have. Cutting those off early is worse than waiting.
export const SLOW_FUNCTION_TIMEOUT_MS = 45_000

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calls an edge function with an access token, a deadline, and — where the
 * caller says a repeat is safe — a retry.
 *
 * `attempts` is opt-in on purpose: most of these functions send a text, a push,
 * or a charge, and sending one twice is worse than reporting a failure. Only
 * reads and calls that carry their own idempotency key ask for more than one.
 *
 * Returns the Response, so callers keep reading the body the way they always
 * have. Network-level failures throw a NetworkError that already reads well
 * enough to put in front of a user.
 */
export async function callFunction(name, {
  body,
  method = 'POST',
  headers,
  attempts = 1,
  timeoutMs = REQUEST_TIMEOUT_MS,
  signal,
  token,
} = {}) {
  let accessToken = token
  if (accessToken === undefined) {
    const { data: { session } } = await supabase.auth.getSession()
    accessToken = session?.access_token ?? null
  }

  const url = `${FUNCTIONS_URL}/${name}`
  const payload = body === undefined || typeof body === 'string' ? body : JSON.stringify(body)
  const init = {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(payload === undefined ? {} : { body: payload }),
    signal,
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs)
      if (attempt < attempts && isTransientStatus(res.status)) {
        lastError = new NetworkError(`${name} is busy. Try again in a moment.`)
        await wait(RETRY_DELAY_MS * attempt)
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt >= attempts || !(err instanceof NetworkError) || signal?.aborted) throw err
      await wait(RETRY_DELAY_MS * attempt)
    }
  }

  throw lastError
}

/**
 * The common shape: call the function, read its JSON, and turn anything that is
 * not a success into an Error carrying the function's own reason.
 */
export async function callFunctionJson(name, options = {}) {
  const res = await callFunction(name, options)

  let data = null
  try {
    data = await res.json()
  } catch {
    // A body that is not JSON only matters when the call also failed.
  }

  if (!res.ok || data?.error) {
    throw new Error(data?.error || `${name} failed (${res.status}).`)
  }
  return data
}

// supabase-js reports every failed `functions.invoke` as "Failed to send a
// request to the Edge Function", which tells a user nothing. A dropped
// connection is by far the most common cause, so name it.
export function isFunctionsFetchError(error) {
  return error?.name === 'FunctionsFetchError' ||
    /failed to send a request to the edge function/i.test(String(error?.message ?? ''))
}
