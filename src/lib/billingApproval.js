export function promptBillingPin() {
  const pin = window.prompt('Enter billing PIN')
  return pin?.trim() || null
}

export function newBillingRequestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
