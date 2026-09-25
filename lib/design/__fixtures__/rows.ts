import type { Tables } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import { DEFAULT_CAPABILITIES } from '../run-types'
import { VALID } from './valid-bundle'

export const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
export const OTHER_SID = '11111111-2222-4333-8444-555555555555'
export const IID = '0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e'

export function makeInputRow(overrides: Partial<Tables<'design_inputs'>> = {}): Tables<'design_inputs'> {
  return {
    id: IID,
    session_id: SID,
    kind: 'competitor_url',
    url: 'https://acme.example.com/',
    label: 'Acme CPA',
    notes: null,
    storage_path: null,
    capture_status: 'none',
    capture_error: null,
    captured_at: null,
    archived: false,
    created_by: 'admin-1',
    created_at: '2026-09-25T10:00:00.000Z',
    updated_at: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

export function makeVersionRow(overrides: Partial<Tables<'design_versions'>> = {}): Tables<'design_versions'> {
  return {
    id: 'ver-0',
    session_id: SID,
    version_no: 0,
    source: 'baseline',
    bundle: asJson({ ...VALID, name: 'Baseline', meta: { source: 'baseline' } }),
    summary: 'Baseline — imported from the current draft',
    concept_id: null,
    applied_commit_sha: null,
    applied_blobs: asJson({}),
    screenshots: asJson([]),
    created_by: 'admin-1',
    created_at: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

// The narrow shape listVersions() actually selects (no full `bundle` JSONB —
// just its name, via a JSON-path alias). Derives sensible defaults from
// makeVersionRow so existing "Baseline" expectations keep working.
export function makeVersionListRow(
  overrides: Partial<Omit<Tables<'design_versions'>, 'bundle'>> & { bundle_name?: string | null } = {}
): Omit<Tables<'design_versions'>, 'bundle' | 'session_id' | 'concept_id' | 'created_by'> & { bundle_name: string | null } {
  const { bundle_name, ...rest } = overrides
  const full = makeVersionRow(rest)
  const bundle = full.bundle as { name?: unknown } | null
  const defaultName = bundle && typeof bundle === 'object' && typeof bundle.name === 'string' ? bundle.name : null
  return {
    id: full.id,
    version_no: full.version_no,
    source: full.source,
    summary: full.summary,
    applied_commit_sha: full.applied_commit_sha,
    applied_blobs: full.applied_blobs,
    screenshots: full.screenshots,
    created_at: full.created_at,
    bundle_name: bundle_name !== undefined ? bundle_name : defaultName,
  }
}

export const RID = '3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b'
export const CID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

export function makeRunRow(overrides: Partial<Tables<'design_runs'>> = {}): Tables<'design_runs'> {
  return {
    id: RID,
    session_id: SID,
    status: 'queued',
    stage: 'generate',
    admin_brief: null,
    palette_freedom: 'evolve',
    concept_count: 3,
    input_ids: [],
    capabilities: asJson(DEFAULT_CAPABILITIES),
    base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [], notes: [] }),
    cost_usd: 0,
    cost_cap_usd: 4,
    max_revisions: 2,
    error: null,
    created_by: 'admin-1',
    created_at: '2026-09-25T11:00:00.000Z',
    updated_at: '2026-09-25T11:00:00.000Z',
    ...overrides,
  }
}

export function makeConceptRow(overrides: Partial<Tables<'design_concepts'>> = {}): Tables<'design_concepts'> {
  return {
    id: CID,
    run_id: RID,
    session_id: SID,
    position: 0,
    status: 'pending',
    bundle: asJson(VALID),
    initial_bundle: asJson(VALID),
    critique: null,
    iterations: 0,
    screenshots: asJson([]),
    cost_usd: 0,
    error: null,
    created_at: '2026-09-25T11:00:00.000Z',
    updated_at: '2026-09-25T11:00:00.000Z',
    ...overrides,
  }
}
