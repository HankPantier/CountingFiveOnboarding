// Pure control flow of the A/B script's critique → revise loop (--revise). It
// is the production loop's decision (review.ts decideAfterCritique — the same
// function refine-stage's critique unit calls) driven in-process: critique the
// concept's render, then pass (rubric pass AND no render-check failure) ends
// it; otherwise revise while revisions and budget remain, render the revision,
// and critique again. The side effects (model calls, renders, cap checks) are
// injected, so the script reuses the real critic / reviser / renderer and the
// loop's termination is unit-testable with canned critiques.
//
// How a loop ends (ReviewOutcome, as refine-stage records it):
//   passed / max_revisions / cost_cap — decideAfterCritique
//   cost_cap           — a critique or revision was refused by the budget
//   critic_unavailable — a critique came back unusable
//   invalid_revision   — the revision was unusable (the previous bundle stays)
//   not_rendered       — the revision could not be rendered (it stays, uncritiqued)
import { decideAfterCritique, type ReviewOutcome } from '../review'

export type LoopCritique<C> = { kind: 'ok'; passed: boolean; gateFailures: number; record: C } | { kind: 'skipped_cap' } | { kind: 'failed' }
export type LoopRevision<B> = { kind: 'ok'; bundle: B } | { kind: 'skipped_cap' } | { kind: 'invalid' }

export type ReviseLoopDeps<B, R, C> = {
  maxRevisions: number
  // The run-level "cap reached" input to decideAfterCritique.
  capReached: () => boolean
  critique: (bundle: B, iteration: number, render: R) => Promise<LoopCritique<C>>
  revise: (bundle: B, round: number, render: R, critique: C) => Promise<LoopRevision<B>>
  // null ⇒ no desktop render (uncritiquable)
  render: (bundle: B, iteration: number) => Promise<R | null>
}

export type ReviseLoopResult<B, C> = {
  outcome: ReviewOutcome
  finalBundle: B
  revisionsUsed: number // accepted revisions (the final bundle's iteration)
  firstCritique: C | null
  // The critique of the FINAL bundle; null when it was never critiqued (the
  // critique failed / was skipped, or a revision could not be rendered).
  finalCritique: C | null
  critiques: number // critique calls attempted (incl. failed ones)
}

export async function runReviseLoop<B, R, C>(start: { bundle: B; render: R }, deps: ReviseLoopDeps<B, R, C>): Promise<ReviseLoopResult<B, C>> {
  const maxRevisions = Math.max(0, Math.floor(deps.maxRevisions))
  let bundle = start.bundle
  let render = start.render
  let iteration = 0
  let critiques = 0
  let firstCritique: C | null = null
  const end = (outcome: ReviewOutcome, finalCritique: C | null): ReviseLoopResult<B, C> => ({
    outcome,
    finalBundle: bundle,
    revisionsUsed: iteration,
    firstCritique,
    finalCritique,
    critiques,
  })

  // Bounded: every pass either ends or accepts one revision, and
  // decideAfterCritique ends the loop once iteration reaches maxRevisions.
  for (;;) {
    critiques++
    const c = await deps.critique(bundle, iteration, render)
    if (c.kind === 'skipped_cap') return end('cost_cap', null)
    if (c.kind === 'failed') return end('critic_unavailable', null)
    if (iteration === 0) firstCritique = c.record
    const decision = decideAfterCritique({ passed: c.passed, gateFailures: c.gateFailures, iterations: iteration, maxRevisions, capReached: deps.capReached() })
    if (decision.kind === 'done') return end(decision.outcome, c.record)

    const round = iteration + 1
    const r = await deps.revise(bundle, round, render, c.record)
    if (r.kind === 'skipped_cap') return end('cost_cap', c.record)
    if (r.kind === 'invalid') return end('invalid_revision', c.record)
    bundle = r.bundle
    iteration = round
    const next = await deps.render(bundle, iteration)
    if (next === null) return end('not_rendered', null)
    render = next
  }
}
