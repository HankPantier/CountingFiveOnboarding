import { createAuthClient, createServerClient } from '@/lib/supabase/server'
import { createBasecampProject } from '@/lib/basecamp/create-project'
import { NextResponse } from 'next/server'

// Set BASECAMP_ENABLED=true in .env.local (and Vercel) when ready to go live
const BASECAMP_ENABLED = process.env.BASECAMP_ENABLED === 'true'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createAuthClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'completed') {
    return NextResponse.json({ error: 'Session is not completed' }, { status: 400 })
  }
  if (session.basecamp_project_id) {
    return NextResponse.json({ error: 'Session already approved' }, { status: 409 })
  }

  try {
    // Generate PDF + MD
    let pdfStoragePath: string | null = null
    try {
      const genRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/pdf/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      })
      if (genRes.ok) {
        const genData = await genRes.json() as { pdfStoragePath?: string }
        pdfStoragePath = genData.pdfStoragePath ?? null
      }
    } catch (err) {
      console.warn('[Approve] PDF/MD generation failed (non-fatal):', err)
    }

    // Basecamp integration — enable by setting BASECAMP_ENABLED=true in env
    let basecampProjectId: string | null = null
    if (BASECAMP_ENABLED) {
      basecampProjectId = await createBasecampProject(session, pdfStoragePath)
    } else {
      console.log('[Approve] Basecamp disabled — skipping project creation')
    }

    await supabase
      .from('sessions')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.email ?? user.id,
        basecamp_project_id: basecampProjectId,
        content_generation_ready: true,
        pdf_url: pdfStoragePath,
      })
      .eq('id', id)

    return NextResponse.json({ success: true, basecampProjectId })
  } catch (err) {
    console.error('[Approve]', err)
    const message = err instanceof Error ? err.message : 'Approval failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
