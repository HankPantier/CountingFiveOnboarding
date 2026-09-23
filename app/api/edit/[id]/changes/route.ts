import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { resolveEditContext } from '../_helpers'
import { getDraftChanges } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

// GET — the unpublished changes: every file the draft branch changed relative
// to live (main), each with its status, diff, and who last edited it / when.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    const { files } = await getDraftChanges(ctx.githubRepo)
    return NextResponse.json({ files })
  } catch (err) {
    return internalError('edit:changes', err, "Couldn't load pending changes")
  }
}
