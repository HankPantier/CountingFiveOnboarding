import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'

// Auth gate only — the sidebar shell lives in app/admin/layout.tsx.
export default async function SessionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  return <>{children}</>
}
