import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import AdminHeader from '@/components/admin/AdminHeader'

export default async function DashboardLayout({
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
