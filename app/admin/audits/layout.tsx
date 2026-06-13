import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import AdminHeader from '@/components/admin/AdminHeader'

// Site audits are an admin-only internal tool (security rule 6 / plan §3.3).
export default async function AuditsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') redirect('/admin/dashboard')

  return (
    <div className="min-h-screen bg-surface-page">
      <AdminHeader role={user.role} />
      {children}
    </div>
  )
}
