// Server-only. ONE Design-model call that revises ONE concept from its
// critique, render-check failures and renders (spec P4 "revise"). The answer
// goes through the SAME check as a new concept (checkConceptCandidate:
// validateConceptBundle — zod, capability tier, palette freedom, sanitizer,
// contrast — plus the near-duplicate check against the run's other concepts). No repair turn: an
// unusable revision is reported and the caller keeps the previous bundle
// (the loop never retries forever). Recorded as token stage 'design_concept'
// — a revision produces a concept bundle.
import { buildCachedPartsMessages } from '@/lib/content/cache-control'
import { GENERATION_PROVIDER_OPTIONS, providerOptionsForAttempt } from '@/lib/content/generation-tuning'
import { DESIGN_SYSTEM_PROMPT, type BuiltPrompt, type PriorConcept } from './brief'
import { CONCEPT_OUTPUT_TOKENS } from './concept-generator'
import { checkConceptCandidate, parseConceptsEnvelope, type ConceptContext, type ValidConcept } from './concept-validate'
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
  const v = checkConceptCandidate(parseConceptsEnvelope(raw)?.[0], args.context, args.others)
  if (!v.ok) return fail(v.errors, 'no_output')
  return { ...money, concept: v.concept, errors: [], notes: v.concept.notes, stoppedReason: null }
}
