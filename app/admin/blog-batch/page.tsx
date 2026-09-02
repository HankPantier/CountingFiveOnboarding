import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import BatchContentTable, { type BatchContentRow } from './BatchContentTable'

export default async function BlogBatchListPage() {
  // Capability enforcement (manager/admin, else 403) lives in the section layout.
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

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

  let batches: Array<{
    id: string
    title: string
    target_keyword: string | null
    status: string
    content_type: string | null
    industry: string | null
    created_at: string
  }> = []
  if (accessibleBatchIds === null || accessibleBatchIds.length > 0) {
    let query = supabase
      .from('blog_batches')
      .select('id, title, target_keyword, status, content_type, industry, created_at')
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

  const rows: BatchContentRow[] = batches.map((b) => {
    const c = countByBatch.get(b.id)
    return {
      id: b.id,
      title: b.title,
      targetKeyword: b.target_keyword,
      status: b.status,
      contentType: b.content_type,
      industry: b.industry,
      createdAt: b.created_at,
      clientsTotal: c?.total ?? 0,
      clientsComplete: c?.complete ?? 0,
    }
  })

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Batch Content</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            Write one blog idea across many clients — each version tailored to that client&rsquo;s profile.
          </p>
        </div>
        <Link
          href="/admin/blog-batch/new"
          className="rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow"
        >
          New batch
        </Link>
      </div>

      {batches.length === 0 ? (
        <div className="text-center py-16 text-text-muted font-body">
          No batches yet. Start one to fan a blog idea out to multiple clients.
        </div>
      ) : (
        <BatchContentTable
          rows={rows}
          isAdmin={user.isAdmin}
          canReclassify={hasCapability(user, 'manager')}
        />
      )}
    </main>
  )
}
