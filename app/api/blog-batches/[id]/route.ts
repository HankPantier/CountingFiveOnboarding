import { NextResponse } from 'next/server'
import { requireAdminUser, getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { isContentType } from '@/lib/content/content-types'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PatchBody {
  contentType?: string
}

// PATCH /api/blog-batches/[id] — re-classify a batch's content type
// (e.g. Blog → Article). Relabel only: it updates the stored content_type on the
// batch, every target, and each linked resource idea so a future (re)draft uses
// the new type's format rules. It does NOT rewrite already-committed drafts —
// that happens on an explicit regenerate.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Reclassifying rewrites the type a future draft will use — a content power,
  // so manager-gated (admins hold every capability) like batch creation.
  if (!hasCapability(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!isContentType(body.contentType)) {
    return NextResponse.json({ error: 'A valid contentType is required' }, { status: 400 })
  }
  const contentType = body.contentType

  const supabase = createServerClient()

  const { data: batch } = await supabase.from('blog_batches').select('id').eq('id', id).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Scope: a manager may only reclassify a batch that includes one of their
  // assigned clients (mirrors the list's visibility). Admins pass (allowed=null).
  const allowed = await getAccessibleSessionIds(user)
  if (allowed !== null) {
    if (allowed.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { data: mine } = await supabase
      .from('blog_batch_targets')
      .select('id')
      .eq('batch_id', id)
      .in('session_id', allowed)
      .limit(1)
    if (!mine || mine.length === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const now = new Date().toISOString()
  const { error: batchErr } = await supabase
    .from('blog_batches')
    .update({ content_type: contentType, updated_at: now })
    .eq('id', id)
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 })

  // Cascade to the batch's targets and their linked ideas — the ideas are what
  // generateResourceDraft reads at draft time, so this is what actually changes
  // the format rules of a future regenerate.
  const { data: targets } = await supabase
    .from('blog_batch_targets')
    .select('resource_idea_id')
    .eq('batch_id', id)

  await supabase
    .from('blog_batch_targets')
    .update({ content_type: contentType, updated_at: now })
    .eq('batch_id', id)

  const ideaIds = (targets ?? [])
    .map((t) => t.resource_idea_id)
    .filter((v): v is string => !!v)
  if (ideaIds.length) {
    await supabase
      .from('resource_ideas')
      .update({ content_type: contentType, updated_at: now })
      .in('id', ideaIds)
  }

  return NextResponse.json({ success: true, contentType })
}

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
