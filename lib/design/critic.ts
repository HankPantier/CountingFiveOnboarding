// Server-only. ONE Design-model (Opus 5.5) vision call that critiques ONE
// concept's latest render (spec P4 "critic.ts"): generateText → extractJson →
// zod (critique.ts), recorded as token stage 'design_critique'. `passed` is
// computed server-side from the scores; the model's own verdict is never read.
// The run's cost cap and the step's deadline are checked before every attempt
// (model-call.ts). No repair turn — generateJson's larger-budget retry is the
// only second attempt. Opus 5.5 always thinks; never temperature / top_p /
// top_k / toolChoice.
import { buildCachedPartsMessages } from '@/lib/content/cache-control'
import { DESIGN_MODEL, GENERATION_PROVIDER_OPTIONS, providerOptionsForAttempt } from '@/lib/content/generation-tuning'
import type { BuiltPrompt } from './brief'
import { CRITIC_SYSTEM_PROMPT } from './brief/critique-prompt'
import { parseCritiqueAnswer, type CritiqueRecord } from './critique'
import { createDesignCaller, type StopReason } from './model-call'
import type { PaletteFreedom } from './run-types'

export const CRITIQUE_CALL_CAP_MS = 240_000
export const CRITIQUE_OUTPUT_TOKENS = 8_000
export const CRITIQUE_RETRY_OUTPUT_TOKENS = 12_000

export type CritiqueConceptArgs = {
  prompt: BuiltPrompt
  iteration: number
  // The run's palette freedom: sets the distinctiveness bar of the pass rule
  // (critique.ts) and is stored on the record so a re-parse gives the same verdict.
  paletteFreedom: PaletteFreedom
  costSoFarUsd: number
  costCapUsd: number
  deadline: number
  attribution: { sessionId: string; contentJobId: string; createdBy: string | null }
  now?: () => number
  onSpend?: (totalUsd: number) => void
  // The judge model (default DESIGN_MODEL). Only the design-model A/B script
  // overrides it (CRITIC_MODEL — the same judge for every model under test).
  model?: string
}

export type CritiqueConceptResult = {
  critique: CritiqueRecord | null
  errors: string[] // why the answer was unusable (our zod messages)
  costUsd: number // exact + estimated
  estimatedUsd: number
  stoppedReason: StopReason | null
}

export async function critiqueConcept(args: CritiqueConceptArgs): Promise<CritiqueConceptResult> {
  const now = args.now ?? Date.now
  const caller = createDesignCaller({
    stage: 'design_critique',
    system: CRITIC_SYSTEM_PROMPT,
    logTag: 'design-critique',
    costSoFarUsd: args.costSoFarUsd,
    costCapUsd: args.costCapUsd,
    deadline: args.deadline,
    attribution: args.attribution,
    now,
    onSpend: args.onSpend,
    ...(args.model ? { model: args.model } : {}),
  })
  const shared = args.prompt.sharedPartCount
  const messages = buildCachedPartsMessages(args.prompt.staticPrefix, args.prompt.parts, {
    ttl: '5m',
    ...(shared > 0 ? { breakAt: shared - 1 } : {}),
  })
  const raw = await caller.call(messages, {
    firstBudget: CRITIQUE_OUTPUT_TOKENS,
    retryBudget: CRITIQUE_RETRY_OUTPUT_TOKENS,
    providerOptions: GENERATION_PROVIDER_OPTIONS,
    retryProviderOptions: providerOptionsForAttempt(3),
    label: 'design-critique',
    capMs: CRITIQUE_CALL_CAP_MS,
  })
  const money = { costUsd: caller.spentUsd(), estimatedUsd: caller.estimatedUsd() }
  if (raw === null) return { ...money, critique: null, errors: [], stoppedReason: caller.stopReason() ?? 'no_output' }
  const parsed = parseCritiqueAnswer(raw, {
    iteration: args.iteration,
    model: args.model ?? DESIGN_MODEL,
    at: new Date(now()).toISOString(),
    paletteFreedom: args.paletteFreedom,
  })
  if (!parsed.ok) return { ...money, critique: null, errors: parsed.errors, stoppedReason: 'no_output' }
  return { ...money, critique: parsed.record, errors: [], stoppedReason: null }
}
