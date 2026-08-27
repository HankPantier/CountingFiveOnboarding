import { getCurrentUser, hasOnboardingAccess, isSiteOwner } from '@/lib/auth/access'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopBar from '@/components/admin/AdminTopBar'

// Shell for every /admin/* route. Renders the dark sidebar + sticky top bar for
// authenticated users. Unauthenticated requests (e.g. /admin/login) render bare
// — auth redirects live in the individual section layouts/pages, so this layout
// must NOT redirect or it would loop on the login page itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) return <>{children}</>

  // Site Owners live entirely inside their one site's editor — no admin sidebar
  // or search chrome (which links to sections they can't reach). Their editor
  // carries its own top bar with a sign-out control.
  if (isSiteOwner(user)) return <>{children}</>

  return (
    <div className="flex min-h-screen bg-surface-page">
      <AdminSidebar isAdmin={user.isAdmin} capabilities={user.capabilities} userName={user.name ?? undefined} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AdminTopBar userName={user.name ?? undefined} searchAction={hasOnboardingAccess(user) ? '/admin/dashboard' : '/admin/content'} />
        {children}
      </div>
    </div>
  )
}
