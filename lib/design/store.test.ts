import { describe, it, expect, vi, afterEach } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { IID, SID, makeInputRow, makeVersionListRow, makeVersionRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import {
  BASELINE_SUMMARY,
  INSERT_VERSION_ATTEMPTS,
  VersionConflictError,
  claimCapture,
  createInput,
  deleteInput,
  getBaselineOrCreate,
  getInput,
  insertVersion,
  latestVersion,
  listInputs,
  listVersions,
  readSessionSchema,
  updateInput,
} from './store'

const BLOBS = { 'content/brand.json': 'a'.repeat(40) }

afterEach(() => vi.restoreAllMocks())

describe('inputs', () => {
  it('listInputs scopes by session, oldest first', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: [makeInputRow()] }] })
    expect(await listInputs(f.client, SID)).toHaveLength(1)
    expect(f.opsFor('design_inputs')).toEqual([
      ['select', '*'],
      ['eq', 'session_id', SID],
      ['order', 'created_at', { ascending: true }],
    ])
  })

  it('getInput is scoped by id AND session; null when absent', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: null }] })
    expect(await getInput(f.client, SID, IID)).toBeNull()
    const ops = f.opsFor('design_inputs')
    expect(ops).toContainEqual(['eq', 'id', IID])
    expect(ops).toContainEqual(['eq', 'session_id', SID])
  })

  it('createInput maps fields and defaults capture_status to none', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow() }] })
    await createInput(f.client, { sessionId: SID, kind: 'competitor_url', url: 'https://acme.example.com/', label: 'Acme CPA', createdBy: 'admin-1' })
    expect(f.opsFor('design_inputs')[0]).toEqual([
      'insert',
      {
        session_id: SID,
        kind: 'competitor_url',
        url: 'https://acme.example.com/',
        label: 'Acme CPA',
        notes: null,
        storage_path: null,
        capture_status: 'none',
        captured_at: null,
        created_by: 'admin-1',
      },
    ])
  })

  it('createInput passes a caller-chosen id through', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow() }] })
    await createInput(f.client, { id: IID, sessionId: SID, kind: 'inspiration_image', url: null, createdBy: null })
    expect(f.opsFor('design_inputs')[0][1]).toMatchObject({ id: IID, url: null })
  })

  it('createInput throws on a DB error', async () => {
    const f = fakeSupabase({ design_inputs: [{ error: { message: 'boom' } }] })
    await expect(createInput(f.client, { sessionId: SID, kind: 'current_site', url: 'https://a.com/', createdBy: null })).rejects.toThrow('createInput')
  })

  it('updateInput writes only the given fields plus updated_at, scoped', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow({ archived: true }) }] })
    const row = await updateInput(f.client, SID, IID, { archived: true, notes: null })
    expect(row?.archived).toBe(true)
    const [op, payload] = f.opsFor('design_inputs')[0] as [string, Record<string, unknown>]
    expect(op).toBe('update')
    expect(Object.keys(payload).sort()).toEqual(['archived', 'notes', 'updated_at'])
    expect(f.opsFor('design_inputs')).toContainEqual(['eq', 'session_id', SID])
  })

  it('updateInput returns null for an input in another session', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: null }] })
    expect(await updateInput(f.client, SID, IID, { label: 'x' })).toBeNull()
  })

  it('claimCapture only claims a non-pending URL input', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow({ capture_status: 'pending' }) }] })
    const row = await claimCapture(f.client, SID, IID)
    expect(row?.capture_status).toBe('pending')
    const ops = f.opsFor('design_inputs')
    expect(ops[0][0]).toBe('update')
    expect(ops[0][1]).toMatchObject({ capture_status: 'pending', capture_error: null })
    expect(ops).toContainEqual(['neq', 'capture_status', 'pending'])
    expect(ops).toContainEqual(['neq', 'kind', 'inspiration_image'])
    expect(ops).toContainEqual(['eq', 'session_id', SID])
  })

  it('deleteInput deletes the row then its storage object', async () => {
    const path = `design/${SID}/inputs/${IID}.webp`
    const f = fakeSupabase({ design_inputs: [{ data: { id: IID, storage_path: path } }] })
    expect(await deleteInput(f.client, SID, IID)).toBe(true)
    expect(f.opsFor('design_inputs')).toContainEqual(['eq', 'session_id', SID])
    expect(f.storageRemovals).toEqual([[path]])
  })

  it('deleteInput returns false (and touches no storage) when not found', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: null }] })
    expect(await deleteInput(f.client, SID, IID)).toBe(false)
    expect(f.storageRemovals).toEqual([])
  })

  it('deleteInput survives a storage cleanup failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fakeSupabase({
      design_inputs: [{ data: { id: IID, storage_path: `design/${SID}/inputs/x.webp` } }],
      'storage.remove': [{ error: { message: 'nope' } }],
    })
    expect(await deleteInput(f.client, SID, IID)).toBe(true)
    expect(warn).toHaveBeenCalled()
  })
})

describe('versions', () => {
  it('listVersions is newest first and scoped, and never selects the full bundle JSONB', async () => {
    const f = fakeSupabase({ design_versions: [{ data: [makeVersionListRow()] }] })
    const rows = await listVersions(f.client, SID)
    expect(rows[0].bundle_name).toBe('Baseline')
    expect(f.opsFor('design_versions')).toContainEqual(['order', 'version_no', { ascending: false }])
    expect(f.opsFor('design_versions')).toContainEqual(['eq', 'session_id', SID])
    const [selectOp, columns] = f.opsFor('design_versions')[0] as [string, string]
    expect(selectOp).toBe('select')
    expect(columns).not.toContain('bundle,')
    expect(columns).not.toMatch(/(^|\s|,)bundle(\s|,|$)/)
    expect(columns).toContain('bundle_name:bundle->>name')
  })

  it('latestVersion returns null when there are none', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }] })
    expect(await latestVersion(f.client, SID)).toBeNull()
  })

  const NEW = { sessionId: SID, source: 'chat' as const, bundle: VALID, summary: 'Calmer cards', appliedCommitSha: 'c'.repeat(40), appliedBlobs: BLOBS, createdBy: 'admin-1' }

  it('insertVersion allocates version 0 on an empty history', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }, { data: makeVersionRow({ version_no: 0, source: 'chat' }) }] })
    await insertVersion(f.client, NEW)
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({ version_no: 0, source: 'chat', session_id: SID, applied_blobs: BLOBS, concept_id: null })
  })

  it('insertVersion retries max+1 on a 23505 unique violation', async () => {
    const f = fakeSupabase({
      design_versions: [
        { data: makeVersionRow({ version_no: 2 }) },
        { error: { code: '23505', message: 'duplicate key' } },
        { data: makeVersionRow({ version_no: 3 }) },
        { data: makeVersionRow({ id: 'ver-4', version_no: 4 }) },
      ],
    })
    const row = await insertVersion(f.client, NEW)
    expect(row.version_no).toBe(4)
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({ version_no: 3 })
    expect(f.opsFor('design_versions', 3)[0][1]).toMatchObject({ version_no: 4 })
  })

  it(`insertVersion gives up after ${INSERT_VERSION_ATTEMPTS} conflicts`, async () => {
    const results = []
    for (let i = 0; i < INSERT_VERSION_ATTEMPTS; i++) {
      results.push({ data: makeVersionRow({ version_no: i }) }, { error: { code: '23505', message: 'dup' } })
    }
    const f = fakeSupabase({ design_versions: results })
    await expect(insertVersion(f.client, NEW)).rejects.toBeInstanceOf(VersionConflictError)
  })

  it('insertVersion stores screenshots when given, [] otherwise', async () => {
    const shot = { viewport: 'desktop' as const, path: `design/${SID}/runs/r/a.webp`, width: 1440, height: 900 }
    const f = fakeSupabase({ design_versions: [{ data: null }, { data: makeVersionRow() }, { data: null }, { data: makeVersionRow() }] })
    await insertVersion(f.client, { ...NEW, screenshots: [shot] })
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({ screenshots: [shot] })
    await insertVersion(f.client, NEW)
    expect(f.opsFor('design_versions', 3)[0][1]).toMatchObject({ screenshots: [] })
  })

  it('insertVersion rethrows a non-conflict error immediately', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }, { error: { code: '42501', message: 'denied' } }] })
    await expect(insertVersion(f.client, NEW)).rejects.toThrow('insertVersion')
  })
})

describe('getBaselineOrCreate', () => {
  const ok = { ok: true as const, bundle: { ...VALID, name: 'Baseline', meta: { source: 'baseline' as const } } }

  it('returns the existing latest version without inserting', async () => {
    const f = fakeSupabase({ design_versions: [{ data: makeVersionRow({ version_no: 3 }) }] })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: 'admin-1', source: ok, appliedBlobs: BLOBS })
    expect(r).toMatchObject({ status: 'existing' })
    expect(f.queries).toHaveLength(1)
  })

  it('creates v0 from the draft bundle', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }, { data: makeVersionRow() }] })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: 'admin-1', source: ok, appliedBlobs: BLOBS })
    expect(r.status).toBe('created')
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({
      version_no: 0,
      source: 'baseline',
      summary: BASELINE_SUMMARY,
      applied_blobs: BLOBS,
      applied_commit_sha: null,
      created_by: 'admin-1',
    })
  })

  it('reports an import error without inserting', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }] })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: null, source: { ok: false, errors: ['bad font', 'bad css'] }, appliedBlobs: {} })
    expect(r).toEqual({ status: 'error', error: 'bad font bad css' })
    expect(f.queries).toHaveLength(1)
  })

  it('treats a concurrent v0 insert (23505) as existing', async () => {
    const f = fakeSupabase({
      design_versions: [{ data: null }, { error: { code: '23505', message: 'dup' } }, { data: makeVersionRow() }],
    })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: null, source: ok, appliedBlobs: BLOBS })
    expect(r).toMatchObject({ status: 'existing' })
  })
})

describe('readSessionSchema', () => {
  it('returns schema_data', async () => {
    const f = fakeSupabase({ sessions: [{ data: { schema_data: { websiteUrl: 'x.com' } } }] })
    expect(await readSessionSchema(f.client, SID)).toEqual({ websiteUrl: 'x.com' })
    expect(f.opsFor('sessions')).toContainEqual(['eq', 'id', SID])
  })
})
