import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { deepSetPath, getByPath } from '@/lib/mbp/schema-write'
import type { AuditResult } from '@/types/audit-result'

type Supabase = ReturnType<typeof createServerClient>

// Walk the (post-edit) intelligence subtree looking for a null/undefined array
// element — the tell-tale of a sparse-index write (e.g. setting index 5 of a
// 3-item array), which crashes the report renderer. Indexed access is used
// because Array iteration methods skip sparse holes.
function hasArrayHole(node: unknown): boolean {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (node[i] == null || hasArrayHole(node[i])) return true
    }
    return false
  }
  if (node !== null && typeof node === 'object') {
    return Object.values(node as Record<string, unknown>).some(hasArrayHole)
  }
  return false
}

// Only the AI intelligence layer is editable from the report chat. Scores,
// grades, findings, and page analysis are deterministic outputs of the crawl —
// they must come from a re-run, never a prose edit. Every dotted path the agent
// submits has to live under this prefix or it is rejected.
const EDITABLE_PREFIX = 'intelligence.'

export interface ApplyAuditEditResult {
  success: boolean
  error?: string
  applied: string[]
}

// Single write path for audit report edits — used by the report edit chat tool
// (app/api/audits/[id]/chat). Applies each dotted fieldPath to
// `audit_runs.result` via deepSetPath (which handles array-index segments like
// `intelligence.niche_services.detected_niches.0.note`), then writes the JSONB
// back. Never touches denormalized score columns.
export async function applyAuditEdit(
  supabase: Supabase,
  auditId: string,
  updates: Record<string, unknown>
): Promise<ApplyAuditEditResult> {
  const offLimits = Object.keys(updates).filter(p => !p.startsWith(EDITABLE_PREFIX))
  if (offLimits.length > 0) {
    return {
      success: false,
      applied: [],
      error: `Only intelligence.* fields are editable. Rejected: ${offLimits.join(', ')}`,
    }
  }

  const { data: current } = await supabase
    .from('audit_runs')
    .select('result')
    .eq('id', auditId)
    .single()

  if (!current?.result) return { success: false, applied: [], error: 'Audit result not found' }

  let result = current.result as unknown as Record<string, unknown>

  // Type-preservation guard. An edit may refine a value but must not change its
  // fundamental shape: turning an array into a scalar, or an object into a
  // string, is exactly what corrupts the report renderer. Validate every field
  // up front so a bad batch is rejected wholesale — never partially applied.
  for (const [fieldPath, value] of Object.entries(updates)) {
    const existing = getByPath(result, fieldPath)
    if (Array.isArray(existing) && !Array.isArray(value)) {
      return { success: false, applied: [], error: `Field ${fieldPath} must stay a list — send the full replacement array.` }
    }
    const existingIsObject = existing !== null && typeof existing === 'object' && !Array.isArray(existing)
    const valueIsObject = value !== null && typeof value === 'object' && !Array.isArray(value)
    if (existingIsObject && !valueIsObject) {
      return { success: false, applied: [], error: `Field ${fieldPath} must stay an object — send the full replacement object.` }
    }
  }

  const applied: string[] = []
  for (const [fieldPath, value] of Object.entries(updates)) {
    result = deepSetPath(result, fieldPath, value)
    applied.push(fieldPath)
  }

  if (hasArrayHole(result.intelligence)) {
    return {
      success: false,
      applied: [],
      error: 'Edit left a gap in a list (an out-of-range index). Re-send the whole list instead of a single index.',
    }
  }

  const { error } = await supabase
    .from('audit_runs')
    .update({ result: asJson(result as unknown as AuditResult) })
    .eq('id', auditId)

  if (error) return { success: false, applied: [], error: error.message }
  return { success: true, applied }
}
