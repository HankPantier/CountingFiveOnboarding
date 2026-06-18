import { redirect } from 'next/navigation'
import { getCurrentUser, hasCapability } from '@/lib/auth/access'

// Site audits are reachable by admins and users with the `auditor` capability.
// The sidebar shell lives in app/admin/layout.tsx.
export default async function AuditsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasCapability(user, 'auditor')) redirect('/admin/dashboard')
  return <>{children}</>
}
