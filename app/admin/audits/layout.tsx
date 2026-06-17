import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'

// Site audits are an admin-only internal tool (security rule 6 / plan §3.3).
// The sidebar shell lives in app/admin/layout.tsx.
export default async function AuditsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') redirect('/admin/dashboard')
  return <>{children}</>
}
