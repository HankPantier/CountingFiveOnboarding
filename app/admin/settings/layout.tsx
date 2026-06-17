import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'

// Settings is admin-only; managers never reach it. The sidebar shell lives in
// app/admin/layout.tsx.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') redirect('/admin/dashboard')
  return <>{children}</>
}
