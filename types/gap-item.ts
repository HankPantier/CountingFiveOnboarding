export type GapItem = {
  field: string
  label: string
  phase: number
  tier?: 1 | 2 | 3
  topic?: string
  resolved: boolean
  // Set when the chat model listed the gap in resolvedGaps but the field is
  // still empty. The gap stays `resolved: false` — a model skip never satisfies
  // the Tier-1 gate (validatePhaseAdvance counts `resolved` only).
  resolvedBy?: 'model_skip'
}
