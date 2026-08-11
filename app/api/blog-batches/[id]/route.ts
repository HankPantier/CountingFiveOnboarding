import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// DELETE /api/blog-batches/[id] — remove a batch (admins only). The
// ON DELETE CASCADE FK drops blog_batch_targets; the per-client resource_ideas
// and any drafts already committed to each client's repo are left intact — this
// only removes the batch grouping.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  const supabase = createServerClient()
  const { data, error } = await supabase.from('blog_batches').delete().eq('id', id).select('id')

  if (error) {
    console.error('[blog-batch] delete failed:', error.message)
    return NextResponse.json({ error: 'Failed to delete batch' }, { status: 500 })
  }
  if (!data?.length) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
