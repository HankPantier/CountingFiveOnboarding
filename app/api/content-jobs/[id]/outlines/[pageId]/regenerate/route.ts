import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { generateOutlineForPage } from '@/lib/content/outline-generator'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id, pageId } = await params
  const supabase = createServerClient()

  // Load outline
  const { data: outline } = await supabase
    .from('page_outlines')
    .select('id, page_url, page_title, content_job_id')
    .eq('id', pageId)
    .single()

  if (!outline) {
    return NextResponse.json({ error: 'Outline not found' }, { status: 404 })
  }

  // Load session and job data
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, palette')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', job.session_id)
    .single()

  const schema = (session?.schema_data ?? {}) as SessionSchema
  const palette = (job.palette ?? null) as PaletteData | null

  // Clear existing and regenerate
  await supabase
    .from('page_outlines')
    .update({ h1: null, sections: '[]', admin_approved: false, admin_notes: null, updated_at: new Date().toISOString() })
    .eq('id', pageId)

  try {
    await generateOutlineForPage(
      outline.id,
      outline.page_title,
      outline.page_url,
      outline.content_job_id,
      schema,
      palette
    )

    const { data: updated } = await supabase
      .from('page_outlines')
      .select('*')
      .eq('id', pageId)
      .single()

    return NextResponse.json({ outline: updated })
  } catch (err) {
    console.error('[outline-regen] Failed:', err)
    return NextResponse.json({ error: 'Regeneration failed' }, { status: 500 })
  }
}
