import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DRAFT_BRANCH, listTree } from '@/lib/github/repo-files'
import { pickRepresentativePages } from '@/lib/design/pages'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'

// GET the client's live pages + the default preview picks for the Design
// Studio page picker. Admin-only. Read from DRAFT (what the next build ships).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const tree = await listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/pages/')
    const paths = tree.filter((e) => e.type === 'blob').map((e) => e.path)
    return NextResponse.json(pickRepresentativePages(paths))
  } catch (err) {
    return internalError('design:pages', err, 'Failed to list the site pages')
  }
}
