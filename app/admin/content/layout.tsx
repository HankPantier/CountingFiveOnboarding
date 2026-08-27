import { requirePageAccess } from '@/lib/auth/page-guards'

// Content is reachable by admins and every content role — managers, editors, and
// site owners. (The content list page redirects owners straight to their editor.)
// The sidebar shell lives in app/admin/layout.tsx.
export default async function ContentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePageAccess(['manager', 'editor', 'owner'])
  return <>{children}</>
}
