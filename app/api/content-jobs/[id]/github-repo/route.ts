import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { resolveRepo } from '@/lib/github/app-client'

export const runtime = 'nodejs'

// GitHub repo slugs: alphanumeric + `.`, `_`, `-`. Optional one-level
// `owner/name` form is allowed so the same DB column can hold either
// `acmetax-site` (defaults to GITHUB_ORG) or `countingfive/acmetax-site`.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/

// Canonical `owner/name`, lowercased (GitHub slugs are case-insensitive). Bare
// `name` resolves against GITHUB_ORG, so `acme-site` and `org/Acme-Site` are the
// same repo and must collide. Null for a value that can't be resolved.
function canonicalRepo(slug: string): string | null {
  try {
    const { owner, repo } = resolveRepo(slug)
    return `${owner}/${repo}`.toLowerCase()
  } catch {
    return null
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Linking a repo points the whole publish pipeline (commits, deploys) at it —
  // admin-only.
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  let body: { githubRepo?: string | null }
  try {
    body = (await req.json()) as { githubRepo?: string | null }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body.githubRepo
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  let nextValue: string | null = trimmed === '' ? null : trimmed

  if (nextValue !== null && !SLUG_RE.test(nextValue)) {
    return NextResponse.json(
      { error: 'Invalid repo slug. Use "name" or "owner/name" with alphanumerics, dots, hyphens, underscores.' },
      { status: 400 }
    )
  }
  if (nextValue !== null && nextValue.length > 100) {
    return NextResponse.json({ error: 'Repo slug too long' }, { status: 400 })
  }

  if (nextValue !== null) {
    const canonical = canonicalRepo(nextValue)
    if (!canonical) return NextResponse.json({ error: 'Invalid repo slug' }, { status: 400 })
    nextValue = canonical
  }

  const supabase = createServerClient()

  // Enforce uniqueness on the CANONICAL form: a raw `.eq` let `Acme-Site`,
  // `acme-site` and `org/acme-site` all link the same repo to different jobs.
  if (nextValue !== null) {
    const { data: others } = await supabase
      .from('content_jobs')
      .select('id, github_repo')
      .not('github_repo', 'is', null)
      .neq('id', id)
    const existing = (others ?? []).find((j) => j.github_repo && canonicalRepo(j.github_repo) === nextValue)
    if (existing) {
      return NextResponse.json(
        { error: `Repo "${nextValue}" is already linked to another content job.` },
        { status: 409 }
      )
    }
  }

  const { data, error } = await supabase
    .from('content_jobs')
    .update({ github_repo: nextValue, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, github_repo')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id, githubRepo: data.github_repo })
}
