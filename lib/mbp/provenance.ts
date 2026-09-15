import type { SessionSchema } from '@/types/session-schema'
import { getByPath, isPathFilled } from '@/lib/mbp/schema-write'

// Lightweight, advisory per-field provenance. Stored in _meta.field_provenance
// keyed by dotted path. NEVER gates a phase advance — it only lets content
// generation down-weight thin values and the admin UI badge field origin.
export type Provenance = 'audit' | 'notes' | 'confirmed' | 'thin'

// Prose fields where a one-word / very-short answer is almost certainly a
// placeholder rather than a usable value. Kept small on purpose — this is a
// hint, not a scoring engine. Paths are matched by their trailing field name so
// niches[i].valueProp and business.differentiators both hit their rule.
const MIN_PROSE_CHARS: Record<string, number> = {
  voiceExample: 25,
  firmHistory: 40,
  differentiators: 25,
  valueProp: 15,
  painPoints: 15,
  customerTrigger: 12,
  missionVisionValues: 20,
  customerNeeds: 15,
  teamDescription: 20,
}

// Canonical dot form for a path, so `niches[0].x` and `niches.0.x` map to one
// provenance key — writers pass either form; the map and lookups use dot form.
function normPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1')
}

function fieldName(path: string): string {
  const parts = normPath(path).split('.').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

// True when a filled value looks like a placeholder rather than a usable answer.
// Only prose fields with a documented minimum are ever considered thin; arrays,
// booleans, and untracked fields are never thin.
export function assessThinness(path: string, value: unknown): boolean {
  const min = MIN_PROSE_CHARS[fieldName(path)]
  if (min === undefined) return false
  if (typeof value !== 'string') return false
  return value.trim().length < min
}

// Merge a batch of provenance stamps into a schema, returning a new schema.
// Each path is tagged with its `source`, except a filled-but-thin prose value is
// downgraded to 'thin' so content-gen and the UI can flag it. Only stamps paths
// that are actually filled — an empty write leaves provenance untouched. Pure.
export function stampProvenance(
  schema: SessionSchema,
  paths: string[],
  source: Exclude<Provenance, 'thin'>,
): SessionSchema {
  if (!paths.length) return schema
  const obj = schema as Record<string, unknown>
  const meta = (obj._meta as Record<string, unknown> | undefined) ?? {}
  const existing = (meta.field_provenance as Record<string, Provenance> | undefined) ?? {}
  const next: Record<string, Provenance> = { ...existing }
  let changed = false
  for (const path of paths) {
    if (!isPathFilled(obj, path)) continue
    const key = normPath(path)
    const value = getByPath(obj, key)
    next[key] = assessThinness(key, value) ? 'thin' : source
    changed = true
  }
  if (!changed) return schema
  return { ...obj, _meta: { ...meta, field_provenance: next } } as SessionSchema
}

// Read a single field's provenance tag (undefined = seed/unverified).
export function provenanceOf(schema: SessionSchema | undefined, path: string): Provenance | undefined {
  return schema?._meta?.field_provenance?.[normPath(path)]
}
