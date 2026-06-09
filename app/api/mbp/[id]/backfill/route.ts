import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { backfillMbpFromProfile } from '@/lib/mbp/backfill'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only: derive values for empty MBP fields from existing profile data
// and queue them as pending suggestions for review.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { created } = await backfillMbpFromProfile(id)
  return NextResponse.json({ created })
}
