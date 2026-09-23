import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { generateFirmSynopsis } from '@/lib/mbp/generate-synopsis'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only: (re)generate the human-readable firm synopsis shown at the top of
// the MBP page. On demand only — never auto-runs.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await generateFirmSynopsis(id)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ synopsis: result.text })
}
