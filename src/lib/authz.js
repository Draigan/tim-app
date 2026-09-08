export const ROLES = {
  SUPERUSER: 'superuser',
  OWNER: 'owner',
  DRIVER: 'driver',
  ACCOUNTANT: 'accountant',
}

export const ROLE_LABELS = {
  [ROLES.SUPERUSER]: 'Superuser',
  [ROLES.OWNER]: 'Owner',
  [ROLES.DRIVER]: 'Driver',
  [ROLES.ACCOUNTANT]: 'Accountant',
}

export const ASSIGNABLE_ROLES = [
  { value: ROLES.OWNER, label: ROLE_LABELS[ROLES.OWNER] },
  { value: ROLES.DRIVER, label: ROLE_LABELS[ROLES.DRIVER] },
  { value: ROLES.ACCOUNTANT, label: ROLE_LABELS[ROLES.ACCOUNTANT] },
]

export const SUPERUSER_EMAILS = ['d@d.d']
export const OWNER_EMAILS = ['tim@timberfell.ca']
export const DRIVER_EMAILS = ['beau@timberfell.ca']
// The accountant is locked to the Online Payments portal only — no other part
// of the app is reachable for this role.
export const ACCOUNTANT_EMAILS = ['neil@timberfell.ca']
// Accounts whose time inside the Storage section is timed and reported to the
// superuser. Superusers are never tracked.
export const STORAGE_WATCH_EMAILS = ['tim@timberfell.ca']

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
  if (userHasAppRole(user, ROLES.ACCOUNTANT)) return ROLES.ACCOUNTANT
  if (OWNER_EMAILS.includes(email)) return ROLES.OWNER
  if (DRIVER_EMAILS.includes(email)) return ROLES.DRIVER
  if (ACCOUNTANT_EMAILS.includes(email)) return ROLES.ACCOUNTANT

  return null
}

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? 'No role'
}

export function isSuperuser(user) {
  return getUserRole(user) === ROLES.SUPERUSER
}

export function isStorageWatched(user) {
  const email = normalizedEmail(user)
  if (!email || SUPERUSER_EMAILS.includes(email)) return false
  return STORAGE_WATCH_EMAILS.includes(email)
}

export function isOwner(user) {
  const role = getUserRole(user)
  return role === ROLES.SUPERUSER || role === ROLES.OWNER
}

export function isDriver(user) {
  return getUserRole(user) === ROLES.DRIVER
}

export function isAccountant(user) {
  return getUserRole(user) === ROLES.ACCOUNTANT
}

export function isAdminUser(user) {
  return isOwner(user)
}

export function getUserAccess(user) {
  const role = getUserRole(user)
  const superuser = role === ROLES.SUPERUSER
  const owner = role === ROLES.OWNER
  const driver = role === ROLES.DRIVER
  const accountant = role === ROLES.ACCOUNTANT
  const manager = superuser || owner
  const staff = superuser || owner || driver

  return {
    role,
    roleLabel: roleLabel(role),
    isSuperuser: superuser,
    isOwner: owner,
    isDriver: driver,
    isAccountant: accountant,
    canUseApp: staff,
    // The accountant portal is a read-only Online Payments export area. The
    // accountant sees only this; superusers can reach it too.
    canAccessAccountantPortal: superuser || accountant,
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
    // Owners and drivers can use voice deploy outright. The owner trial pitch
    // is cosmetic and does not gate access.
    canUseVoiceDeploy: superuser || owner || driver,
  }
}
