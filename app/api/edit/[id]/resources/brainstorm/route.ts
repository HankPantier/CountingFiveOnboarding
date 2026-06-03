import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { generateResourceIdeas } from '@/lib/content/resource-idea-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_SEED_LENGTH = 300

interface BrainstormBody {
  seed?: string
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
  } catch {
    // No JSON body — open brainstorm.
  }

  after(async () => {
    try {
      await generateResourceIdeas(ctx.jobId, ctx.sessionId, { seed })
    } catch (err) {
      console.error('[resource-ideas] Brainstorm failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
