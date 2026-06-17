import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { deepSetPath } from '@/lib/mbp/schema-write'
import type { AuditResult } from '@/types/audit-result'

type Supabase = ReturnType<typeof createServerClient>

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
  const applied: string[] = []
  for (const [fieldPath, value] of Object.entries(updates)) {
    result = deepSetPath(result, fieldPath, value)
    applied.push(fieldPath)
  }

  const { error } = await supabase
    .from('audit_runs')
    .update({ result: asJson(result as unknown as AuditResult) })
    .eq('id', auditId)

  if (error) return { success: false, applied: [], error: error.message }
  return { success: true, applied }
}
