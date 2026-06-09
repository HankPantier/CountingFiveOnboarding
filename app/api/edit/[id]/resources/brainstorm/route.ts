import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { generateResourceIdeas } from '@/lib/content/resource-idea-generator'
import { reviewContentForMbpImpact } from '@/lib/mbp/impact-review'
import { checkBrandFit } from '@/lib/content/brand-fit'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_SEED_LENGTH = 300

interface BrainstormBody {
  seed?: string
  overrideBrandFit?: boolean
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // Body is optional: no body (or empty) = open brainstorm; { seed } =
  // extrapolate the admin's base idea.
  let seed: string | undefined
  let overrideBrandFit = false
  try {
    const body = (await req.json()) as BrainstormBody
    if (body && typeof body.seed === 'string' && body.seed.trim()) {
      if (body.seed.trim().length > MAX_SEED_LENGTH) {
        return NextResponse.json(
          { error: `Seed idea must be ${MAX_SEED_LENGTH} characters or fewer` },
          { status: 400 }
        )
      }
      seed = body.seed.trim()
    }
    overrideBrandFit = body?.overrideBrandFit === true
  } catch {
    // No JSON body — open brainstorm.
  }

  // Brand-fit gate: an admin seed can pull generation off the documented
  // voice. Conflicts block here (409) until explicitly overridden.
  if (seed && !overrideBrandFit) {
    const supabase = createServerClient()
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', ctx.sessionId)
      .single()
    const fit = await checkBrandFit({
      text: seed,
      schema: (session?.schema_data ?? {}) as SessionSchema,
      contentJobId: ctx.jobId,
      sessionId: ctx.sessionId,
    })
    if (fit.fit === 'off-brand') {
      return NextResponse.json({ brandFit: fit }, { status: 409 })
    }
  }

  const offBrandApproved = !!seed && overrideBrandFit
  after(async () => {
    try {
      await generateResourceIdeas(ctx.jobId, ctx.sessionId, { seed, offBrandApproved })
    } catch (err) {
      console.error('[resource-ideas] Brainstorm failed:', err)
    }
  })
  // Only an admin-provided seed carries intent worth reviewing against the MBP;
  // open brainstorms generate blog ideas that don't alter the firm profile.
  if (seed) {
    after(() =>
      reviewContentForMbpImpact({
        sessionId: ctx.sessionId,
        origin: 'resource',
        sourceRef: 'brainstorm seed',
        changedText: seed,
      }).catch(err => console.error('[mbp-impact] resource review failed:', err))
    )
  }

  return NextResponse.json({ success: true })
}
