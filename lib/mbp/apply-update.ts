import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { deepSetPath } from '@/lib/mbp/schema-write'
import type { GapItem } from '@/types/gap-item'

type Supabase = ReturnType<typeof createServerClient>

// Single write path for MBP edits — used by the MBP edit chat tool and the
// suggestion-approve route. Applies each dotted fieldPath to schema_data,
// stamps _meta.admin_overrides for every path (so the UI can badge admin
// edits), marks any resolved gaps, and writes back. Never touches
// current_phase — MBP edits are post-onboarding.
export async function applyMbpUpdate(
  supabase: Supabase,
  sessionId: string,
  updates: Record<string, unknown>,
  resolvedGaps?: string[]
): Promise<{ success: boolean; error?: string }> {
  const { data: current } = await supabase
    .from('sessions')
    .select('schema_data, gap_list')
    .eq('id', sessionId)
    .single()

  if (!current) return { success: false, error: 'Session not found' }

  let schema = (current.schema_data as Record<string, unknown>) ?? {}
  const overridePaths: string[] = []

  for (const [fieldPath, value] of Object.entries(updates)) {
    schema = deepSetPath(schema, fieldPath, value)
    overridePaths.push(fieldPath)
  }

  // Stamp admin_overrides for each edited path.
  const meta = (schema._meta as Record<string, unknown>) ?? {}
  const overrides = (meta.admin_overrides as Record<string, boolean>) ?? {}
  for (const p of overridePaths) overrides[p] = true
  schema = { ...schema, _meta: { ...meta, admin_overrides: overrides } }

  const gaps = (current.gap_list as GapItem[]) ?? []
  const updatedGaps = resolvedGaps?.length
    ? gaps.map(g => (resolvedGaps.includes(g.field) ? { ...g, resolved: true } : g))
    : gaps

  const { error } = await supabase
    .from('sessions')
    .update({ schema_data: asJson(schema), gap_list: asJson(updatedGaps) })
    .eq('id', sessionId)

  if (error) return { success: false, error: error.message }
  return { success: true }
}
