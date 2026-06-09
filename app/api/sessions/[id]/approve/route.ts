import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { NextResponse } from 'next/server'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth
  const user = auth.user

  const { id } = await params

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'approved') {
    return NextResponse.json({ error: 'Session already approved' }, { status: 409 })
  }
  if (session.status !== 'completed') {
    return NextResponse.json({ error: 'Session is not completed' }, { status: 400 })
  }

  try {
    // Generate PDF + MD — non-fatal: a failure must not block approval.
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

    await supabase
      .from('sessions')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        content_generation_ready: true,
        pdf_url: pdfStoragePath,
      })
      .eq('id', id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Approve]', err)
    const message = err instanceof Error ? err.message : 'Approval failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
