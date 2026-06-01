export const ADMIN_EMAILS = ['tim@timberfell.ca']

export function userHasAppRole(user, role) {
  const metadata = user?.app_metadata ?? {}
  if (metadata.role === role) return true

  const roles = metadata.roles
  if (Array.isArray(roles)) return roles.includes(role)
  if (roles && typeof roles === 'object') return Boolean(roles[role])

  return false
}

export function isAdminUser(user) {
  const email = user?.email?.toLowerCase()
  return userHasAppRole(user, 'admin') || ADMIN_EMAILS.includes(email)
}
