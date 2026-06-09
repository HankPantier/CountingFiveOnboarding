import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { generateResourceDraft } from '@/lib/content/resource-draft-generator'
import { reviewContentForMbpImpact } from '@/lib/mbp/impact-review'
import { checkBrandFit, OFF_BRAND_MARKER } from '@/lib/content/brand-fit'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NOTES_LENGTH = 500

interface DraftBody {
  notes?: string
  overrideBrandFit?: boolean
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ideaId: string }> }
) {
  const { id, ideaId } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!UUID_RE.test(ideaId)) {
    return NextResponse.json({ error: 'Invalid idea id' }, { status: 400 })
  }

  let notes: string | undefined
  let overrideBrandFit = false
  try {
    const body = (await req.json()) as DraftBody
    if (body && typeof body.notes === 'string' && body.notes.trim()) {
      if (body.notes.trim().length > MAX_NOTES_LENGTH) {
        return NextResponse.json(
          { error: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer` },
          { status: 400 }
        )
      }
      notes = body.notes.trim()
    }
    overrideBrandFit = body?.overrideBrandFit === true
  } catch {
    // No body — draft without notes.
  }

  const supabase = createServerClient()
  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('id, status, draft_status')
    .eq('id', ideaId)
    .eq('content_job_id', ctx.jobId)
    .single()
  if (!idea) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }
  if (idea.status === 'dismissed') {
    return NextResponse.json({ error: 'Idea is dismissed' }, { status: 409 })
  }
  // Defense in depth over the SQL lock inside generateResourceDraft.
  if (idea.draft_status === 'running') {
    return NextResponse.json({ error: 'Draft already in progress' }, { status: 409 })
  }

  // Brand-fit gate on writer notes — the other place an admin can pull the
  // engine off the documented voice. Conflicts block (409) until overridden.
  if (notes && !overrideBrandFit) {
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', ctx.sessionId)
      .single()
    const fit = await checkBrandFit({
      text: notes,
      schema: (session?.schema_data ?? {}) as SessionSchema,
      contentJobId: ctx.jobId,
      sessionId: ctx.sessionId,
    })
    if (fit.fit === 'off-brand') {
      return NextResponse.json({ brandFit: fit }, { status: 409 })
    }
  }

  // Persist notes for the detached worker. An approved off-brand direction
  // is recorded as a marker line the drafting prompt understands.
  const storedNotes = notes
    ? overrideBrandFit
      ? `${OFF_BRAND_MARKER}\n${notes}`
      : notes
    : null

  // Drafting implies approval — record it so the lifecycle reads correctly
  // even if the admin skipped the explicit Approve step.
  await supabase
    .from('resource_ideas')
    .update({
      ...(idea.status === 'suggested' ? { status: 'approved' as const } : {}),
      draft_notes: storedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ideaId)

  after(async () => {
    try {
      await generateResourceDraft(ideaId)
    } catch (err) {
      console.error('[resource-draft] Trigger failed:', err)
    }
  })
  if (notes) {
    after(() =>
      reviewContentForMbpImpact({
        sessionId: ctx.sessionId,
        origin: 'resource',
        sourceRef: 'draft notes',
        changedText: notes,
      }).catch(err => console.error('[mbp-impact] resource review failed:', err))
    )
  }

  return NextResponse.json({ success: true })
}
