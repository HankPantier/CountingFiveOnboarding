import { requirePageAccess } from '@/lib/auth/page-guards'

// Onboarding is reachable by admins and managers; editors/auditors get 403.
// The sidebar shell lives in app/admin/layout.tsx.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePageAccess('manager')
  return <>{children}</>
}
