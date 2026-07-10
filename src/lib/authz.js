export const ROLES = {
  SUPERUSER: 'superuser',
  OWNER: 'owner',
  DRIVER: 'driver',
}

export const ROLE_LABELS = {
  [ROLES.SUPERUSER]: 'Superuser',
  [ROLES.OWNER]: 'Owner',
  [ROLES.DRIVER]: 'Driver',
}

export const ASSIGNABLE_ROLES = [
  { value: ROLES.OWNER, label: ROLE_LABELS[ROLES.OWNER] },
  { value: ROLES.DRIVER, label: ROLE_LABELS[ROLES.DRIVER] },
]

export const SUPERUSER_EMAILS = ['d@d.d']
export const OWNER_EMAILS = ['tim@timberfell.ca']
export const DRIVER_EMAILS = ['beau@timberfell.ca']

function normalizedEmail(userOrEmail) {
  const email = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail?.email
  return email?.trim().toLowerCase() ?? ''
}

export function userHasAppRole(user, role) {
  const metadata = user?.app_metadata ?? {}
  if (metadata.role?.toLowerCase?.() === role) return true

  const roles = metadata.roles
  if (Array.isArray(roles)) return roles.map(String).map(r => r.toLowerCase()).includes(role)
  if (roles && typeof roles === 'object') return Boolean(roles[role])

  return false
}

export function isProtectedSuperuserEmail(userOrEmail) {
  return SUPERUSER_EMAILS.includes(normalizedEmail(userOrEmail))
}

export function getUserRole(user) {
  const email = normalizedEmail(user)
  if (SUPERUSER_EMAILS.includes(email)) return ROLES.SUPERUSER

  const role = user?.app_metadata?.role?.toLowerCase?.()
  if (Object.values(ROLES).includes(role)) return role

  if (role === 'admin' || role === 'billing' || role === 'billing_admin') return ROLES.OWNER
  if (role === 'staff') return ROLES.DRIVER

  if (userHasAppRole(user, ROLES.SUPERUSER)) return ROLES.SUPERUSER
  if (userHasAppRole(user, ROLES.OWNER) || userHasAppRole(user, 'admin')) return ROLES.OWNER
  if (userHasAppRole(user, ROLES.DRIVER) || userHasAppRole(user, 'staff')) return ROLES.DRIVER
  if (OWNER_EMAILS.includes(email)) return ROLES.OWNER
  if (DRIVER_EMAILS.includes(email)) return ROLES.DRIVER

  return null
}

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? 'No role'
}

export function isSuperuser(user) {
  return getUserRole(user) === ROLES.SUPERUSER
}

export function isOwner(user) {
  const role = getUserRole(user)
  return role === ROLES.SUPERUSER || role === ROLES.OWNER
}

export function isDriver(user) {
  return getUserRole(user) === ROLES.DRIVER
}

export function isAdminUser(user) {
  return isOwner(user)
}

export function getUserAccess(user) {
  const role = getUserRole(user)
  const superuser = role === ROLES.SUPERUSER
  const owner = role === ROLES.OWNER
  const driver = role === ROLES.DRIVER
  const manager = superuser || owner
  const staff = superuser || owner || driver

  return {
    role,
    roleLabel: roleLabel(role),
    isSuperuser: superuser,
    isOwner: owner,
    isDriver: driver,
    canUseApp: staff,
    canManageUsers: superuser,
    canViewStorage: manager,
    canManageStorage: superuser,
    canManageRevenue: superuser,
    canManageBilling: superuser,
    canManageAssets: manager,
    canManageCalendar: manager,
    canViewHistory: manager,
    canRequestReviews: manager,
    canViewNotifications: manager,
  }
}
