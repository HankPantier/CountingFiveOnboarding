import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'nodejs'

// GitHub repo slugs: alphanumeric + `.`, `_`, `-`. Optional one-level
// `owner/name` form is allowed so the same DB column can hold either
// `acmetax-site` (defaults to GITHUB_ORG) or `countingfive/acmetax-site`.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
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
  const nextValue: string | null = trimmed === '' ? null : trimmed

  if (nextValue !== null && !SLUG_RE.test(nextValue)) {
    return NextResponse.json(
      { error: 'Invalid repo slug. Use "name" or "owner/name" with alphanumerics, dots, hyphens, underscores.' },
      { status: 400 }
    )
  }
  if (nextValue !== null && nextValue.length > 100) {
    return NextResponse.json({ error: 'Repo slug too long' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Enforce uniqueness at the API layer too so we can surface a clean
  // error message before Postgres's partial unique index does it.
  if (nextValue !== null) {
    const { data: existing } = await supabase
      .from('content_jobs')
      .select('id')
      .eq('github_repo', nextValue)
      .neq('id', id)
      .maybeSingle()
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
