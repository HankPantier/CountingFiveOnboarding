import { requirePageAccess } from '@/lib/auth/page-guards'

// The global no-go-phrases registry is admin-only (global content-policy surface).
export default async function NoGoPhrasesLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess('admin')
  return <>{children}</>
}
