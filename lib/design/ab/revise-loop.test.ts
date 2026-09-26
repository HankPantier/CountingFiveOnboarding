import { describe, it, expect } from 'vitest'
import { runReviseLoop, type LoopCritique, type LoopRevision } from './revise-loop'

type C = { mean: number }
const ok = (passed: boolean, mean: number, gateFailures = 0): LoopCritique<C> => ({ kind: 'ok', passed, gateFailures, record: { mean } })

function harness(opts: {
  maxRevisions: number
  critiques: LoopCritique<C>[]
  revisions?: LoopRevision<string>[]
  renders?: (string | null)[]
  capReached?: () => boolean
}) {
  const calls: string[] = []
  const critiques = [...opts.critiques]
  const revisions = [...(opts.revisions ?? [])]
  const renders = [...(opts.renders ?? [])]
  const run = runReviseLoop<string, string, C>(
    { bundle: 'v0', render: 'r0' },
    {
      maxRevisions: opts.maxRevisions,
      capReached: opts.capReached ?? (() => false),
      critique: async (bundle, iteration, render) => {
        calls.push(`critique ${bundle}@${iteration} on ${render}`)
        const next = critiques.shift()
        if (!next) throw new Error('unexpected critique')
        return next
      },
      revise: async (bundle, round, _render, critique) => {
        calls.push(`revise ${bundle} round ${round} from mean ${critique.mean}`)
        return revisions.shift() ?? { kind: 'ok', bundle: `v${round}` }
      },
      render: async (bundle, iteration) => {
        calls.push(`render ${bundle}@${iteration}`)
        return renders.length ? (renders.shift() as string | null) : `r${iteration}`
      },
    }
  )
  return { run, calls }
}

describe('runReviseLoop', () => {
  it('a first draft that passes ends at once: no revision', async () => {
    const h = harness({ maxRevisions: 2, critiques: [ok(true, 4.2)] })
    const r = await h.run
    expect(r).toMatchObject({ outcome: 'passed', finalBundle: 'v0', revisionsUsed: 0, firstCritique: { mean: 4.2 }, finalCritique: { mean: 4.2 }, critiques: 1 })
    expect(h.calls).toEqual(['critique v0@0 on r0'])
  })

  it('revises until it passes, re-rendering and re-critiquing each revision', async () => {
    const h = harness({ maxRevisions: 2, critiques: [ok(false, 3), ok(true, 4)] })
    const r = await h.run
    expect(r).toMatchObject({ outcome: 'passed', finalBundle: 'v1', revisionsUsed: 1, firstCritique: { mean: 3 }, finalCritique: { mean: 4 }, critiques: 2 })
    expect(h.calls).toEqual(['critique v0@0 on r0', 'revise v0 round 1 from mean 3', 'render v1@1', 'critique v1@1 on r1'])
  })

  it('stops at maxRevisions with the last critique as final', async () => {
    const h = harness({ maxRevisions: 2, critiques: [ok(false, 3), ok(false, 3.3), ok(false, 3.5)] })
    const r = await h.run
    expect(r).toMatchObject({ outcome: 'max_revisions', finalBundle: 'v2', revisionsUsed: 2, finalCritique: { mean: 3.5 }, critiques: 3 })
  })

  it('maxRevisions 0 (no --revise) is exactly one critique', async () => {
    const r = await harness({ maxRevisions: 0, critiques: [ok(false, 2)] }).run
    expect(r).toMatchObject({ outcome: 'max_revisions', revisionsUsed: 0, critiques: 1, firstCritique: { mean: 2 }, finalCritique: { mean: 2 } })
  })

  it('a rubric pass with a render-check failure still revises (production rule)', async () => {
    const r = await harness({ maxRevisions: 1, critiques: [ok(true, 4.5, 1), ok(true, 4.5, 0)] }).run
    expect(r).toMatchObject({ outcome: 'passed', revisionsUsed: 1 })
  })

  it('ends on the run cap reported to decideAfterCritique', async () => {
    const r = await harness({ maxRevisions: 2, critiques: [ok(false, 3)], capReached: () => true }).run
    expect(r).toMatchObject({ outcome: 'cost_cap', revisionsUsed: 0, finalCritique: { mean: 3 } })
  })

  it('a revision refused by the budget keeps the critiqued bundle', async () => {
    const r = await harness({ maxRevisions: 2, critiques: [ok(false, 3)], revisions: [{ kind: 'skipped_cap' }] }).run
    expect(r).toMatchObject({ outcome: 'cost_cap', finalBundle: 'v0', revisionsUsed: 0, finalCritique: { mean: 3 } })
  })

  it('an invalid revision keeps the previous bundle and its critique', async () => {
    const r = await harness({ maxRevisions: 2, critiques: [ok(false, 3), ok(false, 3.4)], revisions: [{ kind: 'ok', bundle: 'v1' }, { kind: 'invalid' }] }).run
    expect(r).toMatchObject({ outcome: 'invalid_revision', finalBundle: 'v1', revisionsUsed: 1, finalCritique: { mean: 3.4 } })
  })

  it('an unrenderable revision ends not_rendered, the revision kept but uncritiqued', async () => {
    const r = await harness({ maxRevisions: 2, critiques: [ok(false, 3)], renders: [null] }).run
    expect(r).toMatchObject({ outcome: 'not_rendered', finalBundle: 'v1', revisionsUsed: 1, finalCritique: null, firstCritique: { mean: 3 } })
  })

  it('a failed or cap-skipped critique ends the loop without a final critique', async () => {
    expect(await harness({ maxRevisions: 2, critiques: [{ kind: 'failed' }] }).run).toMatchObject({ outcome: 'critic_unavailable', firstCritique: null, finalCritique: null })
    expect(await harness({ maxRevisions: 2, critiques: [ok(false, 3), { kind: 'skipped_cap' }] }).run).toMatchObject({
      outcome: 'cost_cap',
      finalBundle: 'v1',
      revisionsUsed: 1,
      firstCritique: { mean: 3 },
      finalCritique: null,
    })
  })
})
