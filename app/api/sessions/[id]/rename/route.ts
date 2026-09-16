import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'
import { asJson } from '@/lib/supabase/json-typed'
import { regenerateMbpIfApproved } from '@/lib/mbp/regenerate-if-approved'
import { runWhoisLookup } from '@/lib/whois/lookup'
import { hostOf } from '@/lib/session/domain-rewrite'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RenameBody {
  firmName?: string
  websiteUrl?: string
  rerunWhois?: boolean
}

// Admin-only: rename a firm and/or change its domain. Updates the authoritative
// sessions.website_url column plus the mirrored schema_data.websiteUrl and
// business.name in a single write. Downstream artifacts (GitHub repo, live site,
// already-generated pages, sitemap) are NOT auto-changed — they're returned as
// warnings, and the caller can opt into patch-content-domain for the generated
// content. Optionally re-runs WHOIS when the domain changed.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await readJsonBody<RenameBody>(req)
  if (body instanceof NextResponse) return body

  const firmName = body.firmName?.trim()
  const newUrl = body.websiteUrl?.trim()
  if (!firmName && !newUrl) {
    return NextResponse.json({ error: 'Provide a new firm name or website.' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data, website_url')
    .eq('id', id)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const oldHost = hostOf(session.website_url)
  const newHost = hostOf(newUrl ?? session.website_url)
  const domainChanged = !!newUrl && newHost !== oldHost

  const schema = (session.schema_data as Record<string, unknown>) ?? {}
  if (firmName) {
    const business = (schema.business as Record<string, unknown>) ?? {}
    business.name = firmName
    schema.business = business
    const meta = (schema._meta as Record<string, unknown>) ?? {}
    const overrides = (meta.admin_overrides as Record<string, boolean>) ?? {}
    overrides['business.name'] = true
    schema._meta = { ...meta, admin_overrides: overrides }
  }
  if (newUrl) schema.websiteUrl = newUrl

  const { error: updateErr } = await supabase
    .from('sessions')
    .update({
      schema_data: asJson(schema),
      ...(newUrl ? { website_url: newUrl } : {}),
    })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Downstream content that still points at the old host — surfaced so the
  // operator can decide whether to patch it (a separate, explicit step).
  let downstream: { canPatch: boolean; oldHost: string; newHost: string; pages: number; sitemapEntries: number; repo: string | null } | null = null
  const warnings: string[] = []
  if (domainChanged) {
    const { data: job } = await supabase
      .from('content_jobs')
      .select('id, github_repo, confirmed_sitemap')
      .eq('session_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let pages = 0
    let sitemapEntries = 0
    if (job) {
      const sitemap = Array.isArray(job.confirmed_sitemap) ? job.confirmed_sitemap : []
      sitemapEntries = sitemap.filter(
        (e): e is { url: string } =>
          !!e && typeof e === 'object' && typeof (e as { url?: unknown }).url === 'string' &&
          ((e as { url: string }).url.toLowerCase().includes(oldHost)),
      ).length
      const { count } = await supabase
        .from('generated_pages')
        .select('id', { count: 'exact', head: true })
        .eq('content_job_id', job.id)
        .ilike('page_url', `%${oldHost}%`)
      pages = count ?? 0
    }

    if (job?.github_repo) warnings.push(`The GitHub repo "${job.github_repo}" is not renamed — editing/publishing still uses it.`)
    warnings.push('The live site / DNS is not changed automatically — point the new domain independently.')
    if (pages || sitemapEntries) warnings.push(`${pages} generated page(s) and ${sitemapEntries} sitemap entr(y/ies) still reference ${oldHost}.`)
    warnings.push('Already-sent emails and the source audit record keep the old name/domain.')

    downstream = {
      canPatch: pages > 0 || sitemapEntries > 0,
      oldHost,
      newHost,
      pages,
      sitemapEntries,
      repo: job?.github_repo ?? null,
    }

    if (body.rerunWhois) {
      after(() =>
        runWhoisLookup(id, newHost).catch(err => console.error('[rename] WHOIS refresh failed:', err)),
      )
    }
  }

  // Keep the downloadable MBP in sync with the new name/domain if approved.
  after(() => regenerateMbpIfApproved(supabase, id))

  return NextResponse.json({ success: true, warnings, downstream })
}
