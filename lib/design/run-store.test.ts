import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import {
  ActiveRunExistsError,
  claimConceptPosition,
  claimConceptRender,
  claimConceptUnit,
  createRun,
  deleteConcepts,
  getRun,
  resetConcepts,
  resumeConcepts,
  resumeParkedConcept,
  settleConceptGeneration,
  settleConceptUnit,
  settleInitialRender,
  transitionRun,
} from './run-store'
import { DEFAULT_CAPABILITIES, DEFAULT_RUN_COST_CAP_USD } from './run-types'
import { newReview } from './review'
import { asJson } from '@/lib/supabase/json-typed'

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
      cost_cap_usd: 6,
    })
    expect(DEFAULT_RUN_COST_CAP_USD).toBe(6)
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

  it('resetConcepts is a no-op for an empty list', async () => {
    const f = fakeSupabase({})
    await resetConcepts(f.client, RID, [])
    expect(f.queries).toHaveLength(0)
  })
})

describe('run-store — critique-loop claims', () => {
  const READ_AT = '2026-09-25T11:00:00.000+00:00'

  it('claimConceptUnit is a CAS on (run, refining, updated_at as read) and stamps the claim', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow({ status: 'refining' }) }] })
    await claimConceptUnit(f.client, RID, { id: CID, updated_at: READ_AT }, 'critique', { ...newReview(), next: 'critique' })
    const ops = f.opsFor('design_concepts')
    const update = ops[0][1] as { critique: { claim: { unit: string; at: string }; next: string }; updated_at: string }
    expect(update.critique.claim.unit).toBe('critique')
    expect(update.critique.next).toBe('critique')
    expect(update.critique.claim.at).toBe(update.updated_at)
    expect(Date.parse(update.updated_at)).toBeGreaterThan(Date.parse(READ_AT))
    for (const op of [['eq', 'id', CID], ['eq', 'run_id', RID], ['eq', 'status', 'refining'], ['eq', 'updated_at', READ_AT]]) expect(ops).toContainEqual(op)
  })

  it('claimConceptUnit stamps strictly after the row’s updated_at even if the clock lags', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const f = fakeSupabase({ design_concepts: [{ data: null }] })
    expect(await claimConceptUnit(f.client, RID, { id: CID, updated_at: future }, 'revise', newReview())).toBeNull()
    const update = f.opsFor('design_concepts')[0][1] as { updated_at: string }
    expect(Date.parse(update.updated_at)).toBe(Date.parse(future) + 1)
  })

  it('settleConceptUnit clears the claim, writes bundle / iterations / screenshots only when given, CAS on the claimed stamp', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow() }, { data: makeConceptRow() }] })
    const claimed = { id: CID, updated_at: READ_AT }
    const review = { ...newReview(), next: 'render' as const, claim: { unit: 'revise' as const, at: READ_AT } }
    await settleConceptUnit(f.client, RID, claimed, { status: 'refining', review, bundle: VALID, iterations: 1 })
    const first = f.opsFor('design_concepts', 0)
    const u1 = first[0][1] as Record<string, unknown>
    expect(u1).toMatchObject({ status: 'refining', bundle: VALID, iterations: 1 })
    expect((u1.critique as { claim: unknown }).claim).toBeNull()
    expect('screenshots' in u1).toBe(false)
    expect('initial_bundle' in u1).toBe(false)
    expect(first).toContainEqual(['eq', 'updated_at', READ_AT])
    await settleConceptUnit(f.client, RID, claimed, { status: 'ready', review, screenshots: [], error: null })
    const u2 = f.opsFor('design_concepts', 1)[0][1] as Record<string, unknown>
    expect(u2).toMatchObject({ status: 'ready', screenshots: [], error: null })
    expect('bundle' in u2).toBe(false)
  })

  it('settleInitialRender is a CAS on the row the pending → refining claim returned (refining + its updated_at), stamped strictly later', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: makeConceptRow() }] })
    await settleInitialRender(f.client, RID, { id: CID, updated_at: READ_AT }, { status: 'refining', review: { ...newReview(), next: 'critique' }, screenshots: [], error: null })
    const ops = f.opsFor('design_concepts')
    for (const op of [['eq', 'id', CID], ['eq', 'run_id', RID], ['eq', 'status', 'refining'], ['eq', 'updated_at', READ_AT]]) expect(ops).toContainEqual(op)
    const update = ops[0][1] as { updated_at: string; critique: { claim: unknown; next: string } }
    expect(Date.parse(update.updated_at)).toBeGreaterThan(Date.parse(READ_AT))
    expect(update.critique).toMatchObject({ claim: null, next: 'critique' })
  })

  it('settleInitialRender from a late worker (row swept, retried and re-claimed since) matches nothing and returns null', async () => {
    // The DB finds no row with the late worker's claimed stamp: no update applies.
    const f = fakeSupabase({ design_concepts: [{ data: null }] })
    const lateClaim = { id: CID, updated_at: '2026-09-25T10:40:00.000+00:00' }
    expect(await settleInitialRender(f.client, RID, lateClaim, { status: 'refining', review: { ...newReview(), next: 'critique' }, screenshots: [], error: null })).toBeNull()
    expect(f.opsFor('design_concepts')).toContainEqual(['eq', 'updated_at', lateClaim.updated_at])
  })

  it('resumeConcepts puts loop concepts back to refining with no claim and without attempt notes', async () => {
    const row = makeConceptRow({
      status: 'error',
      error: 'Concept timed out (swept by cron)',
      critique: asJson({ ...newReview(), next: 'critique', claim: { unit: 'critique', at: READ_AT }, notes: ['Render skipped: x', 'keep me'] }),
    })
    const f = fakeSupabase({ design_concepts: [{ data: null }] })
    await resumeConcepts(f.client, RID, [row, makeConceptRow({ id: 'no-review', critique: null })])
    expect(f.queries).toHaveLength(1)
    const update = f.opsFor('design_concepts')[0][1] as { status: string; error: null; critique: { claim: unknown; notes: string[]; next: string } }
    expect(update).toMatchObject({ status: 'refining', error: null })
    expect(update.critique).toMatchObject({ claim: null, notes: ['keep me'], next: 'critique' })
  })
})

describe('run-store — Retry parks all but the first mid-loop concept (PF3)', () => {
  const READ_AT = '2026-09-25T11:00:00.000+00:00'
  it('resumeConcepts: only the first by position goes back to refining; the rest are parked pending with their review kept', async () => {
    const reviewA = { ...newReview(), next: 'revise' as const, claim: { unit: 'revise' as const, at: READ_AT }, notes: ['Render skipped: y', 'a-note'] }
    const reviewB = { ...newReview(), next: 'critique' as const, metricsIteration: 1, notes: ['b-note'] }
    const b = makeConceptRow({ id: 'b', position: 1, status: 'error', critique: asJson(reviewB) })
    const a = makeConceptRow({ id: 'a', position: 0, status: 'refining', critique: asJson(reviewA) })
    const f = fakeSupabase({ design_concepts: [{ data: null }, { data: null }] })
    await resumeConcepts(f.client, RID, [b, a])
    const first = f.opsFor('design_concepts', 0)
    const second = f.opsFor('design_concepts', 1)
    expect(first).toContainEqual(['eq', 'id', 'a'])
    expect(first[0][1]).toMatchObject({ status: 'refining', error: null, critique: { next: 'revise', claim: null, notes: ['a-note'] } })
    expect(second).toContainEqual(['eq', 'id', 'b'])
    expect(second).toContainEqual(['eq', 'run_id', RID])
    expect(second[0][1]).toMatchObject({ status: 'pending', error: null, critique: { next: 'critique', claim: null, metricsIteration: 1, notes: ['b-note'] } })
  })

  it('resumeParkedConcept is a CAS on (run, pending, updated_at as read), stamped strictly later, review untouched', async () => {
    const f = fakeSupabase({ design_concepts: [{ data: null }] })
    expect(await resumeParkedConcept(f.client, RID, { id: CID, updated_at: READ_AT })).toBeNull()
    const ops = f.opsFor('design_concepts')
    const update = ops[0][1] as Record<string, unknown>
    expect(update).toMatchObject({ status: 'refining', error: null })
    expect('critique' in update).toBe(false)
    expect(Date.parse(update.updated_at as string)).toBeGreaterThan(Date.parse(READ_AT))
    for (const op of [['eq', 'id', CID], ['eq', 'run_id', RID], ['eq', 'status', 'pending'], ['eq', 'updated_at', READ_AT]]) expect(ops).toContainEqual(op)
  })
})
