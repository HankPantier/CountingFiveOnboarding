// Pure. The design-model A/B script's spend cap (scripts/compare-design-models.ts).
// Before EVERY model call (concept or critic) the script asks `admit` with
// that call's projected worst-case cost (estimated input + the attempt's full
// max output at the model's rates). A projection that would push the running
// total past the cap trips the budget: that call and every later one is
// skipped ("skipped (cap)"). What a call actually cost (exact usage + the
// caller's estimate for aborted attempts) is then `charge`d.
import { estimateCostUsd } from '@/lib/content/token-pricing'

export type AbBudget = {
  readonly capUsd: number
  spentUsd: () => number
  // true once any call was refused — every later call is refused too.
  tripped: () => boolean
  // May a call projected to cost `projectedUsd` run? Refusing trips the budget.
  admit: (projectedUsd: number) => boolean
  charge: (usd: number) => void
}

export function createAbBudget(capUsd: number): AbBudget {
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('createAbBudget: the cap must be a positive number')
  let spent = 0
  let tripped = false
  return {
    capUsd,
    spentUsd: () => spent,
    tripped: () => tripped,
    admit: (projectedUsd) => {
      if (tripped) return false
      const projected = Number.isFinite(projectedUsd) && projectedUsd > 0 ? projectedUsd : 0
      if (spent + projected > capUsd) {
        tripped = true
        return false
      }
      return true
    },
    charge: (usd) => {
      if (Number.isFinite(usd) && usd > 0) spent += usd
    },
  }
}

// A 5-minute cache write bills at 1.25x input — the most any input token of a
// first attempt can cost.
const CACHE_WRITE_5M_MULTIPLIER = 1.25

// Worst case for ONE attempt: the estimated input (all of it priced as a
// cache write) plus the full max-output budget at `model`'s output rate. Pass
// the LARGEST output budget of the call's attempts (first try / retry). A
// repair turn stays inside this bound: its input grows by the first answer
// (≤ the first budget's tokens, at the input rate) while its own output budget
// is ≥ 8k tokens smaller at the ~5x output rate.
export function projectCallUsd(args: { model: string; inputUsd: number; maxOutputTokens: number }): number {
  return Math.max(0, args.inputUsd) * CACHE_WRITE_5M_MULTIPLIER + estimateCostUsd(args.model, 0, Math.max(0, args.maxOutputTokens))
}

// The cap handed to generateConcept / critiqueConcept for ONE admitted call.
// Their design caller vetoes an attempt once (spent so far + this call's
// spend) reaches the cap it was given; giving it the cap minus one attempt's
// worst case means the last attempt it allows (the first try, the larger
// retry or the repair turn) can never carry the running total past the real
// cap. `projectedUsd` must be the worst single attempt of that call.
export function callerCapUsd(budget: Pick<AbBudget, 'capUsd'>, projectedUsd: number): number {
  return Math.max(0, budget.capUsd - Math.max(0, Number.isFinite(projectedUsd) ? projectedUsd : 0))
}
