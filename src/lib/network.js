// One place for the rules every network call in the app follows: a request that
// cannot finish has to fail quickly and say why, instead of hanging until the
// browser gives up on its own (which on a phone can take minutes and looks like
// the app is frozen).

export const REQUEST_TIMEOUT_MS = 20_000

const OFFLINE_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const TIMEOUT_MESSAGE = 'The request timed out. Check your connection and try again.'

// Marks an error as worth retrying without having to match on message text,
// which differs between browsers ("Failed to fetch" vs "Load failed").
export class NetworkError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'NetworkError'
    this.status = 0
    this.retryable = true
    this.cause = cause
  }
}

const TRANSIENT_MESSAGES = [
  'failed to fetch',
  'load failed',
  'networkerror',
  'network request failed',
  'network connection was lost',
  'the internet connection appears to be offline',
  'timeout',
  'timed out',
  'temporarily unavailable',
  'failed to send a request to the edge function',
]

// True for the failures that mean "the request never made it", whatever wording
// the browser chose. Kept here so both the error reporter and the user-facing
// message helper agree on what counts as noise.
export function isTransientNetworkMessage(value) {
  const text = String(value ?? '').toLowerCase()
  return TRANSIENT_MESSAGES.some(phrase => text.includes(phrase))
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

/**
 * Runs fetch with a deadline. A caller-supplied signal still aborts the request;
 * the two are combined rather than one replacing the other.
 */
export async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const outerSignal = init.signal
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const forwardAbort = () => controller.abort()
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort()
    else outerSignal.addEventListener('abort', forwardAbort, { once: true })
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    // Only our own deadline becomes a timeout error. An abort the caller asked
    // for is passed through untouched so cancellation still reads as
    // cancellation.
    if (timedOut && isAbortError(err)) throw new NetworkError(TIMEOUT_MESSAGE, err)
    if (isAbortError(err)) throw err
    throw new NetworkError(OFFLINE_MESSAGE, err)
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', forwardAbort)
  }
}
