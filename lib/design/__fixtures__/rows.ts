import type { Tables } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
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
