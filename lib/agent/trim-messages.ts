import type { UIMessage } from 'ai'

const MAX_MESSAGES = 20

// Reasoning parts are never replayed. Sonnet 5.5 rejects a thinking block whose
// earlier context (system, tools, messages) changed since it was produced, and
// our chats change that context every turn (per-turn page blocks, trimming).
// The current turn's tool loop keeps its reasoning in-request, so it is unaffected.
// Chats stream reasoning to the client (progress notes), so it does come back here.
function withoutReasoning(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((m) => (m.parts.some((p) => p.type === 'reasoning') ? { ...m, parts: m.parts.filter((p) => p.type !== 'reasoning') } : m))
    .filter((m) => m.parts.length > 0)
}

export function trimMessages(messages: UIMessage[]): UIMessage[] {
  const clean = withoutReasoning(messages)
  if (clean.length <= MAX_MESSAGES) return clean
  // Always keep the first message (Phase 0/1 welcome context)
  const first = clean.slice(0, 1)
  const recent = clean.slice(-(MAX_MESSAGES - 1))
  return [...first, ...recent]
}
