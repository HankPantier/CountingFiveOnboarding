import { NextResponse } from 'next/server'
import { requireSessionAccess, canPublish } from '@/lib/auth/access'
import { resolveBlogConfig } from '@/lib/content/blog-config'
import {
  loadBlogSettingsForSession,
  syncBlogConfigToRepo,
} from '@/lib/content/blog-settings-repo-sync'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PutBody {
  path?: unknown
  label?: unknown
  title?: unknown
  intro?: unknown
}

// Load the session's blog-landing config (repo content/blog.json → defaults).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  const record = await loadBlogSettingsForSession(sessionId)
  return NextResponse.json({
    path: record.path,
    label: record.label,
    title: record.title,
    intro: record.intro,
    published: record.published,
    hasRepo: !!record.githubRepo,
  })
}

// Save blog config to the repo draft branch. Writing to draft feeds a live
// publish, so this is gated to publishers (admin, manager, owner) — editors 403.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth
  if (!canPublish(auth.user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const record = await loadBlogSettingsForSession(sessionId)
  if (!record.githubRepo) {
    return NextResponse.json(
      { error: 'This site is not provisioned yet — the blog landing can be set once the repo exists.' },
      { status: 409 }
    )
  }

  // normalizeBlogPath (inside resolveBlogConfig) coerces an invalid/malformed
  // path back to /resources, so the write can never target an unsafe route.
  const config = resolveBlogConfig(body)
  const result = await syncBlogConfigToRepo({
    githubRepo: record.githubRepo,
    config,
    actor: { name: auth.user.name, email: auth.user.email },
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Failed to save' }, { status: 502 })
  }
  return NextResponse.json({ ...config, published: record.published, synced: true })
}
