// Server-only. ONE Design-model call that revises ONE concept from its
// critique, render-check failures and renders (spec P4 "revise"). The answer
// goes through the SAME check as a new concept (checkConceptCandidate:
// validateConceptBundle — zod, capability tier, palette freedom, sanitizer,
// contrast — plus the near-duplicate check against the run's other concepts).
// A revision that fails ONLY the sanitizer's size caps (a fragment over its
// line / byte cap) gets exactly ONE size repair turn — P3's repair pattern
// (the answer replayed + the exact errors + "shorten to fit"), under the same
// cost-cap / deadline gate. Any other failure, a vetoed repair or a second
// failure is reported and the caller keeps the previous bundle (the loop
// never retries forever). Recorded as token stage 'design_concept' — a
// revision produces a concept bundle.
import { buildCachedPartsMessages } from '@/lib/content/cache-control'
import { GENERATION_PROVIDER_OPTIONS, providerOptionsForAttempt } from '@/lib/content/generation-tuning'
import { DESIGN_SYSTEM_PROMPT, type BuiltPrompt, type PriorConcept } from './brief'
import { CONCEPT_OUTPUT_TOKENS, REPAIR_CALL_TIMEOUT_MS, REPAIR_OUTPUT_TOKENS } from './concept-generator'
import { isCssSizeCapError } from './css-budget'
import { checkConceptCandidate, parseConceptsEnvelope, withConsistencyNotes, type ConceptContext, type ValidConcept } from './concept-validate'
import { createDesignCaller, type StopReason } from './model-call'

export const REVISE_CALL_CAP_MS = 300_000

export type ReviseConceptArgs = {
  prompt: BuiltPrompt
  context: ConceptContext
  others: PriorConcept[]
  costSoFarUsd: number
  costCapUsd: number
  deadline: number
  attribution: { sessionId: string; contentJobId: string; createdBy: string | null }
  now?: () => number
  onSpend?: (totalUsd: number) => void
}

export type ReviseConceptResult = {
  concept: ValidConcept | null
  errors: string[]
  notes: string[] // validation notes (e.g. fonts locked → current fonts kept)
  costUsd: number
  estimatedUsd: number
  stoppedReason: StopReason | null
}

export async function reviseConcept(args: ReviseConceptArgs): Promise<ReviseConceptResult> {
  const caller = createDesignCaller({
    stage: 'design_concept',
    system: DESIGN_SYSTEM_PROMPT,
    logTag: 'design-revise',
    costSoFarUsd: args.costSoFarUsd,
    costCapUsd: args.costCapUsd,
    deadline: args.deadline,
    attribution: args.attribution,
    now: args.now,
    onSpend: args.onSpend,
  })
  const shared = args.prompt.sharedPartCount
  const messages = buildCachedPartsMessages(args.prompt.staticPrefix, args.prompt.parts, {
    ttl: '5m',
    ...(shared > 0 ? { breakAt: shared - 1 } : {}),
  })
  const raw = await caller.call(messages, {
    firstBudget: CONCEPT_OUTPUT_TOKENS,
    retryBudget: CONCEPT_OUTPUT_TOKENS,
    providerOptions: GENERATION_PROVIDER_OPTIONS,
    retryProviderOptions: providerOptionsForAttempt(3),
    label: 'design-revise',
    capMs: REVISE_CALL_CAP_MS,
  })
  const money = { costUsd: caller.spentUsd(), estimatedUsd: caller.estimatedUsd() }
  const fail = (errors: string[], stoppedReason: StopReason): ReviseConceptResult => ({ ...money, concept: null, errors, notes: [], stoppedReason })
  if (raw === null) return fail([], caller.stopReason() ?? 'no_output')
  const candidate = parseConceptsEnvelope(raw)?.[0]
  const v = checkConceptCandidate(candidate, args.context, args.others)
  if (v.ok) {
    const concept = withConsistencyNotes(v.concept, args.context.caps)
    return { ...money, concept, errors: [], notes: concept.notes, stoppedReason: null }
  }
  if (!isSizeOnlyFailure(v.errors)) return fail(v.errors, 'no_output')

  // Size-only: one repair turn, if the budget still allows a full call.
  const plan = caller.plan(REPAIR_CALL_TIMEOUT_MS)
  if (!plan.ok) {
    caller.stop(plan.reason)
    return fail(v.errors, plan.reason)
  }
  const repaired = await caller.call(
    [...messages, { role: 'assistant', content: JSON.stringify(raw) }, { role: 'user', content: sizeRepairRequest(v.errors) }],
    {
      firstBudget: REPAIR_OUTPUT_TOKENS,
      providerOptions: providerOptionsForAttempt(2),
      label: 'design-revise-repair',
      capMs: REPAIR_CALL_TIMEOUT_MS,
    }
  )
  const after = { costUsd: caller.spentUsd(), estimatedUsd: caller.estimatedUsd() }
  const fixed = repaired === null ? null : checkConceptCandidate(parseConceptsEnvelope(repaired)?.[0], args.context, args.others, 'after repair: ')
  if (fixed?.ok) {
    const concept = withConsistencyNotes(fixed.concept, args.context.caps)
    return { ...after, concept, errors: [], notes: concept.notes, stoppedReason: null }
  }
  return { ...after, concept: null, errors: [...v.errors, ...(fixed ? fixed.errors : [])], notes: [], stoppedReason: caller.stopReason() ?? 'no_output' }
}

// Every error is a sanitizer size cap (and there is at least one).
export function isSizeOnlyFailure(errors: string[]): boolean {
  return errors.length > 0 && errors.every(isCssSizeCapError)
}

export function sizeRepairRequest(errors: string[]): string {
  return [
    `Your revised concept cannot be used — its CSS is over the size caps: ${errors.join('; ')}`,
    'Shorten the CSS to fit the budget, keeping the design intent: tighten or drop rules, merge selectors, remove redundant declarations — change nothing else.',
    'Return ONLY JSON: {"concepts":[ exactly 1 concept ]}',
  ].join('\n')
}
