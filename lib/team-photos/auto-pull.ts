// Audit → session-start background pass: pull the client's team headshots off
// their current site so the new site shows real faces from day one. Auto-pulls
// only high-confidence matches (a wrong face is worse than none) and records a
// discovery snapshot so the admin UI can suggest the rest without re-scraping.
// Best-effort: never throws — a failed scan just leaves the manual flow intact.
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { scrapeTeamHeadshots, matchHeadshotsToMembers } from './scrape-headshots'
import { pullHeadshotForMember } from './pull-headshot'
import type { SessionSchema } from '@/types/session-schema'

/**
 * @param nowIso ISO timestamp for the snapshot — passed in (not `new Date()`)
 *   so callers stay deterministic/testable.
 */
export async function autoPullTeamHeadshots(
  sessionId: string,
  websiteUrl: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  try {
    if (!websiteUrl) return
    const supabase = createServerClient()

    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', sessionId)
      .single()
    if (!session) return

    const schema = (session.schema_data as SessionSchema | null) ?? {}
    const team = Array.isArray(schema.team) ? schema.team : []
    if (team.length === 0) return

    const { candidates, scannedPages } = await scrapeTeamHeadshots(websiteUrl)
    const matches = matchHeadshotsToMembers(team, candidates)

    // Pull the confident matches. skipIfExists guards against a re-run (or a
    // photo a rep already added) creating duplicates. Sequential: the roster is
    // small and this is background work — no need to hammer the source site.
    for (const match of matches) {
      if (match.confidence !== 'high' || !match.imageUrl) continue
      const res = await pullHeadshotForMember({
        supabase,
        sessionId,
        memberName: match.name,
        imageUrl: match.imageUrl,
        skipIfExists: true,
      })
      if (res.status === 'error') {
        console.warn(`[team-photos/auto-pull] ${match.name}: ${res.error}`)
      }
    }

    // Persist the snapshot so the UI can surface suggestions for the members we
    // didn't auto-pull. Re-read schema_data right before writing to avoid
    // clobbering any concurrent edit (only touches the _meta sub-key).
    const { data: fresh } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', sessionId)
      .single()
    const current = (fresh?.schema_data as SessionSchema | null) ?? schema
    // Merge into _meta without asserting its full (phase-state) shape — mirrors
    // lib/mbp/apply-update.ts. teamPhotoDiscovery is the only key we touch.
    const meta = (current._meta as Record<string, unknown>) ?? {}
    const teamPhotoDiscovery: NonNullable<SessionSchema['_meta']>['teamPhotoDiscovery'] = {
      scannedPages,
      suggestions: matches,
      candidates,
      at: nowIso,
    }
    const nextSchema = { ...current, _meta: { ...meta, teamPhotoDiscovery } } as SessionSchema

    const { error: updateErr } = await supabase
      .from('sessions')
      .update({ schema_data: asJson(nextSchema) })
      .eq('id', sessionId)
    if (updateErr) console.warn('[team-photos/auto-pull] snapshot write failed:', updateErr.message)
  } catch (err) {
    console.error('[team-photos/auto-pull] failed:', err)
  }
}
