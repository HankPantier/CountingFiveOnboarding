import { buildMbpDocument } from './build-document'
import type { GapItem } from '@/types/gap-item'
import type { MbpDocument } from '@/types/mbp'
import type { SessionSchema } from '@/types/session-schema'

// Onboarding gaps store array indices as `team[3].title`; the MBP document uses
// dot paths (`team.3.title`). Normalize numeric indices so the two align.
export function normalizeGapField(field: string): string {
  return field.replace(/\[(\d+)\]/g, '.$1')
}

// The curated "what's still genuinely missing" list: gaps that are neither
// resolved nor filled by any means (admin edit, approved suggestion, backfill).
// Reconciles the gap list against live field values via the MBP document so the
// admin screen and the server-side gates agree on what's open.
export function computeOpenGaps(doc: MbpDocument, gaps: GapItem[]): GapItem[] {
  const profileSections = doc.sections.filter((s) => s.key !== 'site_map')
  const emptyByPath = new Map(
    profileSections
      .flatMap((s) => [...(s.fields ?? []), ...(s.items ?? []).flatMap((it) => it.fields)])
      .map((f) => [f.fieldPath, f.empty]),
  )

  return gaps.filter((g) => {
    if (g.resolved) return false
    const norm = normalizeGapField(g.field)
    return emptyByPath.has(norm) ? emptyByPath.get(norm) === true : true
  })
}

// Filled fields the provenance heuristic flagged 'thin' (a likely placeholder) —
// advisory, never gates. Surfaced in the "Still needed" card as a "worth
// strengthening" roll-up and targeted by the pre-gen enrichment pass. Skips the
// site-map section (its fields have no provenance and aren't profile content).
export function computeThinFields(doc: MbpDocument): Array<{ fieldPath: string; label: string }> {
  const out: Array<{ fieldPath: string; label: string }> = []
  for (const section of doc.sections) {
    if (section.key === 'site_map') continue
    for (const f of section.fields ?? []) {
      if (!f.empty && f.provenance === 'thin') out.push({ fieldPath: f.fieldPath, label: f.label })
    }
    for (const item of section.items ?? []) {
      for (const f of item.fields) {
        if (!f.empty && f.provenance === 'thin') out.push({ fieldPath: f.fieldPath, label: `${item.heading} — ${f.label}` })
      }
    }
  }
  return out
}

export interface CompletenessResult {
  open: GapItem[]
  tier1Open: GapItem[]
  tier2Open: GapItem[]
  tier3Open: GapItem[]
  complete: boolean
}

// Server-side completeness for a schema + gap list. Builds the MBP document
// internally so callers (approve gate, content-gen gate) don't need to.
export function computeCompleteness(schema: SessionSchema, gaps: GapItem[]): CompletenessResult {
  const open = computeOpenGaps(buildMbpDocument(schema), gaps)
  return {
    open,
    tier1Open: open.filter((g) => (g.tier ?? 3) === 1),
    tier2Open: open.filter((g) => (g.tier ?? 3) === 2),
    tier3Open: open.filter((g) => (g.tier ?? 3) === 3),
    complete: open.length === 0,
  }
}
