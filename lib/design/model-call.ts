// Server-only. The shared Design-model (Opus 5.5) call machinery for every
// Design Studio generator — concept, critique, revise. Extracted unchanged
// from P3's concept-generator:
//   • generateJson (generateText → extractJson), never temperature / top_p /
//     top_k / toolChoice;
//   • BEFORE every attempt: the run's cost cap and the step's deadline — the
//     attempt gets min(capMs, deadline − now − DEADLINE_SAFETY_MS) and is
//     vetoed under MIN_CALL_TIMEOUT_MS;
//   • exact usage recorded under the caller's token stage (+ cache split);
//   • an ESTIMATED cost (input + the attempt's full maxOutputTokens) for any
//     attempt started but never reported (aborted / failed mid-flight) — added
//     to the run's spend so the cap stays honest, never to token_usage.
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModelUsage, ModelMessage } from 'ai'
import { generateJson, type GenerateJsonOptions } from '@/lib/content/json-generation'
import { extractCacheUsage } from '@/lib/content/cache-control'
import { DESIGN_MODEL } from '@/lib/content/generation-tuning'
import { estimateCostUsd } from '@/lib/content/token-pricing'
import { recordTokenUsage } from '@/lib/content/token-usage'

export const MIN_CALL_TIMEOUT_MS = 90_000
export const DEADLINE_SAFETY_MS = 20_000
// Rough input-token cost of one ≤1568 px image part, for aborted-attempt estimates.
export const ESTIMATED_TOKENS_PER_IMAGE = 1_600

export type StopReason = 'cost_cap' | 'deadline' | 'no_output'
export type DesignStage = 'design_concept' | 'design_critique'

export type DesignCallerOptions = {
  stage: DesignStage
  system: string
  logTag: string
  costSoFarUsd: number
  costCapUsd: number
  deadline: number // epoch ms by which every model call must have finished
  attribution: { sessionId: string; contentJobId: string; createdBy: string | null }
  now?: () => number
  // Called with the running spend (exact + estimated) every time it changes.
  onSpend?: (totalUsd: number) => void
  // The model to call, price and record (default DESIGN_MODEL). Only the
  // design-model A/B script (scripts/compare-design-models.ts) overrides it.
  model?: string
}

export type DesignCallConfig = Pick<GenerateJsonOptions, 'firstBudget' | 'retryBudget' | 'providerOptions' | 'retryProviderOptions' | 'label'> & {
  capMs: number
}
export type DesignPlan = { ok: true; timeoutMs: number } | { ok: false; reason: StopReason }

export type DesignCaller = {
  call: (messages: ModelMessage[], cfg: DesignCallConfig) => Promise<unknown | null>
  // Side-effect free budget check (e.g. before a repair turn).
  plan: (capMs: number) => DesignPlan
  spentUsd: () => number
  estimatedUsd: () => number
  stopReason: () => StopReason | null
  stop: (reason: StopReason) => void
}

// One generateJson call's attempt bookkeeping: the estimate of every started
// attempt, in order; the first `accounted + estimated` of them are settled.
type CallTracker = { started: number[]; accounted: number; estimated: number; inputUsd: number }

// ~4 chars per token of prompt text + a flat cost per image part, priced at
// the model's uncached input rate.
export function estimateInputUsd(system: string, messages: ModelMessage[], modelId: string = DESIGN_MODEL): number {
  let chars = system.length
  let images = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length
      continue
    }
    for (const part of msg.content) {
      if (part.type === 'text') chars += part.text.length
      else if (part.type === 'image') images++
    }
  }
  const tokens = Math.ceil(chars / 4) + images * ESTIMATED_TOKENS_PER_IMAGE
  return estimateCostUsd(modelId, tokens, 0)
}

export function createDesignCaller(opts: DesignCallerOptions): DesignCaller {
  const now = opts.now ?? Date.now
  const state: { spent: number; estimated: number; stop: StopReason | null } = { spent: 0, estimated: 0, stop: null }
  const modelId = opts.model ?? DESIGN_MODEL
  const model = anthropic(modelId)

  const plan = (capMs: number): DesignPlan => {
    if (opts.costSoFarUsd + state.spent >= opts.costCapUsd) return { ok: false, reason: 'cost_cap' }
    const remaining = Math.min(capMs, opts.deadline - now() - DEADLINE_SAFETY_MS)
    return remaining < MIN_CALL_TIMEOUT_MS ? { ok: false, reason: 'deadline' } : { ok: true, timeoutMs: remaining }
  }

  const reconcile = (tracker: CallTracker): void => {
    const unsettled = tracker.started.slice(tracker.accounted + tracker.estimated)
    if (unsettled.length === 0) return
    const usd = unsettled.reduce((sum, v) => sum + v, 0)
    tracker.estimated += unsettled.length
    state.spent += usd
    state.estimated += usd
    opts.onSpend?.(state.spent)
    console.warn(`[${opts.logTag}] aborted attempt — estimated cost $${usd.toFixed(4)} (input + max output) added to run`)
  }

  const account = (tracker: CallTracker) => async (usage: LanguageModelUsage | undefined): Promise<void> => {
    tracker.accounted++
    const cache = extractCacheUsage(usage)
    state.spent += estimateCostUsd(
      modelId,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      cache.cacheReadInputTokens,
      cache.cacheCreationInputTokens,
      '5m'
    )
    opts.onSpend?.(state.spent)
    await recordTokenUsage({
      task: 'content',
      stage: opts.stage,
      sessionId: opts.attribution.sessionId,
      contentJobId: opts.attribution.contentJobId,
      createdBy: opts.attribution.createdBy,
      model: modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      ...cache,
      cacheTtl: '5m',
    })
  }

  const call = async (messages: ModelMessage[], cfg: DesignCallConfig): Promise<unknown | null> => {
    const tracker: CallTracker = { started: [], accounted: 0, estimated: 0, inputUsd: estimateInputUsd(opts.system, messages, modelId) }
    const { capMs, ...budgets } = cfg
    const genOpts: GenerateJsonOptions = {
      model,
      system: opts.system,
      messages,
      ...budgets,
      timeoutMs: capMs,
      // generateJson reads timeoutMs when it starts each attempt, AFTER this
      // gate — setting it here gives the attempt its dynamic timeout.
      beforeAttempt: (attempt) => {
        reconcile(tracker)
        const p = plan(capMs)
        if (!p.ok) {
          state.stop = p.reason
          return false
        }
        genOpts.timeoutMs = p.timeoutMs
        const maxOutputTokens = attempt === 2 ? (budgets.retryBudget ?? budgets.firstBudget) : budgets.firstBudget
        tracker.started.push(tracker.inputUsd + estimateCostUsd(modelId, 0, maxOutputTokens))
        return true
      },
      onAttempt: account(tracker),
    }
    try {
      return await generateJson(genOpts)
    } finally {
      // Also on a throw, so the caller's onSpend sees the aborted-attempt estimate.
      reconcile(tracker)
    }
  }

  return {
    call,
    plan,
    spentUsd: () => state.spent,
    estimatedUsd: () => state.estimated,
    stopReason: () => state.stop,
    stop: (reason) => {
      state.stop = reason
    },
  }
}
