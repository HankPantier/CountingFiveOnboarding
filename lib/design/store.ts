// Server-only. Typed data access for the Design Studio tables (migration 078).
// Every input/version read or write is scoped by session_id as well as id, so a
// client-supplied id from another session is simply "not found". Throws on DB
// errors (routes map them to internalError); never returns raw error text to
// the client itself.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import type { DesignBundle } from './bundle'
import { removeDesignPaths } from './storage'
import type { RunScreenshot } from './run-types'
import type { DesignVersionListRow } from './studio-dto'
import type { CaptureStatus, DesignInputKind, ThemeBlobShas, VersionSource } from './studio-types'

type Db = SupabaseClient<Database>
export type DesignInputRow = Tables<'design_inputs'>
export type DesignVersionRow = Tables<'design_versions'>

const UNIQUE_VIOLATION = '23505'
export const INSERT_VERSION_ATTEMPTS = 3
export const BASELINE_SUMMARY = 'Baseline — imported from the current draft'
// The name of a version recorded by "Capture as version" (POST design/versions/import).
export const CAPTURED_NAME = 'Captured draft'

export class VersionConflictError extends Error {
  constructor(sessionId: string) {
    super(`Could not allocate a design version number for session ${sessionId}`)
    this.name = 'VersionConflictError'
  }
}

function storeError(context: string, error: { message: string } | null): Error {
  return new Error(`[design-store] ${context}: ${error?.message ?? 'no data returned'}`)
}

// ---------------------------------------------------------------- inputs

export async function listInputs(db: Db, sessionId: string): Promise<DesignInputRow[]> {
  const { data, error } = await db
    .from('design_inputs')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw storeError('listInputs', error)
  return data ?? []
}

export async function getInput(db: Db, sessionId: string, inputId: string): Promise<DesignInputRow | null> {
  const { data, error } = await db
    .from('design_inputs')
    .select('*')
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw storeError('getInput', error)
  return data
}

export type NewDesignInput = {
  id?: string
  sessionId: string
  kind: DesignInputKind
  url: string | null
  label?: string | null
  notes?: string | null
  storagePath?: string | null
  captureStatus?: CaptureStatus
  capturedAt?: string | null
  createdBy: string | null
}

export async function createInput(db: Db, input: NewDesignInput): Promise<DesignInputRow> {
  const row: TablesInsert<'design_inputs'> = {
    session_id: input.sessionId,
    kind: input.kind,
    url: input.url,
    label: input.label ?? null,
    notes: input.notes ?? null,
    storage_path: input.storagePath ?? null,
    capture_status: input.captureStatus ?? 'none',
    captured_at: input.capturedAt ?? null,
    created_by: input.createdBy,
  }
  if (input.id) row.id = input.id
  const { data, error } = await db.from('design_inputs').insert(row).select('*').single()
  if (error || !data) throw storeError('createInput', error)
  return data
}

export type DesignInputPatch = {
  label?: string | null
  notes?: string | null
  archived?: boolean
  captureStatus?: CaptureStatus
  captureError?: string | null
  storagePath?: string | null
  capturedAt?: string | null
}

export async function updateInput(
  db: Db,
  sessionId: string,
  inputId: string,
  patch: DesignInputPatch
): Promise<DesignInputRow | null> {
  const update: TablesUpdate<'design_inputs'> = { updated_at: new Date().toISOString() }
  if (patch.label !== undefined) update.label = patch.label
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.archived !== undefined) update.archived = patch.archived
  if (patch.captureStatus !== undefined) update.capture_status = patch.captureStatus
  if (patch.captureError !== undefined) update.capture_error = patch.captureError
  if (patch.storagePath !== undefined) update.storage_path = patch.storagePath
  if (patch.capturedAt !== undefined) update.captured_at = patch.capturedAt
  const { data, error } = await db
    .from('design_inputs')
    .update(update)
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .select('*')
    .maybeSingle()
  if (error) throw storeError('updateInput', error)
  return data
}

// Atomic claim (mirrors generateSinglePage's .neq guard): flips a URL input to
// 'pending' only if it is not already pending. null = not found in this
// session, an uploaded image, or a capture already in flight.
export async function claimCapture(db: Db, sessionId: string, inputId: string): Promise<DesignInputRow | null> {
  const { data, error } = await db
    .from('design_inputs')
    .update({ capture_status: 'pending', capture_error: null, updated_at: new Date().toISOString() })
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .neq('capture_status', 'pending')
    .neq('kind', 'inspiration_image')
    .select('*')
    .maybeSingle()
  if (error) throw storeError('claimCapture', error)
  return data
}

// Row first, then the object (best-effort): an orphaned private object is
// harmless; a row pointing at a deleted object would show a broken thumbnail.
export async function deleteInput(db: Db, sessionId: string, inputId: string): Promise<boolean> {
  const { data, error } = await db
    .from('design_inputs')
    .delete()
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .select('id, storage_path')
    .maybeSingle()
  if (error) throw storeError('deleteInput', error)
  if (!data) return false
  if (data.storage_path) {
    try {
      await removeDesignPaths(db, [data.storage_path])
    } catch (err) {
      console.warn('[design-store] input image cleanup failed (row deleted):', err)
    }
  }
  return true
}

// ---------------------------------------------------------------- versions

// Narrow select for the version list: never the full `bundle` JSONB (Minor
// #3 in the P2 final review) — just the columns the DTO + drift check need,
// with the bundle's name pulled out via a JSON path alias.
const VERSION_LIST_COLUMNS = 'id, version_no, source, summary, applied_commit_sha, applied_blobs, screenshots, created_at, bundle_name:bundle->>name'

export async function listVersions(db: Db, sessionId: string): Promise<DesignVersionListRow[]> {
  const { data, error } = await db
    .from('design_versions')
    .select(VERSION_LIST_COLUMNS)
    .eq('session_id', sessionId)
    .order('version_no', { ascending: false })
    .limit(200)
  if (error) throw storeError('listVersions', error)
  return (data ?? []).map(
    (row): DesignVersionListRow => ({
      id: row.id,
      version_no: row.version_no,
      source: row.source,
      summary: row.summary,
      applied_commit_sha: row.applied_commit_sha,
      applied_blobs: row.applied_blobs,
      screenshots: row.screenshots,
      created_at: row.created_at,
      bundle_name: typeof row.bundle_name === 'string' ? row.bundle_name : null,
    }),
  )
}

export async function latestVersion(db: Db, sessionId: string): Promise<DesignVersionRow | null> {
  const { data, error } = await db
    .from('design_versions')
    .select('*')
    .eq('session_id', sessionId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw storeError('latestVersion', error)
  return data
}

// One FULL version row (incl. its bundle) — for restore. Scoped by session.
export async function getVersion(db: Db, sessionId: string, versionId: string): Promise<DesignVersionRow | null> {
  const { data, error } = await db.from('design_versions').select('*').eq('id', versionId).eq('session_id', sessionId).maybeSingle()
  if (error) throw storeError('getVersion', error)
  return data
}

export type NewDesignVersion = {
  sessionId: string
  source: VersionSource
  bundle: DesignBundle
  summary: string | null
  appliedCommitSha: string | null
  // The FULL post-apply blob shas of all four theme files (+ fonts module on
  // L2+) (drift compares against this) — not just the paths the commit changed.
  appliedBlobs: ThemeBlobShas
  conceptId?: string | null
  createdBy: string | null
  // Render screenshots to show with the version (concept applies reuse the run's).
  screenshots?: RunScreenshot[]
}

function versionInsert(v: NewDesignVersion, versionNo: number): TablesInsert<'design_versions'> {
  return {
    session_id: v.sessionId,
    version_no: versionNo,
    source: v.source,
    bundle: asJson(v.bundle),
    summary: v.summary,
    applied_commit_sha: v.appliedCommitSha,
    applied_blobs: asJson(v.appliedBlobs),
    concept_id: v.conceptId ?? null,
    created_by: v.createdBy,
    screenshots: asJson(v.screenshots ?? []),
  }
}

// The highest version_no for a session (null when there are none). Narrow
// select: allocation needs only the number, never the bundle/screenshots JSONB.
async function latestVersionNo(db: Db, sessionId: string): Promise<number | null> {
  const { data, error } = await db
    .from('design_versions')
    .select('version_no')
    .eq('session_id', sessionId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw storeError('latestVersionNo', error)
  return data ? data.version_no : null
}

// Whether the session has any version at all (the v0 baseline comes first).
export async function hasAnyVersion(db: Db, sessionId: string): Promise<boolean> {
  return (await latestVersionNo(db, sessionId)) !== null
}

// version_no = max + 1, retried on a unique violation (a concurrent insert
// took the number) up to INSERT_VERSION_ATTEMPTS times.
export async function insertVersion(db: Db, v: NewDesignVersion): Promise<DesignVersionRow> {
  for (let attempt = 1; attempt <= INSERT_VERSION_ATTEMPTS; attempt++) {
    const latestNo = await latestVersionNo(db, v.sessionId)
    const versionNo = latestNo === null ? 0 : latestNo + 1
    const { data, error } = await db.from('design_versions').insert(versionInsert(v, versionNo)).select('*').single()
    if (!error && data) return data
    if (error?.code !== UNIQUE_VIOLATION) throw storeError('insertVersion', error)
  }
  throw new VersionConflictError(v.sessionId)
}

export type BaselineSource = { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] }
export type BaselineOutcome =
  | { status: 'existing'; latest: DesignVersionRow }
  | { status: 'created'; latest: DesignVersionRow }
  | { status: 'error'; error: string }

// v0 = the current draft imported as a bundle, created lazily on the first
// Studio load. Inserted with an EXPLICIT version_no 0 (not max+1) so two
// concurrent first loads can't create two baselines: the loser's 23505 just
// re-reads the winner.
export async function getBaselineOrCreate(
  db: Db,
  args: { sessionId: string; createdBy: string | null; source: BaselineSource; appliedBlobs: ThemeBlobShas }
): Promise<BaselineOutcome> {
  const latest = await latestVersion(db, args.sessionId)
  if (latest) return { status: 'existing', latest }
  if (!args.source.ok) return { status: 'error', error: args.source.errors.join(' ') }

  const { data, error } = await db
    .from('design_versions')
    .insert(
      versionInsert(
        {
          sessionId: args.sessionId,
          source: 'baseline',
          bundle: args.source.bundle,
          summary: BASELINE_SUMMARY,
          appliedCommitSha: null,
          appliedBlobs: args.appliedBlobs,
          createdBy: args.createdBy,
        },
        0
      )
    )
    .select('*')
    .single()
  if (!error && data) return { status: 'created', latest: data }
  if (error?.code === UNIQUE_VIOLATION) {
    const winner = await latestVersion(db, args.sessionId)
    if (winner) return { status: 'existing', latest: winner }
  }
  throw storeError('getBaselineOrCreate', error)
}

// ---------------------------------------------------------------- session

export async function readSessionSchema(db: Db, sessionId: string): Promise<unknown> {
  const { data, error } = await db.from('sessions').select('schema_data').eq('id', sessionId).maybeSingle()
  if (error) throw storeError('readSessionSchema', error)
  return data?.schema_data ?? null
}
