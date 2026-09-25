import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import {
  ActiveRunExistsError,
  claimConceptRender,
  createRun,
  finishConceptRender,
  getRun,
  insertConcepts,
  resetConcepts,
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

  it('insertConcepts writes bundle + initial_bundle per row', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: [makeConceptRow()] }] })
    await insertConcepts(f.client, [{ runId: RID, sessionId: SID, position: 0, status: 'pending', bundle: VALID, error: null }])
    const rows = f.opsFor('design_concepts')[0][1] as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({ run_id: RID, session_id: SID, position: 0, status: 'pending', bundle: VALID, initial_bundle: VALID })
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
