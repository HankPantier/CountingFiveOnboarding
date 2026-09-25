// Pure + client-safe: DB rows → the DTOs the Design Studio UI renders, and the
// MBP-derived input suggestions (names only — the MBP is never written).
import type { Tables } from '@/types/database'
import { normalizeInputUrl } from './input-validation'
import {
  CAPTURE_STATUSES,
  DESIGN_INPUT_KINDS,
  VERSION_SOURCES,
  type CaptureStatus,
  type DesignInputDto,
  type DesignInputKind,
  type DesignVersionDto,
  type InputSuggestions,
  type VersionSource,
} from './studio-types'

const MAX_COMPETITOR_SUGGESTIONS = 12
const MAX_NAME_LENGTH = 120

function oneOf<T extends string>(list: readonly T[], value: string, fallback: T): T {
  return (list as readonly string[]).includes(value) ? (value as T) : fallback
}

export function toInputDto(row: Tables<'design_inputs'>, signed: Record<string, string>): DesignInputDto {
  return {
    id: row.id,
    kind: oneOf<DesignInputKind>(DESIGN_INPUT_KINDS, row.kind, 'inspiration_url'),
    url: row.url,
    label: row.label,
    notes: row.notes,
    captureStatus: oneOf<CaptureStatus>(CAPTURE_STATUSES, row.capture_status, 'none'),
    captureError: row.capture_error,
    capturedAt: row.captured_at,
    archived: row.archived,
    thumbnailUrl: row.storage_path ? (signed[row.storage_path] ?? null) : null,
    createdAt: row.created_at,
  }
}

export function versionScreenshotPaths(row: Tables<'design_versions'>): string[] {
  const shots = row.screenshots
  if (!Array.isArray(shots)) return []
  const out: string[] = []
  for (const s of shots) {
    if (s && typeof s === 'object' && !Array.isArray(s) && typeof s.path === 'string' && s.path.startsWith('design/')) out.push(s.path)
  }
  return out
}

function bundleName(bundle: Tables<'design_versions'>['bundle']): string {
  if (bundle && typeof bundle === 'object' && !Array.isArray(bundle) && typeof bundle.name === 'string' && bundle.name.trim()) {
    return bundle.name
  }
  return 'Untitled design'
}

export function toVersionDto(row: Tables<'design_versions'>, signed: Record<string, string>): DesignVersionDto {
  return {
    id: row.id,
    versionNo: row.version_no,
    source: oneOf<VersionSource>(VERSION_SOURCES, row.source, 'import'),
    name: bundleName(row.bundle),
    summary: row.summary,
    appliedCommitSha: row.applied_commit_sha,
    createdAt: row.created_at,
    screenshotUrls: versionScreenshotPaths(row).flatMap((p) => (signed[p] ? [signed[p]] : [])),
  }
}

// schema_data is loosely shaped in practice (fields stored as strings, arrays
// as strings, etc.), so every read is defensive.
export function buildInputSuggestions(schema: unknown): InputSuggestions {
  const s = schema && typeof schema === 'object' && !Array.isArray(schema) ? (schema as Record<string, unknown>) : {}
  const site = normalizeInputUrl(s.websiteUrl)
  const business = s.business && typeof s.business === 'object' ? (s.business as Record<string, unknown>) : {}
  const raw = Array.isArray(business.competitors) ? business.competitors : []

  const seen = new Set<string>()
  const competitors: { name: string }[] = []
  for (const c of raw) {
    const name =
      typeof c === 'string' ? c : c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' ? (c as { name: string }).name : ''
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    competitors.push({ name: trimmed })
    if (competitors.length >= MAX_COMPETITOR_SUGGESTIONS) break
  }
  return { currentSite: site.ok ? site.url : null, competitors }
}
