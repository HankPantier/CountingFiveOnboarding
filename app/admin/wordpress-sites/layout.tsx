import { requirePageAccess } from '@/lib/auth/page-guards'

// WordPress blog-sync registry is admin-only (destructive/global surface).
export default async function WordpressSitesLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess('admin')
  return <>{children}</>
}
