import { requirePageAccess } from '@/lib/auth/page-guards'

// Session (onboarding) detail is part of the Onboarding surface — admins and
// managers only; editors/auditors get 403. The sidebar shell lives in
// app/admin/layout.tsx.
export default async function SessionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePageAccess('manager')
  return <>{children}</>
}
