import { redirect } from 'next/navigation'
import { getCurrentUser, hasCapability } from '@/lib/auth/access'
import BlogBatchProgress from './BlogBatchProgress'

export default async function BlogBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasCapability(user, 'manager')) redirect('/admin/dashboard')

  const { id } = await params
  // Per-client access scoping is enforced by the /status endpoint (managers get
  // a filtered view or 403).
  return <BlogBatchProgress batchId={id} />
}
