import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import type { Json } from '@/types/database'

// Fields that, when changed, invalidate any previously-approved generated
// content for this page — admin must re-review after a material outline edit.
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { pageId } = await params
  const body = await req.json()
  const supabase = createServerClient()

  // Load current row so we can detect material changes before writing.
  const { data: existing, error: loadErr } = await supabase
    .from('page_outlines')
    .select('id, content_job_id, page_url, h1, sections, cta')
    .eq('id', pageId)
    .single()
  if (loadErr || !existing) {
    return NextResponse.json({ error: loadErr?.message ?? 'Outline not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.h1 !== undefined) updates.h1 = body.h1
  if (body.sections !== undefined) {
    // sections must be a proper JSON array — never a string or object.
    if (!Array.isArray(body.sections)) {
      return NextResponse.json(
        { error: 'sections must be an array' },
        { status: 400 }
      )
    }
    updates.sections = body.sections as Json
  }
  if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes
  if (body.admin_approved !== undefined) updates.admin_approved = body.admin_approved
  if (body.cta !== undefined) {
    if (body.cta === null) {
      updates.cta = null
    } else if (
      body.cta && typeof body.cta === 'object' &&
      typeof body.cta.text === 'string' && typeof body.cta.url === 'string'
    ) {
      updates.cta = { text: body.cta.text, url: body.cta.url } as Json
    } else {
      return NextResponse.json({ error: 'cta must be null or { text, url }' }, { status: 400 })
    }
  }

  // Detect material outline changes against the existing row. Material =
  // anything that affects what the LLM would generate next (h1, sections, cta).
  // admin_approved/admin_notes don't count.
  const materialChanged =
    (body.h1 !== undefined && body.h1 !== existing.h1) ||
    (body.sections !== undefined && !deepEqual(body.sections, existing.sections)) ||
    (body.cta !== undefined && !deepEqual(body.cta ?? null, existing.cta))

  const { data, error } = await supabase
    .from('page_outlines')
    .update(updates)
    .eq('id', pageId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (materialChanged) {
    // Cascade-reset the matching generated_pages row's approval. Existing
    // copy stays in place so admin can compare and decide whether to
    // regenerate, but the package gate will block until they re-approve.
    const { error: cascadeErr } = await supabase
      .from('generated_pages')
      .update({ admin_approved_content: false, client_approved_content: false })
      .eq('content_job_id', existing.content_job_id)
      .eq('page_url', existing.page_url)
    if (cascadeErr) {
      console.warn(`[outline-patch] approval cascade failed for ${existing.page_url}:`, cascadeErr.message)
    }
  }

  return NextResponse.json({ outline: data, materialChanged })
}
