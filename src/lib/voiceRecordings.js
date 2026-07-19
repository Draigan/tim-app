import { newClientId } from '@/lib/utils'

const DB_NAME = 'tim-voice-deploy'
const DB_VERSION = 1
const RECORDINGS_STORE = 'recordings'

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Saved recordings are not available in this browser.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        const store = db.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open saved recordings.'))
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Saved recording transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saved recording transaction was aborted.'))
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Saved recording request failed.'))
  })
}

export async function saveVoiceRecording({ blob, type, duration, createdAt }) {
  const db = await openDb()
  const audio = await blob.arrayBuffer()
  const recording = {
    id: newClientId(),
    createdAt,
    type,
    duration,
    size: blob.size,
    audio,
  }

  try {
    const transaction = db.transaction(RECORDINGS_STORE, 'readwrite')
    transaction.objectStore(RECORDINGS_STORE).put(recording)
    await transactionDone(transaction)
    return recording
  } finally {
    db.close()
  }
}

export async function listVoiceRecordings() {
  const db = await openDb()

  try {
    const transaction = db.transaction(RECORDINGS_STORE, 'readonly')
    const rows = await requestResult(transaction.objectStore(RECORDINGS_STORE).getAll())
    return (rows ?? []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  } finally {
    db.close()
  }
}

export async function updateVoiceRecording(id, patch) {
  const db = await openDb()

  try {
    const transaction = db.transaction(RECORDINGS_STORE, 'readwrite')
    const store = transaction.objectStore(RECORDINGS_STORE)
    const current = await requestResult(store.get(id))
    if (!current) throw new Error('Saved recording not found.')

    const next = { ...current, ...patch }
    store.put(next)
    await transactionDone(transaction)
    return next
  } finally {
    db.close()
  }
}

export async function deleteVoiceRecording(id) {
  const db = await openDb()

  try {
    const transaction = db.transaction(RECORDINGS_STORE, 'readwrite')
    transaction.objectStore(RECORDINGS_STORE).delete(id)
    await transactionDone(transaction)
  } finally {
    db.close()
  }
}
