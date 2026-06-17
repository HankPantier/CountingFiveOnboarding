import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'

// Auth-gated but NOT role-gated: both admins and managers manage their own
// account here. The sidebar shell lives in app/admin/layout.tsx.
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  return <>{children}</>
}
