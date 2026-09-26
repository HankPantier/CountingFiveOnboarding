import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { applyMbpUpdate } from '@/lib/mbp/apply-update'
import { regenerateMbpIfApproved } from '@/lib/mbp/regenerate-if-approved'
import { getByPath, outOfRangeIndexPath } from '@/lib/mbp/schema-write'
import { isApprovableSuggestionPath, suggestionBaseFor } from '@/lib/mbp/suggestion-guards'
import { readJsonBody } from '@/app/api/_json'
import type { SessionSchema } from '@/types/session-schema'
import type { MbpSuggestionBase, MbpSuggestionChanges, SuggestionActionBody } from '@/types/mbp'

export const runtime = 'nodejs'

function valueKind(v: unknown): string {
  return v !== null && typeof v === 'object' ? 'object' : typeof v
}

// Approve (apply the proposed field changes) or dismiss a pending MBP
// suggestion. Admin-only — managers have a read-only MBP.
//
// Idempotent under double-clicks / concurrent admins: the row is CLAIMED
// (pending → approved/dismissed, conditional on still being pending) before any
// change is applied, so only one request ever applies it. If the apply then
// fails, the claim is released back to pending.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id, suggestionId } = await params

  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth
  if (!auth.user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await readJsonBody<SuggestionActionBody>(req)
  if (body instanceof NextResponse) return body
  if (!body || typeof body !== 'object' || (body.action !== 'approve' && body.action !== 'dismiss')) {
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

    // Snapshot used only to VALIDATE (stale indexes, append shape). The writes
    // themselves — including array appends — are applied to the fresh row inside
    // applyMbpUpdate's compare-and-swap.
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', id)
      .single()
    const currentSchema = (sessionRow?.schema_data ?? {}) as SessionSchema

    const updates: Record<string, unknown> = {}
    const appends: Record<string, unknown> = {}
    // Exact paths written, for the "just added" highlight (applyMbpUpdate adds the
    // new row's index for appends, e.g. team.3, so only that row lights up).
    const appliedPaths: string[] = []
    // Off-schema and server-owned `_meta` paths are skipped (not applied) and
    // reported — see isApprovableSuggestionPath.
    const skippedPaths: string[] = []
    // Base snapshots the fresh row must still match (whole-array sets, guarded
    // element changes). Checked inside applyMbpUpdate's compare-and-swap.
    const expect: MbpSuggestionBase[] = []
    for (const [fieldPath, change] of Object.entries(changes)) {
      if (!isApprovableSuggestionPath(fieldPath)) {
        skippedPaths.push(fieldPath)
        continue
      }
      // A stale array index — the suggestion was raised before the array shrank.
      // Applying it would bury an identity-less orphan row at a meaningless
      // index (three of those accumulated on one session's `niches`), so skip
      // and report it the same way an off-schema path is skipped.
      const stale = outOfRangeIndexPath(currentSchema as unknown as Record<string, unknown>, fieldPath)
      if (stale) {
        skippedPaths.push(`${fieldPath} (stale index ${stale})`)
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
        appends[fieldPath] = item
      } else {
        updates[fieldPath] = change.proposedValue
        appliedPaths.push(fieldPath)
      }
      const base = suggestionBaseFor(fieldPath, change, currentSchema as unknown as Record<string, unknown>)
      if (base) expect.push(base)
    }

    const claimed = await claimSuggestion(supabase, id, suggestionId, 'approved', auth.user.id)
    if (claimed instanceof NextResponse) return claimed

    if (Object.keys(updates).length > 0 || Object.keys(appends).length > 0) {
      const result = await applyMbpUpdate(supabase, id, updates, undefined, { appliedPaths, appends, expect })
      if (!result.success) {
        await releaseClaim(supabase, suggestionId)
        if (result.stale?.length) {
          return NextResponse.json(
            {
              error: `This suggestion is out of date: ${result.stale.join(', ')} changed since it was suggested. Review the current profile again, then dismiss it or re-file it.`,
            },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: result.error ?? 'Failed to apply' }, { status: 500 })
      }
      // Keep the downloadable MBP fresh if this session is already approved.
      after(() => regenerateMbpIfApproved(supabase, id))
    }
    if (skippedPaths.length > 0) {
      console.warn(`[mbp-suggestion] skipped unapplicable paths on ${id}: ${skippedPaths.join(', ')}`)
    }
    return NextResponse.json({ success: true })
  }

  const claimed = await claimSuggestion(supabase, id, suggestionId, 'dismissed', auth.user.id)
  if (claimed instanceof NextResponse) return claimed
  return NextResponse.json({ success: true })
}

type Supabase = ReturnType<typeof createServerClient>

// Atomically move a still-pending suggestion to its resolved status. Returns a
// 409 when another request already resolved it (double-click, second admin).
async function claimSuggestion(
  supabase: Supabase,
  sessionId: string,
  suggestionId: string,
  status: 'approved' | 'dismissed',
  userId: string
): Promise<true | NextResponse> {
  const { data, error } = await supabase
    .from('mbp_suggestions')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', suggestionId)
    .eq('session_id', sessionId)
    .eq('status', 'pending')
    .select('id')
  if (error) return internalError('mbp-suggestions:patch', error, "Couldn't update the suggestion")
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Suggestion is no longer pending' }, { status: 409 })
  }
  return true
}

// Undo an approve claim whose apply failed, so the admin can retry or dismiss.
async function releaseClaim(supabase: Supabase, suggestionId: string): Promise<void> {
  const { error } = await supabase
    .from('mbp_suggestions')
    .update({ status: 'pending', resolved_at: null, resolved_by: null })
    .eq('id', suggestionId)
    .eq('status', 'approved')
  if (error) console.error('[mbp-suggestion] could not release claim on', suggestionId, error.message)
}
