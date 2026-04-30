import type { UIMessage } from 'ai'

const MAX_MESSAGES = 20

export function trimMessages(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages
  // Always keep the first message (Phase 0/1 welcome context)
  const first = messages.slice(0, 1)
  const recent = messages.slice(-(MAX_MESSAGES - 1))
  return [...first, ...recent]
}
