// Pure + client-safe. The design chat's messages: request parsing, what is
// stored in design_chat_messages.parts (never signed URLs, never base64,
// never reasoning), DB row → UI message, and the history the model sees —
// trimmed to a budget, with attachment images only on the last 2 user turns.
import type { Tables } from '@/types/database'
import { isPlainObject, isUuid } from './input-validation'
import {
  CHAT_TEXT_MAX,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_MESSAGES,
  IMAGE_USER_TURNS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_PAGE_PATH_LENGTH,
  type DesignChatMessage,
} from './chat-types'

export type ChatMessageRow = Tables<'design_chat_messages'>
export type ChatRequest = { text: string; attachmentIds: string[]; page: string | null }
type Parts = DesignChatMessage['parts']

export function parseChatRequest(raw: unknown): { ok: true; request: ChatRequest } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: 'Invalid JSON body.' }
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return { ok: false, error: 'Type a message.' }
  if (text.length > CHAT_TEXT_MAX) return { ok: false, error: `Messages must be ${CHAT_TEXT_MAX} characters or fewer.` }
  const ids: unknown = raw.attachmentIds ?? []
  if (!Array.isArray(ids) || !ids.every((i): i is string => typeof i === 'string' && isUuid(i))) {
    return { ok: false, error: 'attachmentIds must be a list of attachment ids.' }
  }
  const attachmentIds = [...new Set(ids.map((i) => i.toLowerCase()))]
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) return { ok: false, error: `Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.` }
  let page: string | null = null
  if (raw.page !== undefined && raw.page !== null) {
    if (typeof raw.page !== 'string' || !raw.page.startsWith('/') || raw.page.startsWith('//') || raw.page.length > MAX_PAGE_PATH_LENGTH) {
      return { ok: false, error: 'page must be a site path like /services.' }
    }
    page = raw.page
  }
  return { ok: true, request: { text, attachmentIds, page } }
}

export function messageText(m: Pick<DesignChatMessage, 'parts'>): string {
  return m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
}

const SETTLED_TOOL_STATES = new Set(['output-available', 'output-error'])

function withoutShotUrls(output: unknown): unknown {
  if (!isPlainObject(output) || !Array.isArray(output.shots)) return output
  return {
    ...output,
    shots: output.shots.map((s) => {
      if (!isPlainObject(s)) return s
      const { url: _url, ...rest } = s
      return rest
    }),
  }
}

// What the DB keeps of a streamed assistant message.
export function storedParts(parts: readonly unknown[]): unknown[] {
  const out: unknown[] = []
  for (const p of parts) {
    if (!isPlainObject(p) || typeof p.type !== 'string') continue
    if (p.type === 'text' && typeof p.text === 'string' && p.text) out.push({ type: 'text', text: p.text })
    else if (p.type === 'step-start') out.push({ type: 'step-start' })
    else if (p.type === 'data-design-commit') out.push({ type: p.type, data: p.data })
    else if (p.type.startsWith('tool-') && typeof p.state === 'string' && SETTLED_TOOL_STATES.has(p.state)) {
      const base = { type: p.type, toolCallId: p.toolCallId, state: p.state, input: p.input }
      out.push(
        p.state === 'output-available'
          ? { ...base, output: p.type === 'tool-render_preview' ? withoutShotUrls(p.output) : p.output }
          : { ...base, errorText: p.errorText }
      )
    }
  }
  return out
}

function previewShots(p: unknown): Record<string, unknown>[] {
  if (!isPlainObject(p) || p.type !== 'tool-render_preview' || !isPlainObject(p.output) || !Array.isArray(p.output.shots)) return []
  return p.output.shots.filter(isPlainObject)
}

export function previewPathsInParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) return []
  return parts.flatMap((p) => previewShots(p).flatMap((s) => (typeof s.path === 'string' && s.path.startsWith('design/') && !s.path.includes('..') ? [s.path] : [])))
}

function parseStoredParts(value: unknown, content: string): unknown[] {
  if (Array.isArray(value) && value.length > 0 && value.every((p) => isPlainObject(p) && typeof p.type === 'string')) return value
  return content ? [{ type: 'text', text: content }] : []
}

function signPreview(part: unknown, sign: (path: string) => string | null): unknown {
  if (previewShots(part).length === 0 || !isPlainObject(part) || !isPlainObject(part.output) || !Array.isArray(part.output.shots)) return part
  return {
    ...part,
    output: { ...part.output, shots: part.output.shots.map((s) => (isPlainObject(s) && typeof s.path === 'string' ? { ...s, url: sign(s.path) } : s)) },
  }
}

export function rowToChatMessage(
  row: ChatMessageRow,
  urls: { preview: (path: string) => string | null; attachment: (id: string) => string | null }
): DesignChatMessage {
  const parts = parseStoredParts(row.parts, row.content).map((p) => signPreview(p, urls.preview))
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    // Stored parts were produced by storedParts() from this same message type.
    parts: parts as Parts,
    metadata: { attachments: row.attachment_ids.map((id) => ({ id, url: urls.attachment(id) })), versionId: row.version_id, createdAt: row.created_at },
  }
}

export function historyForModel(messages: DesignChatMessage[]): DesignChatMessage[] {
  const kept: DesignChatMessage[] = []
  let chars = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = JSON.stringify(messages[i].parts).length
    if (kept.length > 0 && (kept.length >= HISTORY_MAX_MESSAGES || chars + size > HISTORY_MAX_CHARS)) break
    kept.unshift(messages[i])
    chars += size
  }
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift()
  return kept
}

export function imageTurnIds(messages: DesignChatMessage[]): string[] {
  return messages.filter((m) => m.role === 'user').slice(-IMAGE_USER_TURNS).map((m) => m.id)
}

export function withAttachmentImages(
  messages: DesignChatMessage[],
  images: Record<string, { mediaType: string; base64: string }[]>
): DesignChatMessage[] {
  return messages.map((m) => {
    if (m.role !== 'user') return m
    const inline = images[m.id] ?? []
    if (inline.length > 0) {
      const files: Parts = inline.map((i) => ({ type: 'file' as const, mediaType: i.mediaType, url: `data:${i.mediaType};base64,${i.base64}` }))
      return { ...m, parts: [...m.parts, ...files] }
    }
    const n = m.metadata?.attachments?.length ?? 0
    if (n === 0) return m
    const text = `[${n} annotated screenshot${n === 1 ? ' was' : 's were'} attached here earlier — ${n === 1 ? 'it is' : 'they are'} no longer shown]`
    return { ...m, parts: [...m.parts, { type: 'text' as const, text }] }
  })
}

// When the previous turn's staged changes could not be saved, the next turn's
// context says so (they are gone — there is no staged state between turns).
export function lastTurnNote(messages: DesignChatMessage[]): string | null {
  const last = [...messages].reverse().find((m) => m.role === 'assistant')
  if (!last) return null
  for (const p of last.parts) {
    if (p.type === 'data-design-commit' && p.data.status === 'blocked') {
      return `NOTE: your previous turn's changes were NOT saved (${p.data.error}). Nothing from that turn is on the draft — redo them if the admin still wants them.`
    }
  }
  return null
}
