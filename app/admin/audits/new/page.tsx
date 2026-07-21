import Link from 'next/link'
import { NewAuditForm } from '@/components/admin/audit/NewAuditForm'

export const runtime = 'nodejs'

export default function NewAuditPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/admin/audits" className="font-body text-sm text-text-secondary hover:text-text-primary">
        ← Back to audits
      </Link>
      <h1 className="mt-4 font-heading text-2xl font-bold text-brand-navy">Run a Site Audit</h1>
      <p className="mt-1 font-body text-sm text-text-secondary">
        Crawls the site, scores it across nine categories, and saves a shareable report.
      </p>
      <div className="mt-8 rounded-xl border border-border-default bg-surface-card p-6 shadow-subtle">
        <NewAuditForm />
      </div>
    </main>
  )
}
