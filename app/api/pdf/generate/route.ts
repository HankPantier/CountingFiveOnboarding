export const runtime = 'nodejs'
export const maxDuration = 30

import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { generateAndStoreMbp } from '@/lib/mbp/generate-deliverable'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId } = await req.json() as { sessionId: string }
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  try {
    const { pdfStoragePath, mdStoragePath } = await generateAndStoreMbp(supabase, sessionId)
    return NextResponse.json({ pdfStoragePath, mdStoragePath })
  } catch (err) {
    console.error('[MBP Generation]', err)
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
