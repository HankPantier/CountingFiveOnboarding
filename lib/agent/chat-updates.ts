// Pure helpers for the onboarding chat's update_session_data tool
// (app/api/chat/route.ts). Kept free of I/O so the merge / gate semantics are
// unit-testable — these are the rules that decide what the model may write.

import type { GapItem } from '@/types/gap-item'
import { deepMerge, deepSetPath, isPathFilled, preserveAppendOnlyMarkers } from '@/lib/mbp/schema-write'

// `_meta` keys the onboarding prompt legitimately asks the model to write
// (lib/agent/phase-instructions.ts). Everything else under `_meta` — the
// Audit Review markers (niche_review, services_review, geo_review,
// subcategories_review, team_review), `mode`, audit context, provenance,
// admin overrides — is server-owned: letting the model write it would bypass
// the phase-3 gates or flip staff/client mode.
export const MODEL_WRITABLE_META_KEYS: ReadonlySet<string> = new Set([
  'phase3_completed_chunks',
  'opportunities_confirmed',
  'trust_signals_confirmed',
  'sitemap_decisions',
  'section11_responses',
  'phase4_flagged_for_followup',
])

// Sentinel the model writes into a field when the firm genuinely has nothing
// for it (so a Tier-1 gap can resolve without being left blank). A non-empty
// string, so isPathFilled treats it as an answer.
export const NONE_SENTINEL = 'None'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function pathSegments(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
}

// Drops every model write the server does not allow: `_meta` keys outside the
// allowlist (as a whole object or as a dotted/bracket path), and a non-object
// `_meta` (e.g. `"_meta": null`, which would otherwise wipe all internal state).
export function sanitizeChatUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(updates)) {
    const segs = pathSegments(path)
    if (segs[0] !== '_meta') {
      out[path] = value
      continue
    }
    if (segs.length === 1) {
      if (!isPlainObject(value)) continue
      const kept: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        if (MODEL_WRITABLE_META_KEYS.has(k)) kept[k] = v
      }
      if (Object.keys(kept).length > 0) out[path] = kept
      continue
    }
    if (MODEL_WRITABLE_META_KEYS.has(segs[1])) out[path] = value
  }
  return out
}

// Applies the model's field-path → value map onto the current schema.
//
// Each dotted/bracket path is written DIRECTLY onto (a clone of) the current
// schema via deepSetPath, so `niches[2].painPoints` updates one element and
// leaves every sibling niche intact. (Folding paths onto `{}` first and then
// deepMerge-ing replaced arrays wholesale — `niches[2].x` produced a 3-slot
// array that wiped niches 0/1/3+.) A plain top-level key whose value is an
// object (e.g. `_meta`, `business`) is deep-merged into the existing object;
// anything else replaces the value at that key.
//
// Callers should run sanitizeChatUpdates first. The Phase-3 step markers are
// re-unioned so a marker can never be dropped.
export function applyChatUpdates(
  current: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...current }
  for (const [path, value] of Object.entries(updates)) {
    const isSimpleKey = !path.includes('.') && !path.includes('[')
    if (isSimpleKey && isPlainObject(value) && isPlainObject(next[path])) {
      next = { ...next, [path]: deepMerge(next[path] as Record<string, unknown>, value) }
    } else {
      next = deepSetPath(next, path, value)
    }
  }
  return preserveAppendOnlyMarkers(current, next)
}

// Resolves gaps against the merged schema. A gap resolves only when its field
// actually holds an answer — the model listing it in `resolvedGaps` is not
// enough on its own (an unanswered Tier-1 gap would otherwise slip through the
// 4→5 gate). The one exception is a boolean field (e.g. brand.hasBrandGuide):
// a stored boolean is never "auto-filled", but when the model explicitly
// resolves it, the boolean it wrote is the answer.
//
// A gap the model claims resolved but whose field is still empty is tagged
// `resolvedBy: 'model_skip'` and stays unresolved.
export function resolveGapsAfterUpdate(
  gaps: GapItem[],
  merged: Record<string, unknown>,
  resolvedGaps: string[] | undefined
): GapItem[] {
  const explicit = new Set(resolvedGaps ?? [])
  return gaps.map((g): GapItem => {
    if (g.resolved) return g
    if (isPathFilled(merged, g.field)) {
      const { resolvedBy, ...rest } = g
      void resolvedBy
      return { ...rest, resolved: true }
    }
    if (explicit.has(g.field)) {
      if (typeof readPath(merged, g.field) === 'boolean') {
        const { resolvedBy, ...rest } = g
        void resolvedBy
        return { ...rest, resolved: true }
      }
      return { ...g, resolvedBy: 'model_skip' }
    }
    return g
  })
}

function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const p of pathSegments(path)) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p]
    else return undefined
  }
  return cur
}
