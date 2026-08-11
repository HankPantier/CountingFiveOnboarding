import { requirePageAccess } from '@/lib/auth/page-guards'

// Token usage (AI spend) is admin-only; everyone else gets 403. The sidebar
// shell lives in app/admin/layout.tsx.
export default async function TokenUsageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePageAccess('admin')
  return <>{children}</>
}
