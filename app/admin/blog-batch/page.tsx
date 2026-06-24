import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-success/10 text-success',
    error: 'bg-error/10 text-error',
    generating: 'bg-info/10 text-info',
  }
  const label: Record<string, string> = {
    complete: 'Complete',
    error: 'Error',
    generating: 'Generating',
  }
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold ${
        map[status] ?? 'bg-surface-subtle text-text-muted'
      }`}
    >
      {label[status] ?? status}
    </span>
  )
}

export default async function BlogBatchListPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasCapability(user, 'manager')) redirect('/admin/dashboard')

  const supabase = createServerClient()
  const allowed = await getAccessibleSessionIds(user)

  // Managers see only batches that include one of their assigned clients.
  let accessibleBatchIds: string[] | null = null
  if (allowed !== null) {
    const { data: tgts } = allowed.length
      ? await supabase.from('blog_batch_targets').select('batch_id').in('session_id', allowed)
      : { data: [] }
    accessibleBatchIds = [...new Set((tgts ?? []).map((t) => t.batch_id))]
  }

  let batches: Array<{ id: string; title: string; target_keyword: string | null; status: string; created_at: string }> = []
  if (accessibleBatchIds === null || accessibleBatchIds.length > 0) {
    let query = supabase
      .from('blog_batches')
      .select('id, title, target_keyword, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (accessibleBatchIds !== null) query = query.in('id', accessibleBatchIds)
    const { data } = await query
    batches = data ?? []
  }

  // Per-batch client tallies for the list (total selected vs. drafted).
  const countByBatch = new Map<string, { total: number; complete: number }>()
  const listedIds = batches.map((b) => b.id)
  if (listedIds.length) {
    const { data: tgts } = await supabase
      .from('blog_batch_targets')
      .select('batch_id, status')
      .in('batch_id', listedIds)
    for (const t of tgts ?? []) {
      const c = countByBatch.get(t.batch_id) ?? { total: 0, complete: 0 }
      c.total += 1
      if (t.status === 'complete') c.complete += 1
      countByBatch.set(t.batch_id, c)
    }
  }

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Blog Batch</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            Write one blog idea across many clients — each version tailored to that client&rsquo;s profile.
          </p>
        </div>
        <Link
          href="/admin/blog-batch/new"
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-5 py-3 rounded-pill transition-all hover:bg-brand-cyan-dark"
        >
          New batch
        </Link>
      </div>

      {batches.length === 0 ? (
        <div className="text-center py-16 text-text-muted font-body">
          No batches yet. Start one to fan a blog idea out to multiple clients.
        </div>
      ) : (
        <div className="bg-surface-card border border-border-default rounded-lg shadow-subtle overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10">
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Idea</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Keyword</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Clients</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Created</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr
                  key={b.id}
                  className={`border-b border-border-default last:border-0 hover:bg-brand-cyan/10 transition-colors ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}
                >
                  <td className="px-4 py-3 font-body text-text-primary font-semibold max-w-md truncate">{b.title}</td>
                  <td className="px-4 py-3 text-text-secondary">{b.target_keyword ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                    {(() => {
                      const c = countByBatch.get(b.id)
                      if (!c) return '—'
                      return `${c.total} client${c.total === 1 ? '' : 's'} · ${c.complete} drafted`
                    })()}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/blog-batch/${b.id}`}
                      className="inline-flex items-center border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
