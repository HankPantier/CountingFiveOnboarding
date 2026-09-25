// Server-only. ONE Design-model call produces ONE concept (a run designs its
// concepts one per step invocation). The answer is validated (concept-validate)
// and checked for distinctness against the concepts this run already accepted
// (`priors`); an invalid or near-duplicate concept gets exactly ONE repair turn
// (the original answer is replayed as the assistant turn, so the cached first
// message is re-read at the cache rate). Budget guards, timeouts, spend
// reporting and aborted-attempt estimation are the shared `createDesignCaller`
// machinery in `model-call.ts` — see its header for the accounting rules this
// generator relies on.
import { buildCachedPartsMessages, type DynamicPart } from '@/lib/content/cache-control'
import { GENERATION_PROVIDER_OPTIONS, providerOptionsForAttempt } from '@/lib/content/generation-tuning'
import { DESIGN_SYSTEM_PROMPT, type PriorConcept } from './brief'
import { checkConceptCandidate, parseConceptsEnvelope, type ConceptContext, type ValidConcept } from './concept-validate'
import { createDesignCaller, MIN_CALL_TIMEOUT_MS, type StopReason } from './model-call'

export { DEADLINE_SAFETY_MS, ESTIMATED_TOKENS_PER_IMAGE } from './model-call'
export type { StopReason } from './model-call'

// Cap for the first concept call's attempts; the actual timeout is dynamic.
export const FIRST_ATTEMPT_CAP_MS = 300_000
// Cap for the repair call; the actual timeout is dynamic.
export const REPAIR_CALL_TIMEOUT_MS = 150_000
export const MIN_REPAIR_TIMEOUT_MS = MIN_CALL_TIMEOUT_MS
// One bundle per call (thinking tokens count against this too).
export const CONCEPT_OUTPUT_TOKENS = 24_000
export const REPAIR_OUTPUT_TOKENS = 16_000
const MAX_ERRORS_QUOTED = 8
const MAX_ERROR_CHARS = 200

export type GenerateConceptArgs = {
  prompt: { staticPrefix: string; parts: DynamicPart[]; sharedPartCount?: number }
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

const clipErrors = (errors: string[]): string =>
  errors
    .slice(0, MAX_ERRORS_QUOTED)
    .map((e) => e.slice(0, MAX_ERROR_CHARS))
    .join('; ')

export async function generateConcept(args: GenerateConceptArgs): Promise<GeneratedConcept> {
  const caller = createDesignCaller({
    stage: 'design_concept',
    system: DESIGN_SYSTEM_PROMPT,
    logTag: 'design-concept',
    costSoFarUsd: args.costSoFarUsd,
    costCapUsd: args.costCapUsd,
    deadline: args.deadline,
    attribution: args.attribution,
    now: args.now,
    onSpend: args.onSpend,
  })
  const notes: string[] = []

  // Validation + distinctness against every already-accepted concept.
  const check = (raw: unknown, prefix = ''): Slot => {
    const v = checkConceptCandidate(raw, args.context, args.priors, prefix)
    return v.ok ? { concept: v.concept, errors: [] } : { concept: null, errors: v.errors }
  }

  const done = (slot: Slot): GeneratedConcept => {
    if (slot.concept) for (const n of slot.concept.notes) notes.push(`${slot.concept.bundle.name}: ${n}`)
    return {
      concept: slot.concept,
      errors: slot.concept ? [] : slot.errors,
      costUsd: caller.spentUsd(),
      estimatedUsd: caller.estimatedUsd(),
      notes,
      stoppedReason: slot.concept ? null : (caller.stopReason() ?? 'no_output'),
    }
  }

  const shared = args.prompt.sharedPartCount ?? 0
  const messages = buildCachedPartsMessages(args.prompt.staticPrefix, args.prompt.parts, {
    ttl: '5m',
    cacheDynamic: true,
    ...(shared > 0 ? { breakAt: shared - 1 } : {}),
  })
  const first = await caller.call(messages, {
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

  const repairPlan = caller.plan(REPAIR_CALL_TIMEOUT_MS)
  if (!repairPlan.ok) {
    caller.stop(repairPlan.reason)
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
  const repaired = await caller.call([...messages, { role: 'assistant', content: JSON.stringify(first) }, { role: 'user', content: request }], {
    firstBudget: REPAIR_OUTPUT_TOKENS,
    providerOptions: providerOptionsForAttempt(2),
    label: 'design-concept-repair',
    capMs: REPAIR_CALL_TIMEOUT_MS,
  })
  const fixes = repaired === null ? [] : (parseConceptsEnvelope(repaired) ?? [])
  const fixed = check(fixes[0], 'after repair: ')
  return done(fixed.concept ? fixed : { concept: null, errors: [...slot.errors, ...fixed.errors] })
}
