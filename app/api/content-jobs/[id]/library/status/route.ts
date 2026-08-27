import { NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { getLibrarySelectionStatus } from '@/lib/content/library-inclusion'

export const runtime = 'nodejs'

// Progress + completion-gate snapshot for a job's included library articles.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireContentJobAccess(id)
  if (ctx instanceof NextResponse) return ctx

  return NextResponse.json(await getLibrarySelectionStatus(id))
}
