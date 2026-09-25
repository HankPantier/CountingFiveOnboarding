// Server-only. ONE Design-model call produces ONE concept (a run designs its
// concepts one per step invocation). The answer is validated (concept-validate)
// and checked for distinctness against the concepts this run already accepted
// (`priors`); an invalid or near-duplicate concept gets exactly ONE repair turn
// (the original answer is replayed as the assistant turn, so the cached first
// message is re-read at the cache rate). Budget guards run BEFORE every model
// call: the run's cost cap and the step invocation's deadline. Opus 5.5:
// generateText → extractJson → zod, adaptive thinking, never
// temperature/top_p/top_k/toolChoice.
//
// Timeouts: every attempt (the first one, generateJson's internal larger-budget
// retry, and the repair) gets whatever time is left —
// min(cap, deadline − now − DEADLINE_SAFETY_MS) — and is vetoed as 'deadline'
// when that is under MIN_REPAIR_TIMEOUT_MS. The first call's cap is
// FIRST_ATTEMPT_CAP_MS (one bundle needs far less than the old three-bundle
// call), the repair's REPAIR_CALL_TIMEOUT_MS.
//
// Spend reporting: `onSpend` is called with the running total every time it
// changes, so the caller can persist spend even if this function throws later.
//
// Aborted attempts: generateJson only reports usage (onAttempt) when the model
// call returns. A call aborted by its timeout (or failing mid-flight) may still
// be billed, so every started-but-unreported attempt adds an ESTIMATED cost to
// the run — the prompt's input estimate plus the attempt's full
// maxOutputTokens at the output rate (a deliberate over-estimate that keeps
// the cost cap honest). Never recorded in token_usage, which stays exact-only.
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModelUsage, ModelMessage } from 'ai'
import { generateJson, type GenerateJsonOptions } from '@/lib/content/json-generation'
import { buildCachedPartsMessages, extractCacheUsage, type DynamicPart } from '@/lib/content/cache-control'
import { DESIGN_MODEL, GENERATION_PROVIDER_OPTIONS, providerOptionsForAttempt } from '@/lib/content/generation-tuning'
import { estimateCostUsd } from '@/lib/content/token-pricing'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { DESIGN_SYSTEM_PROMPT, type PriorConcept } from './brief'
import { parseConceptsEnvelope, validateConceptBundle, type ConceptContext, type ValidConcept } from './concept-validate'
import { isNearDuplicate } from './distinctness'

// Cap for the first concept call's attempts; the actual timeout is dynamic.
export const FIRST_ATTEMPT_CAP_MS = 300_000
// Cap for the repair call; the actual timeout is dynamic (see header).
export const REPAIR_CALL_TIMEOUT_MS = 150_000
export const MIN_REPAIR_TIMEOUT_MS = 90_000
export const DEADLINE_SAFETY_MS = 20_000
// Rough input-token cost of one ≤1568 px image part, for aborted-attempt estimates.
export const ESTIMATED_TOKENS_PER_IMAGE = 1_600
// One bundle per call (thinking tokens count against this too).
export const CONCEPT_OUTPUT_TOKENS = 16_000
export const REPAIR_OUTPUT_TOKENS = 16_000
const MAX_ERRORS_QUOTED = 8
const MAX_ERROR_CHARS = 200

export type StopReason = 'cost_cap' | 'deadline' | 'no_output'

export type GenerateConceptArgs = {
  prompt: { staticPrefix: string; parts: DynamicPart[] }
  context: ConceptContext
  // Concepts this run already accepted: the new one must not near-duplicate any.
  priors: PriorConcept[]
  costSoFarUsd: number
  costCapUsd: number
  deadline: number // epoch ms by which every model call must have finished
  attribution: { sessionId: string; contentJobId: string; createdBy: string | null }
  now?: () => number
  // Called with the running spend (exact + estimated) every time it changes.
  onSpend?: (totalUsd: number) => void
}

export type GeneratedConcept = {
  concept: ValidConcept | null
  // Why the concept is unusable (validation / distinctness, incl. "after
  // repair: …"). Empty when a concept came back, or when there was no answer.
  errors: string[]
  // Total run cost of this call: exact (recorded) usage + estimatedUsd.
  costUsd: number
  // The part of costUsd that is an estimate for attempts that were started but
  // never reported usage (aborted / failed mid-flight). Not in token_usage.
  estimatedUsd: number
  notes: string[]
  // null when a concept came back; otherwise why not (a budget veto, or no
  // usable output).
  stoppedReason: StopReason | null
}

type Slot = { concept: ValidConcept | null; errors: string[] }

// One generateJson call's attempt bookkeeping: the estimate of every started
// attempt, in order; the first `accounted + estimated` of them are settled.
type CallTracker = { started: number[]; accounted: number; estimated: number; inputUsd: number }

type Plan = { ok: true; timeoutMs: number } | { ok: false; reason: StopReason }

// Input estimate for one attempt of a call: ~4 chars per token of prompt text
// (system + every text part / string turn) + a flat cost per image part,
// priced at the model's uncached input rate.
function estimateInputUsd(system: string, messages: ModelMessage[]): number {
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
  return estimateCostUsd(DESIGN_MODEL, tokens, 0)
}

const clipErrors = (errors: string[]): string =>
  errors
    .slice(0, MAX_ERRORS_QUOTED)
    .map((e) => e.slice(0, MAX_ERROR_CHARS))
    .join('; ')

export async function generateConcept(args: GenerateConceptArgs): Promise<GeneratedConcept> {
  const now = args.now ?? Date.now
  const state: { spent: number; estimated: number; stop: StopReason | null } = { spent: 0, estimated: 0, stop: null }
  const notes: string[] = []
  const model = anthropic(DESIGN_MODEL)

  // Side-effect free budget check: the attempt gets the remaining time, capped at `capMs`.
  const plan = (capMs: number): Plan => {
    if (args.costSoFarUsd + state.spent >= args.costCapUsd) return { ok: false, reason: 'cost_cap' }
    const remaining = Math.min(capMs, args.deadline - now() - DEADLINE_SAFETY_MS)
    return remaining < MIN_REPAIR_TIMEOUT_MS ? { ok: false, reason: 'deadline' } : { ok: true, timeoutMs: remaining }
  }

  // Charge the estimate for every started attempt that never reported usage.
  const reconcile = (tracker: CallTracker): void => {
    const unsettled = tracker.started.slice(tracker.accounted + tracker.estimated)
    if (unsettled.length === 0) return
    const usd = unsettled.reduce((sum, v) => sum + v, 0)
    tracker.estimated += unsettled.length
    state.spent += usd
    state.estimated += usd
    args.onSpend?.(state.spent)
    console.warn(`[design-concept] aborted attempt — estimated cost $${usd.toFixed(4)} (input + max output) added to run`)
  }

  const account = (tracker: CallTracker) => async (usage: LanguageModelUsage | undefined): Promise<void> => {
    tracker.accounted++
    const cache = extractCacheUsage(usage)
    state.spent += estimateCostUsd(
      DESIGN_MODEL,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      cache.cacheReadInputTokens,
      cache.cacheCreationInputTokens,
      '5m'
    )
    args.onSpend?.(state.spent)
    await recordTokenUsage({
      task: 'content',
      stage: 'design_concept',
      sessionId: args.attribution.sessionId,
      contentJobId: args.attribution.contentJobId,
      createdBy: args.attribution.createdBy,
      model: DESIGN_MODEL,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      ...cache,
      cacheTtl: '5m',
    })
  }

  // One gated, accounted generateJson call; every attempt's timeout is dynamic.
  const call = async (
    messages: ModelMessage[],
    cfg: Pick<GenerateJsonOptions, 'firstBudget' | 'retryBudget' | 'providerOptions' | 'retryProviderOptions' | 'label'> & {
      capMs: number
    }
  ): Promise<unknown | null> => {
    const tracker: CallTracker = { started: [], accounted: 0, estimated: 0, inputUsd: estimateInputUsd(DESIGN_SYSTEM_PROMPT, messages) }
    const { capMs, ...budgets } = cfg
    const opts: GenerateJsonOptions = {
      model,
      system: DESIGN_SYSTEM_PROMPT,
      messages,
      ...budgets,
      timeoutMs: capMs,
      // generateJson reads opts.timeoutMs when it starts each attempt, AFTER
      // this gate — so setting it here gives the attempt its dynamic timeout.
      beforeAttempt: (attempt) => {
        reconcile(tracker)
        const p = plan(capMs)
        if (!p.ok) {
          state.stop = p.reason
          return false
        }
        opts.timeoutMs = p.timeoutMs
        const maxOutputTokens = attempt === 2 ? (budgets.retryBudget ?? budgets.firstBudget) : budgets.firstBudget
        tracker.started.push(tracker.inputUsd + estimateCostUsd(DESIGN_MODEL, 0, maxOutputTokens))
        return true
      },
      onAttempt: account(tracker),
    }
    try {
      return await generateJson(opts)
    } finally {
      // Also on a throw, so the caller's onSpend sees the aborted-attempt estimate.
      reconcile(tracker)
    }
  }

  // Validation + distinctness against every already-accepted concept.
  const check = (raw: unknown, prefix = ''): Slot => {
    if (raw === undefined) return { concept: null, errors: [`${prefix}missing — the answer had no concept`] }
    const v = validateConceptBundle(raw, args.context)
    if (!v.ok) return { concept: null, errors: v.errors.map((e) => `${prefix}${e}`) }
    const clash = args.priors.find((p) => isNearDuplicate(p.bundle, v.concept.bundle))
    if (clash) {
      return {
        concept: null,
        errors: [
          `${prefix}too similar to concept ${clash.position + 1} ("${clash.bundle.name.slice(0, 60)}") — change the palette direction (primary/action) or at least two of fonts, tokens and treatments`,
        ],
      }
    }
    return { concept: v.concept, errors: [] }
  }

  const done = (slot: Slot): GeneratedConcept => {
    if (slot.concept) for (const n of slot.concept.notes) notes.push(`${slot.concept.bundle.name}: ${n}`)
    return {
      concept: slot.concept,
      errors: slot.concept ? [] : slot.errors,
      costUsd: state.spent,
      estimatedUsd: state.estimated,
      notes,
      stoppedReason: slot.concept ? null : (state.stop ?? 'no_output'),
    }
  }

  const messages = buildCachedPartsMessages(args.prompt.staticPrefix, args.prompt.parts, { ttl: '5m', cacheDynamic: true })
  const first = await call(messages, {
    firstBudget: CONCEPT_OUTPUT_TOKENS,
    retryBudget: CONCEPT_OUTPUT_TOKENS,
    providerOptions: GENERATION_PROVIDER_OPTIONS,
    retryProviderOptions: providerOptionsForAttempt(3),
    label: 'design-concept',
    capMs: FIRST_ATTEMPT_CAP_MS,
  })
  const raws = first === null ? null : parseConceptsEnvelope(first)
  if (!raws) return done({ concept: null, errors: [] })

  const slot = check(raws[0])
  if (slot.concept) return done(slot)

  const repairPlan = plan(REPAIR_CALL_TIMEOUT_MS)
  if (!repairPlan.ok) {
    state.stop = repairPlan.reason
    notes.push(
      repairPlan.reason === 'cost_cap'
        ? 'Skipped the repair pass — the run hit its cost cap.'
        : 'Skipped the repair pass — not enough time left in this step.'
    )
    return done(slot)
  }

  const raw = raws[0]
  const name = raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string' ? ` ("${(raw as { name: string }).name.slice(0, 60)}")` : ''
  const request = [
    `Your concept${name} cannot be used: ${clipErrors(slot.errors)}`,
    'Replace it, keeping every rule above.',
    'Return ONLY JSON: {"concepts":[ exactly 1 replacement concept ]}',
  ].join('\n')
  const repaired = await call([...messages, { role: 'assistant', content: JSON.stringify(first) }, { role: 'user', content: request }], {
    firstBudget: REPAIR_OUTPUT_TOKENS,
    providerOptions: providerOptionsForAttempt(2),
    label: 'design-concept-repair',
    capMs: REPAIR_CALL_TIMEOUT_MS,
  })
  const fixes = repaired === null ? [] : (parseConceptsEnvelope(repaired) ?? [])
  const fixed = check(fixes[0], 'after repair: ')
  return done(fixed.concept ? fixed : { concept: null, errors: [...slot.errors, ...fixed.errors] })
}
