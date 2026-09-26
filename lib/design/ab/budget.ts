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

// Worst case for ONE attempt: the estimated (uncached) input plus the full
// max-output budget at `model`'s output rate.
export function projectCallUsd(args: { model: string; inputUsd: number; maxOutputTokens: number }): number {
  return Math.max(0, args.inputUsd) + estimateCostUsd(args.model, 0, Math.max(0, args.maxOutputTokens))
}
