import { redirect } from 'next/navigation'
import { getCurrentUser, hasCapability } from '@/lib/auth/access'
import AuditBatchProgress from './AuditBatchProgress'

export const runtime = 'nodejs'

export default async function AuditBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Reachable by admins and auditor-capability members; per-batch ownership is
  // enforced by the /status endpoint (auditors get a 403/404 for others' batches).
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasCapability(user, 'auditor')) redirect('/admin/audits')

  const { id } = await params
  return <AuditBatchProgress batchId={id} />
}
