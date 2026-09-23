import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { deepSetPath } from '@/lib/mbp/schema-write'
import { stampProvenance } from '@/lib/mbp/provenance'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import { updateSessionWithCas, SessionNotFoundError } from '@/lib/session/schema-cas'

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
  options?: { appliedPaths?: string[] }
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateSessionWithCas(supabase, sessionId, current => {
      let schema = (current.schema_data as Record<string, unknown>) ?? {}
      const overridePaths: string[] = []

      for (const [fieldPath, value] of Object.entries(updates)) {
        schema = deepSetPath(schema, fieldPath, value)
        overridePaths.push(fieldPath)
      }

      // Stamp admin_overrides for each edited path.
      const meta = (schema._meta as Record<string, unknown>) ?? {}
      const overrides = (meta.admin_overrides as Record<string, boolean>) ?? {}
      for (const p of overridePaths) overrides[toDottedPath(p)] = true
      schema = { ...schema, _meta: { ...meta, admin_overrides: overrides } }

      // An admin edit is a confirmation — tag provenance so the UI/content-gen can
      // tell hand-verified fields from seed data (thin values downgrade to 'thin').
      schema = stampProvenance(schema as unknown as SessionSchema, overridePaths, 'confirmed') as unknown as Record<string, unknown>

      const appliedPaths = options?.appliedPaths ?? []
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
  return { success: true }
}
