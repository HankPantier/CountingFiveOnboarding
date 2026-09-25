// Server-only. ONE Design-model call produces N concepts; each is validated
// (concept-validate) and checked for distinctness; invalid or near-duplicate
// concepts get exactly ONE repair turn (the original answer is replayed as the
// assistant turn, so the cached first message is re-read at the cache rate).
// Budget guards run BEFORE every model call: the run's cost cap and the step
// invocation's deadline. Opus 5.5: generateText → extractJson → zod, adaptive
// thinking, never temperature/top_p/top_k/toolChoice.
//
// Timeouts: the first attempt of the first call gets a fixed
// CONCEPT_CALL_TIMEOUT_MS and only starts when it can finish (plus
// DEADLINE_SAFETY_MS) before the deadline. Every later attempt (the repair, and
// generateJson's internal larger-budget retry) gets whatever time is left —
// min(cap, deadline − now − DEADLINE_SAFETY_MS) — and is vetoed as 'deadline'
// when that is under MIN_REPAIR_TIMEOUT_MS.
//
// Aborted attempts: generateJson only reports usage (onAttempt) when the model
// call returns. A call aborted by its timeout (or failing mid-flight) may still
// be billed, so every started-but-unreported attempt adds an ESTIMATED
// input-only cost to the run (never to token_usage, which stays exact-only).
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModelUsage, ModelMessage } from 'ai'
import { generateJson, type GenerateJsonOptions } from '@/lib/content/json-generation'
import { buildCachedPartsMessages, extractCacheUsage, type DynamicPart } from '@/lib/content/cache-control'
import { DESIGN_MODEL, GENERATION_PROVIDER_OPTIONS, providerOptionsForAttempt } from '@/lib/content/generation-tuning'
import { estimateCostUsd } from '@/lib/content/token-pricing'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { DESIGN_SYSTEM_PROMPT } from './brief'
import { parseConceptsEnvelope, validateConceptBundle, type ConceptContext, type ValidConcept } from './concept-validate'
import { findNearDuplicates, isNearDuplicate } from './distinctness'

export const CONCEPT_CALL_TIMEOUT_MS = 360_000
// Cap for the repair call; the actual timeout is dynamic (see header).
export const REPAIR_CALL_TIMEOUT_MS = 150_000
export const MIN_REPAIR_TIMEOUT_MS = 90_000
export const DEADLINE_SAFETY_MS = 20_000
// Rough input-token cost of one ≤1568 px image part, for aborted-attempt estimates.
export const ESTIMATED_TOKENS_PER_IMAGE = 1_600
const CONCEPT_OUTPUT_TOKENS = 32_000
const REPAIR_OUTPUT_TOKENS = 24_000
const MAX_ERRORS_QUOTED = 8
const MAX_ERROR_CHARS = 200

export type StopReason = 'cost_cap' | 'deadline' | 'no_output'

export type GenerateConceptsArgs = {
  prompt: { staticPrefix: string; parts: DynamicPart[] }
  context: ConceptContext
  conceptCount: number
  costSoFarUsd: number
  costCapUsd: number
  deadline: number // epoch ms by which every model call must have finished
  attribution: { sessionId: string; contentJobId: string; createdBy: string | null }
  now?: () => number
}

export type GeneratedConcepts = {
  concepts: ValidConcept[]
  rejected: { errors: string[] }[]
  // Total run cost of this generation: exact (recorded) usage + estimatedUsd.
  // The orchestrator adds this whole figure to design_runs.cost_usd.
  costUsd: number
  // The part of costUsd that is an input-only estimate for attempts that were
  // started but never reported usage (aborted / failed mid-flight). Not in token_usage.
  estimatedUsd: number
  notes: string[]
  stoppedReason: StopReason | null
}

type Slot = { concept: ValidConcept | null; errors: string[] }

// One generateJson call's attempt bookkeeping.
type CallTracker = { started: number; accounted: number; estimated: number; estimateUsd: number }

type Plan = { ok: true; timeoutMs: number } | { ok: false; reason: StopReason }

// Input-only estimate for one attempt of a call: ~4 chars per token of prompt
// text (system + every text part / string turn) + a flat cost per image part,
// priced at the model's uncached input rate.
function estimateAttemptUsd(system: string, messages: ModelMessage[]): number {
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

export async function generateConcepts(args: GenerateConceptsArgs): Promise<GeneratedConcepts> {
  const now = args.now ?? Date.now
  const state: { spent: number; estimated: number; stop: StopReason | null } = { spent: 0, estimated: 0, stop: null }
  const notes: string[] = []
  const model = anthropic(DESIGN_MODEL)

  // Side-effect free budget check. `fixedMs` → the attempt needs exactly that
  // long; otherwise it gets the remaining time, capped at `capMs`.
  const plan = (fixedMs: number | null, capMs: number): Plan => {
    if (args.costSoFarUsd + state.spent >= args.costCapUsd) return { ok: false, reason: 'cost_cap' }
    const t = now()
    if (fixedMs !== null) {
      return t + fixedMs + DEADLINE_SAFETY_MS > args.deadline ? { ok: false, reason: 'deadline' } : { ok: true, timeoutMs: fixedMs }
    }
    const remaining = Math.min(capMs, args.deadline - t - DEADLINE_SAFETY_MS)
    return remaining < MIN_REPAIR_TIMEOUT_MS ? { ok: false, reason: 'deadline' } : { ok: true, timeoutMs: remaining }
  }

  // Charge the estimate for every started attempt that never reported usage.
  const reconcile = (tracker: CallTracker): void => {
    const unaccounted = tracker.started - tracker.accounted - tracker.estimated
    if (unaccounted <= 0) return
    const usd = unaccounted * tracker.estimateUsd
    tracker.estimated += unaccounted
    state.spent += usd
    state.estimated += usd
    console.warn(`[design-concept] aborted attempt — estimated input cost $${usd.toFixed(4)} added to run`)
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

  // One gated, accounted generateJson call. `firstFixedMs` is the fixed timeout
  // for attempt 1 (null → dynamic like every other attempt).
  const call = async (
    messages: ModelMessage[],
    cfg: Pick<GenerateJsonOptions, 'firstBudget' | 'retryBudget' | 'providerOptions' | 'retryProviderOptions' | 'label'> & {
      firstFixedMs: number | null
      capMs: number
    }
  ): Promise<unknown | null> => {
    const tracker: CallTracker = { started: 0, accounted: 0, estimated: 0, estimateUsd: estimateAttemptUsd(DESIGN_SYSTEM_PROMPT, messages) }
    const { firstFixedMs, capMs, ...budgets } = cfg
    const opts: GenerateJsonOptions = {
      model,
      system: DESIGN_SYSTEM_PROMPT,
      messages,
      ...budgets,
      timeoutMs: firstFixedMs ?? capMs,
      // generateJson reads opts.timeoutMs when it starts each attempt, AFTER
      // this gate — so setting it here gives the attempt its dynamic timeout.
      beforeAttempt: (attempt) => {
        reconcile(tracker)
        const p = plan(attempt === 1 ? firstFixedMs : null, capMs)
        if (!p.ok) {
          state.stop = p.reason
          return false
        }
        opts.timeoutMs = p.timeoutMs
        tracker.started++
        return true
      },
      onAttempt: account(tracker),
    }
    const result = await generateJson(opts)
    reconcile(tracker)
    return result
  }

  const validate = (raw: unknown): Slot => {
    if (raw === undefined) return { concept: null, errors: ['missing — the answer had fewer concepts than asked'] }
    const v = validateConceptBundle(raw, args.context)
    return v.ok ? { concept: v.concept, errors: [] } : { concept: null, errors: v.errors }
  }

  const done = (concepts: ValidConcept[], rejected: { errors: string[] }[], stoppedReason: StopReason | null): GeneratedConcepts => ({
    concepts,
    rejected,
    costUsd: state.spent,
    estimatedUsd: state.estimated,
    notes,
    stoppedReason,
  })

  const messages = buildCachedPartsMessages(args.prompt.staticPrefix, args.prompt.parts, { ttl: '5m', cacheDynamic: true })
  const first = await call(messages, {
    firstBudget: CONCEPT_OUTPUT_TOKENS,
    retryBudget: CONCEPT_OUTPUT_TOKENS,
    providerOptions: GENERATION_PROVIDER_OPTIONS,
    retryProviderOptions: providerOptionsForAttempt(3),
    label: 'design-concepts',
    firstFixedMs: CONCEPT_CALL_TIMEOUT_MS,
    capMs: CONCEPT_CALL_TIMEOUT_MS,
  })
  const raws = first === null ? null : parseConceptsEnvelope(first)
  if (!raws) return done([], [], state.stop ?? 'no_output')

  const slots: Slot[] = Array.from({ length: args.conceptCount }, (_, i) => validate(raws[i]))

  // Distinctness among the valid ones: the later concept of a pair is repaired.
  const validIdx = slots.flatMap((s, i) => (s.concept ? [i] : []))
  for (const { keep, drop } of findNearDuplicates(validIdx.map((i) => (slots[i].concept as ValidConcept).bundle))) {
    slots[validIdx[drop]] = {
      concept: null,
      errors: [`too similar to concept ${validIdx[keep] + 1} — change the palette direction (primary/action) or at least two of fonts, tokens and treatments`],
    }
  }

  const failing = slots.flatMap((s, i) => (s.concept ? [] : [i]))
  const repairPlan = failing.length > 0 ? plan(null, REPAIR_CALL_TIMEOUT_MS) : null
  if (repairPlan && !repairPlan.ok) state.stop = repairPlan.reason
  if (failing.length > 0 && repairPlan?.ok) {
    const request = [
      'Some concepts in your answer cannot be used. Replace ONLY these, keeping every rule above:',
      ...failing.map((i) => {
        const raw = raws[i]
        const name = raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string' ? ` ("${(raw as { name: string }).name.slice(0, 60)}")` : ''
        const errs = slots[i].errors.slice(0, MAX_ERRORS_QUOTED).map((e) => e.slice(0, MAX_ERROR_CHARS)).join('; ')
        return `- Concept ${i + 1}${name}: ${errs}`
      }),
      `Return ONLY JSON: {"concepts":[ exactly ${failing.length} replacement concept(s), in the order listed ]}`,
    ].join('\n')
    const repairMessages: ModelMessage[] = [
      ...messages,
      { role: 'assistant', content: JSON.stringify(first) },
      { role: 'user', content: request },
    ]
    const repaired = await call(repairMessages, {
      firstBudget: REPAIR_OUTPUT_TOKENS,
      providerOptions: providerOptionsForAttempt(2),
      label: 'design-concepts-repair',
      firstFixedMs: null,
      capMs: REPAIR_CALL_TIMEOUT_MS,
    })
    const fixes = repaired === null ? [] : (parseConceptsEnvelope(repaired) ?? [])
    failing.forEach((slotIndex, k) => {
      const fixed = validate(fixes[k])
      if (!fixed.concept) {
        slots[slotIndex] = { concept: null, errors: [...slots[slotIndex].errors, ...fixed.errors.map((e) => `after repair: ${e}`)] }
        return
      }
      const clash = slots.findIndex((s, j) => j !== slotIndex && s.concept && isNearDuplicate(s.concept.bundle, (fixed.concept as ValidConcept).bundle))
      slots[slotIndex] = clash === -1 ? fixed : { concept: null, errors: [`after repair: still too similar to concept ${clash + 1}`] }
    })
  } else if (failing.length > 0) {
    notes.push(
      state.stop === 'cost_cap'
        ? 'Skipped the repair pass — the run hit its cost cap.'
        : 'Skipped the repair pass — not enough time left in this step.'
    )
  }

  const concepts = slots.flatMap((s) => (s.concept ? [s.concept] : []))
  for (const c of concepts) for (const n of c.notes) notes.push(`${c.bundle.name}: ${n}`)
  return done(
    concepts,
    slots.flatMap((s) => (s.concept ? [] : [{ errors: s.errors }])),
    concepts.length > 0 ? null : (state.stop ?? 'no_output')
  )
}
