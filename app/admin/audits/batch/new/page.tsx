import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import { NewBatchAuditForm } from '@/components/admin/audit/NewBatchAuditForm'

export const runtime = 'nodejs'

export default async function NewBatchAuditPage() {
  // The audits layout already gates to auditor+; batch auditing is admin-only.
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!user.isAdmin) redirect('/admin/audits')

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/admin/audits" className="font-body text-sm text-text-secondary hover:text-text-primary">
        ← Back to audits
      </Link>
      <h1 className="mt-4 font-heading text-2xl font-bold text-brand-navy">Batch Site Audit</h1>
      <p className="mt-1 font-body text-sm text-text-secondary">
        Paste up to 25 URLs. They&apos;re queued and audited one at a time, each producing its own
        shareable report.
      </p>
      <div className="mt-8 rounded-lg border border-border-default bg-surface-card p-6 shadow-subtle">
        <NewBatchAuditForm />
      </div>
    </main>
  )
}
