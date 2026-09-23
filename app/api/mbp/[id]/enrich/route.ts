import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { preGenEnrichMbp } from '@/lib/mbp/pre-gen-enrichment'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only: proactively deepen the content-critical MBP fields from the site
// audit + call notes BEFORE content generation, queuing pending suggestions for
// review. Mirrors the backfill route's auth + shape.
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

  const { created, applied } = await preGenEnrichMbp(id)
  return NextResponse.json({ created, applied })
}
