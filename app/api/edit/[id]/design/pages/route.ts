import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { specimenUnlocked } from '@/lib/design/capabilities'
import { readEffectiveCapabilities } from '@/lib/design/capabilities-read'
import { DRAFT_BRANCH, listTree } from '@/lib/github/repo-files'
import { pickRepresentativePages } from '@/lib/design/pages'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'

// GET the client's live pages + the default preview picks for the Design
// Studio page picker. Admin-only. Read from DRAFT; the specimen pick needs
// the effective (draft ∩ live shell) tier, since the page must exist on the
// deployed site the renderer loads.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const [tree, caps] = await Promise.all([
      listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/pages/'),
      readEffectiveCapabilities({ githubRepo: ctx.githubRepo, jobId: ctx.jobId }),
    ])
    const paths = tree.filter((e) => e.type === 'blob').map((e) => e.path)
    return NextResponse.json(pickRepresentativePages(paths, { specimen: specimenUnlocked(caps.effective) }))
  } catch (err) {
    return internalError('design:pages', err, 'Failed to list the site pages')
  }
}
