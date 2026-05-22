import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  ensureDraftBranch,
  readFile,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const url = new URL(req.url)
  const path = url.searchParams.get('path')
  if (!path) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }
  // Lock writes to content/ so the editor cannot leak into other paths.
  if (!path.startsWith('content/')) {
    return NextResponse.json({ error: 'path must be under content/' }, { status: 400 })
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const blob = await readFile(ctx.githubRepo, path, DRAFT_BRANCH)
    return NextResponse.json(blob)
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
