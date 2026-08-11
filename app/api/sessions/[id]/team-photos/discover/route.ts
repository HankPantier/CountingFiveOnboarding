import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { scrapeTeamHeadshots, matchHeadshotsToMembers } from '@/lib/team-photos/scrape-headshots'
import type { SessionSchema } from '@/types/session-schema'

// Uses node:dns (via the SSRF guard) and a network crawl — Node runtime only.
export const runtime = 'nodejs'

// GET — scrape the client's live site for candidate team headshots and suggest
// one per member. Read-only: nothing is stored until the rep confirms via the
// pull route. Scoped to admins / managers of this session.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const schema = (session.schema_data as SessionSchema | null) ?? {}
  const websiteUrl = session.website_url || schema.websiteUrl || ''
  if (!websiteUrl) {
    return NextResponse.json({ error: 'No website URL on file for this session' }, { status: 400 })
  }

  // Outbound crawl is expensive — bound it per session.
  if (!(await checkRateLimit(`team-scrape:${id}`, 10, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Scan limit reached — please wait a bit' }, { status: 429 })
  }

  let result
  try {
    result = await scrapeTeamHeadshots(websiteUrl)
  } catch (err) {
    console.error('[team-photos/discover]', err)
    return NextResponse.json({ error: 'Live site could not be scanned' }, { status: 502 })
  }

  if (result.scannedPages.length === 0) {
    return NextResponse.json({ error: result.warnings[0] ?? 'Live site unreachable' }, { status: 502 })
  }

  const team = Array.isArray(schema.team) ? schema.team : []
  const matches = matchHeadshotsToMembers(team, result.candidates)
  // Back-compat map (name → imageUrl) plus the richer confidence-tagged list.
  const suggestions: Record<string, string | null> = {}
  for (const m of matches) suggestions[m.name] = m.imageUrl

  return NextResponse.json({
    candidates: result.candidates,
    suggestions,
    matches,
    scannedPages: result.scannedPages,
    warnings: result.warnings,
  })
}
