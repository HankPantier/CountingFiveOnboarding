import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { applyMbpUpdate } from '@/lib/mbp/apply-update'
import { regenerateMbpIfApproved } from '@/lib/mbp/regenerate-if-approved'
import { getByPath } from '@/lib/mbp/schema-write'
import type { SessionSchema } from '@/types/session-schema'
import type { MbpSuggestionChanges, SuggestionActionBody } from '@/types/mbp'

export const runtime = 'nodejs'

// The valid top-level segments of SessionSchema. A suggestion whose path starts
// outside this set can only ever create an orphaned top-level key the MBP UI
// never renders, so we skip (and report) it rather than write invisible data.
// With deepSetPath's bracket parsing fixed, this fires only on a model
// hallucination, never on a legitimate array path like `niches[3].description`.
const KNOWN_TOP_LEVEL = new Set([
  '_meta', 'contact', 'websiteUrl', 'technical', 'locations', 'team', 'services',
  'clientPortals', 'niches', 'business', 'culture', 'brand', 'assets', 'additional',
  'proposed_sitemap', 'current_sitemap', 'socialPresence', 'reputation',
  'content_gaps', 'content_direction',
])

function topSegment(fieldPath: string): string {
  return fieldPath.split(/[.[]/)[0]
}

function valueKind(v: unknown): string {
  return v !== null && typeof v === 'object' ? 'object' : typeof v
}

// Approve (apply the proposed field changes) or dismiss a pending MBP
// suggestion. Admin-only — managers have a read-only MBP.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id, suggestionId } = await params

  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as SuggestionActionBody
  if (body.action !== 'approve' && body.action !== 'dismiss') {
    return NextResponse.json({ error: "action must be 'approve' or 'dismiss'" }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: suggestion } = await supabase
    .from('mbp_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('session_id', id)
    .maybeSingle()

  if (!suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  if (suggestion.status !== 'pending') {
    return NextResponse.json({ error: 'Suggestion is no longer pending' }, { status: 409 })
  }

  if (body.action === 'approve') {
    const changes = suggestion.changes as MbpSuggestionChanges

    // For append ops we need the current array to push onto.
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', id)
      .single()
    const currentSchema = (sessionRow?.schema_data ?? {}) as SessionSchema

    const updates: Record<string, unknown> = {}
    // Exact paths written, for the "just added" highlight. Appends resolve to the
    // new item's index (e.g. team.3) so only the new row lights up, not the array.
    const appliedPaths: string[] = []
    // Off-schema paths are skipped (not applied) and reported — see KNOWN_TOP_LEVEL.
    const skippedPaths: string[] = []
    for (const [fieldPath, change] of Object.entries(changes)) {
      if (!KNOWN_TOP_LEVEL.has(topSegment(fieldPath))) {
        skippedPaths.push(fieldPath)
        continue
      }
      if (change.op === 'append') {
        let item: unknown = change.proposedValue
        let parsedJson = false
        if (typeof change.proposedValue === 'string' && /^\s*[[{]/.test(change.proposedValue)) {
          try { item = JSON.parse(change.proposedValue); parsedJson = true } catch { /* keep as string */ }
        }
        const existing = getByPath(currentSchema as Record<string, unknown>, fieldPath)
        const base = Array.isArray(existing) ? existing : []
        // Never corrupt a typed array: the appended item must match the kind of
        // the existing entries (object arrays get objects, string arrays get
        // strings). If the proposed value looked structured but didn't parse,
        // reject rather than push raw text.
        if (base.length > 0 && valueKind(item) !== valueKind(base[0])) {
          return NextResponse.json(
            { error: `Cannot apply: proposed ${fieldPath} item doesn't match the existing entries' shape` },
            { status: 422 }
          )
        }
        if (typeof change.proposedValue === 'string' && /^\s*\{/.test(change.proposedValue) && !parsedJson) {
          return NextResponse.json(
            { error: `Cannot apply: malformed value for ${fieldPath}` },
            { status: 422 }
          )
        }
        updates[fieldPath] = [...base, item]
        appliedPaths.push(`${fieldPath}.${base.length}`)
      } else {
        updates[fieldPath] = change.proposedValue
        appliedPaths.push(fieldPath)
      }
    }

    if (Object.keys(updates).length > 0) {
      const result = await applyMbpUpdate(supabase, id, updates, undefined, { appliedPaths })
      if (!result.success) {
        return NextResponse.json({ error: result.error ?? 'Failed to apply' }, { status: 500 })
      }
      // Keep the downloadable MBP fresh if this session is already approved.
      after(() => regenerateMbpIfApproved(supabase, id))
    }
    if (skippedPaths.length > 0) {
      console.warn(`[mbp-suggestion] skipped off-schema paths on ${id}: ${skippedPaths.join(', ')}`)
    }
  }

  const { error: updateErr } = await supabase
    .from('mbp_suggestions')
    .update({
      status: body.action === 'approve' ? 'approved' : 'dismissed',
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
    })
    .eq('id', suggestionId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
