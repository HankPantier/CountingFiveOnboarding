import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { generateResourceIdeas } from '@/lib/content/resource-idea-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  after(async () => {
    try {
      await generateResourceIdeas(ctx.jobId, ctx.sessionId)
    } catch (err) {
      console.error('[resource-ideas] Brainstorm failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
