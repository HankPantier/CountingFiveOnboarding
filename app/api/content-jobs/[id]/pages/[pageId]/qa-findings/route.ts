import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { requireContentJobAccess } from '@/lib/auth/access'
import { reviewContentForMbpImpact } from '@/lib/mbp/impact-review'
import { fenceQaForHumanEdit } from '@/lib/content/qa/fence'
import { parseQaReview } from '@/types/qa-review'
import { applyOneFinding } from '@/lib/content/qa/apply-finding'

interface QaFindingActionBody { findingId?: unknown; action?: unknown }

// Human Apply/Dismiss on ONE QA finding. An apply that changes content is a
// human-approved content edit: fence QA out before writing (same as the page
// PATCH route) and run the MBP impact review afterward.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth
  const sessionId = auth.sessionId

  const body = await readJsonBody<QaFindingActionBody>(req)
  if (body instanceof NextResponse) return body
  if (typeof body.findingId !== 'string' || (body.action !== 'apply' && body.action !== 'dismiss')) {
    return NextResponse.json({ error: 'findingId and action (apply|dismiss) are required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: row, error } = await supabase
    .from('generated_pages')
    .select('content_markdown, meta_title, meta_description, qa_review, page_url')
    .eq('id', pageId).eq('content_job_id', id).maybeSingle()
  if (error) return internalError('qa-findings:load', error, "Couldn't load the page")
  if (!row) return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  const review = parseQaReview(row.qa_review)
  if (!review) return NextResponse.json({ error: 'This page has no QA report' }, { status: 409 })

  const result = applyOneFinding(
    { body: row.content_markdown ?? '', metaTitle: row.meta_title, metaDescription: row.meta_description },
    review, body.findingId, body.action,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })

  const contentChanged = result.fields.body !== (row.content_markdown ?? '')
    || result.fields.metaTitle !== row.meta_title
    || result.fields.metaDescription !== row.meta_description

  // A human edit wins over QA: fence QA out BEFORE writing, so an in-flight QA
  // write can't land between this update and the fence and overwrite the
  // human's text (same ordering as the page PATCH route).
  if (contentChanged) {
    await fenceQaForHumanEdit(supabase, pageId, { contentJobId: id })
  }

  // CAS on the content we read, so a concurrent edit makes this 409 instead of
  // clobbering it.
  let q = supabase.from('generated_pages').update({
    qa_review: asJson(result.review),
    ...(contentChanged ? {
      content_markdown: result.fields.body,
      meta_title: result.fields.metaTitle,
      meta_description: result.fields.metaDescription,
      admin_approved_content: false,
    } : {}),
  }).eq('id', pageId).eq('content_job_id', id)
  q = row.content_markdown === null ? q.is('content_markdown', null) : q.eq('content_markdown', row.content_markdown)
  const { data: updated, error: upErr } = await q.select('*')
  if (upErr) return internalError('qa-findings:save', upErr, "Couldn't save the change")
  if (!updated?.length) return NextResponse.json({ error: 'The page changed while you were reviewing — reload and try again.' }, { status: 409 })

  const saved = updated[0]
  if (contentChanged && typeof saved.content_markdown === 'string') {
    after(() =>
      reviewContentForMbpImpact({
        sessionId,
        origin: 'page_edit',
        sourceRef: saved.page_url ?? pageId,
        changedText: saved.content_markdown ?? '',
      }).catch(err => console.error('[mbp-impact] page_edit review failed:', err))
    )
  }

  return NextResponse.json({ page: saved, qaReview: result.review })
}
