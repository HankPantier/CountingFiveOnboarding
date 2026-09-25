import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import {
  ActiveRunExistsError,
  claimConceptPosition,
  claimConceptRender,
  createRun,
  deleteConcepts,
  finishConceptRender,
  getRun,
  resetConcepts,
  settleConceptGeneration,
  transitionRun,
} from './run-store'
import { DEFAULT_CAPABILITIES } from './run-types'

const NEW_RUN = {
  sessionId: SID,
  createdBy: 'admin-1',
  paletteFreedom: 'evolve' as const,
  adminBrief: 'Warmer, more editorial',
  conceptCount: 3,
  inputIds: [],
  capabilities: DEFAULT_CAPABILITIES,
  baseSnapshot: { pagePath: '/', themeShas: {}, screenshots: [], notes: [] },
}

describe('run-store', () => {
  it('createRun inserts a queued run in the generate stage', async () => {
    const f = fakeSupabase({ design_runs: [{ data: makeRunRow() }] })
    await createRun(f.client, NEW_RUN)
    expect(f.opsFor('design_runs')[0][1]).toMatchObject({
      session_id: SID,
      status: 'queued',
      stage: 'generate',
      palette_freedom: 'evolve',
      admin_brief: 'Warmer, more editorial',
      concept_count: 3,
      created_by: 'admin-1',
    })
  })

  it('createRun maps the one-active-run unique violation to ActiveRunExistsError', async () => {
    const f = fakeSupabase({ design_runs: [{ error: { code: '23505', message: 'duplicate key' } }] })
    await expect(createRun(f.client, NEW_RUN)).rejects.toBeInstanceOf(ActiveRunExistsError)
  })

  it('getRun is scoped to the session', async () => {
    const f = fakeSupabase({ design_runs: [{ data: makeRunRow() }] })
    await getRun(f.client, SID, RID)
    expect(f.opsFor('design_runs')).toContainEqual(['eq', 'session_id', SID])
    expect(f.opsFor('design_runs')).toContainEqual(['eq', 'id', RID])
  })

  it('transitionRun is guarded by the allowed from-statuses and stamps updated_at', async () => {
    const f = fakeSupabase({ design_runs: [{ data: null }] })
    const r = await transitionRun(f.client, RID, ['queued'], { status: 'generating', stage: 'generate', costUsd: 0.5 })
    expect(r).toBeNull()
    const ops = f.opsFor('design_runs')
    expect(ops[0][1]).toMatchObject({ status: 'generating', stage: 'generate', cost_usd: 0.5 })
    expect((ops[0][1] as { updated_at: string }).updated_at).toMatch(/^\d{4}-/)
    expect(ops).toContainEqual(['in', 'status', ['queued']])
  })

  it('transitionRun maps a 23505 (reactivating over another active run) to ActiveRunExistsError', async () => {
    const f = fakeSupabase({ design_runs: [{ error: { code: '23505', message: 'dup' } }] })
    await expect(transitionRun(f.client, RID, ['error'], { status: 'queued' })).rejects.toBeInstanceOf(ActiveRunExistsError)
  })

  it('claimConceptPosition inserts a bundle-less generating row for that position', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow({ status: 'generating', bundle: null }) }] })
    const row = await claimConceptPosition(f.client, { runId: RID, sessionId: SID, position: 1 })
    expect(row?.status).toBe('generating')
    const ops = f.opsFor('design_concepts')
    expect(ops[0]).toEqual(['insert', { run_id: RID, session_id: SID, position: 1, status: 'generating', bundle: null, initial_bundle: null, error: null }])
  })

  it('claimConceptPosition returns null when that position is already claimed (unique run_id, position)', async () => {
    const f = fakeSupabase({ design_concepts: [{ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }] })
    expect(await claimConceptPosition(f.client, { runId: RID, sessionId: SID, position: 0 })).toBeNull()
  })

  it('claimConceptPosition throws on any other DB error', async () => {
    const f = fakeSupabase({ design_concepts: [{ error: { code: '23514', message: 'check violation' } }] })
    await expect(claimConceptPosition(f.client, { runId: RID, sessionId: SID, position: 3 })).rejects.toThrow('claimConceptPosition')
  })

  it('settleConceptGeneration stores an accepted bundle (+ initial_bundle), only from generating', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow() }] })
    await settleConceptGeneration(f.client, CID, { status: 'pending', bundle: VALID })
    const ops = f.opsFor('design_concepts')
    expect(ops[0][1]).toMatchObject({ status: 'pending', bundle: VALID, initial_bundle: VALID, error: null })
    expect(ops).toContainEqual(['eq', 'id', CID])
    expect(ops).toContainEqual(['eq', 'status', 'generating'])
  })

  it('settleConceptGeneration stores a rejection with our own error text', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow({ status: 'rejected' }) }] })
    await settleConceptGeneration(f.client, CID, { status: 'rejected', error: 'x'.repeat(1500) })
    const update = f.opsFor('design_concepts')[0][1] as { status: string; bundle: unknown; error: string }
    expect(update.status).toBe('rejected')
    expect(update.bundle).toBeNull()
    expect(update.error).toHaveLength(1000)
  })

  it('deleteConcepts is scoped to the run and a no-op for an empty list', async () => {
    const empty = fakeSupabase({})
    await deleteConcepts(empty.client, RID, [])
    expect(empty.queries).toHaveLength(0)
    const f = fakeSupabase({ design_concepts: [{ data: null }] })
    await deleteConcepts(f.client, RID, [CID])
    expect(f.opsFor('design_concepts')).toEqual([['delete'], ['eq', 'run_id', RID], ['in', 'id', [CID]]])
  })

  it('claimConceptRender only claims a pending concept of this run', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow({ status: 'refining' }) }] })
    await claimConceptRender(f.client, RID, CID)
    const ops = f.opsFor('design_concepts')
    expect(ops[0][1]).toMatchObject({ status: 'refining', error: null })
    expect(ops).toContainEqual(['eq', 'run_id', RID])
    expect(ops).toContainEqual(['eq', 'status', 'pending'])
  })

  it('finishConceptRender moves refining → ready with screenshots', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow({ status: 'ready' }) }] })
    const shots = [{ viewport: 'desktop' as const, path: `design/${SID}/runs/${RID}/a.webp`, width: 1440, height: 900 }]
    await finishConceptRender(f.client, CID, { screenshots: shots, error: null })
    const ops = f.opsFor('design_concepts')
    expect(ops[0][1]).toMatchObject({ status: 'ready', screenshots: shots, error: null })
    expect(ops).toContainEqual(['eq', 'status', 'refining'])
  })

  it('resetConcepts is a no-op for an empty list', async () => {
    const f = fakeSupabase({})
    await resetConcepts(f.client, RID, [])
    expect(f.queries).toHaveLength(0)
  })
})
