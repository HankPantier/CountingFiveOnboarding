import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import AuditBatchProgress from './AuditBatchProgress'

export const runtime = 'nodejs'

export default async function AuditBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // The audits layout gates to auditor+; batch auditing is admin-only.
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!user.isAdmin) redirect('/admin/audits')

  const { id } = await params
  return <AuditBatchProgress batchId={id} />
}
