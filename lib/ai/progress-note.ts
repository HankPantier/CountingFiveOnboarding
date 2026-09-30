import type { UIMessage } from 'ai'

const MAX_CHARS = 200

// The latest progress note in the reply that's streaming now. Chats run with
// `display: 'summarized'` because Sonnet 5.5 puts its notes between tool calls
// into thinking blocks rather than text. Without this, a multi-step edit would
// show nothing until the final answer. Returns null when the newest message is
// not an assistant reply, or the reply has no reasoning yet.
export function latestProgressNote(messages: UIMessage[]): string | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return null
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const part = last.parts[i]
    if (part.type !== 'reasoning') continue
    const paragraph = part.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).pop()
    if (!paragraph) continue
    const flat = paragraph.replace(/\s+/g, ' ')
    if (flat.length <= MAX_CHARS) return flat
    return `${flat.slice(0, flat.lastIndexOf(' ', MAX_CHARS)).trimEnd()}…`
  }
  return null
}
