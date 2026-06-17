import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import AdminHeader from '@/components/admin/AdminHeader'

// Auth-gated but NOT role-gated: both admins and managers manage their own
// account here (unlike the admin-only /admin/settings subtree).
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  return (
    <div className="min-h-screen bg-surface-page">
      <AdminHeader role={user.role} />
      {children}
    </div>
  )
}
