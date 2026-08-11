import { forbidden, redirect } from 'next/navigation'
import { getCurrentUser, hasCapability, type Capability, type CurrentUser } from './access'

// What a page/section requires:
//   'any'          — any authenticated admin-table user
//   'admin'        — admins only
//   a Capability   — admins plus members holding that capability
//   a Capability[] — admins plus members holding ANY of those capabilities
export type PageRequires = 'any' | 'admin' | Capability | Capability[]

// Server-component / layout gate. Unauthenticated → redirect to login.
// Authenticated but lacking the requirement → hard HTTP 403 via forbidden()
// (renders app/forbidden.tsx). Mirrors the nav visibility rules in
// AdminSidebar so the pages a user can't see are also pages they can't visit.
// Returns the CurrentUser so callers can reuse it (getCurrentUser is
// React.cache-d, so a second call in the page is free).
export async function requirePageAccess(requires: PageRequires): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const ok =
    requires === 'any'
      ? true
      : requires === 'admin'
        ? user.isAdmin
        : Array.isArray(requires)
          ? requires.some((c) => hasCapability(user, c))
          : hasCapability(user, requires)

  if (!ok) forbidden()
  return user
}
