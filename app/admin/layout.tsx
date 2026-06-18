import { getCurrentUser } from '@/lib/auth/access'
import AdminSidebar from '@/components/admin/AdminSidebar'

// Shell for every /admin/* route. Renders the collapsible sidebar for
// authenticated users. Unauthenticated requests (e.g. /admin/login) render
// bare — auth redirects live in the individual section layouts/pages, so this
// layout must NOT redirect or it would loop on the login page itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) return <>{children}</>

  return (
    <div className="min-h-screen bg-surface-page flex">
      <AdminSidebar isAdmin={user.isAdmin} capabilities={user.capabilities} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
