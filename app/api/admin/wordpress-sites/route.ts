import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { readJsonBody } from '@/app/api/_json'
import { generateSiteSecret } from '@/lib/wordpress/sites'
import { resolveOrigin, feedUrlFor } from '@/lib/wordpress/origin'
import type {
  ListWordpressSitesResponse,
  CreateWordpressSiteRequest,
  CreateWordpressSiteResponse,
} from '@/types/wordpress-sites'

export const runtime = 'nodejs'

const SITE_KEY_RE = /^[a-z0-9-]{2,40}$/

export async function GET() {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('wordpress_sites')
    .select('id, site_key, github_repo, enabled, created_at')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json<ListWordpressSitesResponse>({ sites: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const body = await readJsonBody<Partial<CreateWordpressSiteRequest>>(req)
  if (body instanceof NextResponse) return body

  const siteKey = (body.site_key ?? '').trim().toLowerCase()
  const githubRepo = (body.github_repo ?? '').trim()
  if (!SITE_KEY_RE.test(siteKey)) {
    return NextResponse.json(
      { error: 'Site key must be 2–40 chars: lowercase letters, numbers, hyphens.' },
      { status: 400 }
    )
  }
  if (!githubRepo) {
    return NextResponse.json({ error: 'GitHub repo is required.' }, { status: 400 })
  }

  const secret = generateSiteSecret()
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('wordpress_sites')
    .insert({ site_key: siteKey, github_repo: githubRepo, secret, enabled: true })
    .select('id, site_key, github_repo, enabled, created_at')
    .single()

  if (error) {
    // 23505 = unique_violation on site_key.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That site key is already in use.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json<CreateWordpressSiteResponse>({
    site: data,
    secret,
    feedUrl: feedUrlFor(resolveOrigin(req), data.site_key),
  })
}
