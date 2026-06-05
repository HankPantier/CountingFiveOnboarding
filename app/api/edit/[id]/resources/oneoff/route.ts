import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { generateOneOff } from '@/lib/content/oneoff-generator'
import { checkBrandFit, OFF_BRAND_MARKER } from '@/lib/content/brand-fit'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_PROMPT_LENGTH = 500
const HISTORY_LIMIT = 20

interface OneOffBody {
  prompt?: string
  overrideBrandFit?: boolean
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: OneOffBody
  try {
    body = (await req.json()) as OneOffBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` },
      { status: 400 }
    )
  }
  const overrideBrandFit = body.overrideBrandFit === true

  const supabase = createServerClient()

  // Brand-fit gate — same contract as brainstorm seeds and draft notes.
  if (!overrideBrandFit) {
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', ctx.sessionId)
      .single()
    const fit = await checkBrandFit({
      text: prompt,
      schema: (session?.schema_data ?? {}) as SessionSchema,
      contentJobId: ctx.jobId,
      sessionId: ctx.sessionId,
    })
    if (fit.fit === 'off-brand') {
      return NextResponse.json({ brandFit: fit }, { status: 409 })
    }
  }

  const { data: row, error } = await supabase
    .from('oneoff_generations')
    .insert({
      content_job_id: ctx.jobId,
      session_id: ctx.sessionId,
      prompt: overrideBrandFit ? `${OFF_BRAND_MARKER}\n${prompt}` : prompt,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create generation' }, { status: 500 })
  }

  after(async () => {
    try {
      await generateOneOff(row.id)
    } catch (err) {
      console.error('[oneoff] Trigger failed:', err)
    }
  })

  return NextResponse.json({ id: row.id })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('oneoff_generations')
    .select('id, prompt, context, options, status, error, created_at')
    .eq('content_job_id', ctx.jobId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ generations: data ?? [] })
}
