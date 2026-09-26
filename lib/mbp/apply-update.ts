import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { deepSetPath, getByPath } from '@/lib/mbp/schema-write'
import { stampProvenance } from '@/lib/mbp/provenance'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import { updateSessionWithCas, SessionNotFoundError } from '@/lib/session/schema-cas'
import { isBaseStale } from '@/lib/mbp/suggestion-guards'
import type { MbpSuggestionBase } from '@/types/mbp'

type Supabase = ReturnType<typeof createServerClient>

// The MBP page keys field rows (admin-override badge, "just added" highlight) by
// the dotted `niches.3.description` form, but the AI suggestion tools emit
// bracket paths (`niches[3].description`). Normalize before using a path as a
// _meta key so the badge/highlight actually matches.
export function toDottedPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1')
}

// Single write path for MBP edits — used by the MBP edit chat tool and the
// suggestion-approve route. Applies each dotted fieldPath to schema_data,
// stamps _meta.admin_overrides for every path (so the UI can badge admin
// edits), marks any resolved gaps, and writes back. Never touches
// current_phase — MBP edits are post-onboarding.
export async function applyMbpUpdate(
  supabase: Supabase,
  sessionId: string,
  updates: Record<string, unknown>,
  resolvedGaps?: string[],
  // When `appliedPaths` is set (the suggestion-approve route), stamp those paths
  // into _meta.recently_applied so the MBP page can highlight them as just-added.
  // `appends` pushes one item onto the array at each path. The push happens on
  // the FRESH row inside the compare-and-swap, so two approvals appending to the
  // same array both land instead of the second overwriting the first.
  // `expect` lists base snapshots that must still match the FRESH row (checked
  // inside the compare-and-swap): if any differs, nothing is written and the
  // stale paths are returned so the caller can refuse a stale suggestion.
  options?: { appliedPaths?: string[]; appends?: Record<string, unknown>; expect?: MbpSuggestionBase[] }
): Promise<{ success: boolean; error?: string; stale?: string[] }> {
  let stale: string[] = []
  try {
    await updateSessionWithCas(supabase, sessionId, current => {
      let schema = (current.schema_data as Record<string, unknown>) ?? {}

      stale = (options?.expect ?? []).filter(b => isBaseStale(b, schema)).map(b => b.path)
      if (stale.length > 0) return { skip: true, result: null }
      const overridePaths: string[] = []

      for (const [fieldPath, value] of Object.entries(updates)) {
        schema = deepSetPath(schema, fieldPath, value)
        overridePaths.push(fieldPath)
      }

      const appendedPaths: string[] = []
      for (const [fieldPath, item] of Object.entries(options?.appends ?? {})) {
        const existing = getByPath(schema, fieldPath)
        const base = Array.isArray(existing) ? existing : []
        schema = deepSetPath(schema, fieldPath, [...base, item])
        overridePaths.push(fieldPath)
        // Highlight only the new row (e.g. team.3), not the whole array.
        appendedPaths.push(`${fieldPath}.${base.length}`)
      }

      // Stamp admin_overrides for each edited path.
      const meta = (schema._meta as Record<string, unknown>) ?? {}
      const overrides = (meta.admin_overrides as Record<string, boolean>) ?? {}
      for (const p of overridePaths) overrides[toDottedPath(p)] = true
      schema = { ...schema, _meta: { ...meta, admin_overrides: overrides } }

      // An admin edit is a confirmation — tag provenance so the UI/content-gen can
      // tell hand-verified fields from seed data (thin values downgrade to 'thin').
      schema = stampProvenance(schema as unknown as SessionSchema, overridePaths, 'confirmed') as unknown as Record<string, unknown>

      const appliedPaths = [...(options?.appliedPaths ?? []), ...appendedPaths]
      if (appliedPaths.length) {
        const m = (schema._meta as Record<string, unknown>) ?? {}
        const recent = (m.recently_applied as Record<string, string>) ?? {}
        const now = new Date().toISOString()
        for (const p of appliedPaths) recent[toDottedPath(p)] = now
        schema = { ...schema, _meta: { ...m, recently_applied: recent } }
      }

      const gaps = (current.gap_list as GapItem[]) ?? []
      const updatedGaps = resolvedGaps?.length
        ? gaps.map(g => (resolvedGaps.includes(g.field) ? { ...g, resolved: true } : g))
        : gaps

      return { update: { schema_data: asJson(schema), gap_list: asJson(updatedGaps) }, result: null }
    })
  } catch (err) {
    if (err instanceof SessionNotFoundError) return { success: false, error: 'Session not found' }
    console.error('[applyMbpUpdate] write failed:', err)
    return { success: false, error: "Couldn't save the change" }
  }
  if (stale.length > 0) return { success: false, stale, error: 'Changed since suggested' }
  return { success: true }
}
