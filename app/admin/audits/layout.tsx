import { requirePageAccess } from '@/lib/auth/page-guards'

// Site audits are reachable by admins and users with the `auditor` capability;
// everyone else gets 403. The sidebar shell lives in app/admin/layout.tsx.
export default async function AuditsLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess('auditor')
  return <>{children}</>
}
