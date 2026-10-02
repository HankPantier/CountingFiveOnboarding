// Pure + client-safe. How DesignChat shows a chat message: its text, one chip
// per edit-tool call, in-progress tool steps, inline previews, and commit
// confirmations / refusals (from commit_version or the end-of-turn commit).
// Parts are read defensively — history comes back from jsonb.
import { isPlainObject } from './input-validation'
import type { DesignChatMessage } from './chat-types'

export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'edit'; label: string; ok: boolean; detail: string | null }
  | { kind: 'working'; label: string }
  | { kind: 'preview'; previewNo: number; page: string; shots: { viewport: string; url: string }[]; gateFailures: string[]; warnings: string[] }
  | { kind: 'notice'; tone: 'success' | 'warning' | 'error'; text: string; items: string[] }

const EDIT_LABELS: Record<string, string> = {
  set_palette: 'Palette',
  set_fonts: 'Fonts',
  set_tokens: 'Spacing & shape',
  set_treatments: 'Treatments',
  set_style_axes: 'Style presets',
  set_layout_presets: 'Layout presets',
  set_block_css: 'Block CSS',
  remove_block_css: 'Removed CSS',
}
const WORKING_LABELS: Record<string, string> = {
  render_preview: 'Rendering a preview…',
  commit_version: 'Saving to the draft…',
  lock_design: 'Locking…',
  unlock_design: 'Unlocking…',
}
const LOCK_TOOLS = new Set(['lock_design', 'unlock_design'])

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

function editDetail(tool: string, input: unknown): string | null {
  if (!isPlainObject(input)) return null
  if (tool === 'set_block_css' || tool === 'remove_block_css') return typeof input.target === 'string' ? input.target : null
  const keys = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? `${k} ${v}` : k))
  return keys.length > 0 ? keys.join(', ') : null
}

function commitNotice(data: Record<string, unknown>): ChatBlock | null {
  if (data.status === 'committed' && typeof data.versionNo === 'number') {
    return { kind: 'notice', tone: 'success', text: `Saved to the draft as v${data.versionNo} (end of reply)`, items: strings(data.warnings) }
  }
  if (data.status === 'blocked') return { kind: 'notice', tone: 'error', text: typeof data.error === 'string' ? data.error : 'Not saved.', items: strings(data.failures) }
  return null
}

export function chatBlocks(m: DesignChatMessage): ChatBlock[] {
  const out: ChatBlock[] = []
  for (const p of m.parts as unknown[]) {
    if (!isPlainObject(p) || typeof p.type !== 'string') continue
    if (p.type === 'text') {
      if (typeof p.text === 'string' && p.text.trim()) out.push({ kind: 'text', text: p.text })
      continue
    }
    if (p.type === 'data-design-commit') {
      const n = isPlainObject(p.data) ? commitNotice(p.data) : null
      if (n) out.push(n)
      continue
    }
    if (!p.type.startsWith('tool-')) continue
    const tool = p.type.slice('tool-'.length)
    if (p.state !== 'output-available' && p.state !== 'output-error') {
      out.push({ kind: 'working', label: WORKING_LABELS[tool] ?? `${EDIT_LABELS[tool] ?? 'Working'}…` })
      continue
    }
    const output = p.state === 'output-available' && isPlainObject(p.output) ? p.output : null
    const error = typeof output?.error === 'string' ? output.error : typeof p.errorText === 'string' ? p.errorText : 'The step failed.'
    if (tool in EDIT_LABELS) {
      const ok = output?.ok === true
      out.push({ kind: 'edit', label: EDIT_LABELS[tool], ok, detail: ok ? editDetail(tool, p.input) : error })
    } else if (tool === 'render_preview') {
      if (output?.ok !== true) {
        out.push({ kind: 'notice', tone: 'warning', text: `Preview failed: ${error}`, items: [] })
        continue
      }
      const shots = (Array.isArray(output.shots) ? output.shots : []).flatMap((s) =>
        isPlainObject(s) && typeof s.viewport === 'string' && typeof s.url === 'string' ? [{ viewport: s.viewport, url: s.url }] : []
      )
      out.push({
        kind: 'preview',
        previewNo: typeof output.previewNo === 'number' ? output.previewNo : 0,
        page: typeof output.page === 'string' ? output.page : '/',
        shots,
        gateFailures: strings(output.gateFailures),
        warnings: strings(output.warnings),
      })
    } else if (LOCK_TOOLS.has(tool)) {
      const verb = tool === 'lock_design' ? 'Locked' : 'Unlocked'
      if (output?.ok === true) {
        const names = strings(output.changed)
        const v = typeof output.versionNo === 'number' ? ` (saved as v${output.versionNo})` : ''
        out.push({ kind: 'notice', tone: 'success', text: names.length > 0 ? `${verb}: ${names.join(', ')}${v}` : `Nothing new to ${verb.toLowerCase().replace(/ed$/, '')}`, items: [] })
      } else {
        out.push({ kind: 'notice', tone: 'error', text: error, items: [] })
      }
    } else if (tool === 'commit_version') {
      if (output?.ok === true && typeof output.versionNo === 'number') {
        out.push({ kind: 'notice', tone: 'success', text: `Saved to the draft as v${output.versionNo}`, items: strings(output.warnings) })
      } else if (output?.ok !== true) {
        out.push({ kind: 'notice', tone: 'error', text: error, items: strings(output?.failures) })
      }
    }
  }
  return out
}

export function committedVersionNos(m: DesignChatMessage): number[] {
  const out: number[] = []
  for (const p of m.parts as unknown[]) {
    if (!isPlainObject(p)) continue
    const versioned = p.type === 'tool-commit_version' || p.type === 'tool-lock_design' || p.type === 'tool-unlock_design'
    if (versioned && p.state === 'output-available' && isPlainObject(p.output) && p.output.ok === true && typeof p.output.versionNo === 'number') {
      out.push(p.output.versionNo)
    }
    if (p.type === 'data-design-commit' && isPlainObject(p.data) && p.data.status === 'committed' && typeof p.data.versionNo === 'number') out.push(p.data.versionNo)
  }
  return out
}

export const messageCommitted = (m: DesignChatMessage): boolean => committedVersionNos(m).length > 0

export function lastAssistant(messages: DesignChatMessage[]): DesignChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i]
  return null
}

// PF12 — a turn refused before its stream starts (a 4xx from POST
// design/chat, e.g. a missing attachment or an unreadable draft) comes back as
// plain JSON `{ error }`. Show the server's own text, never the raw body.
export function chatRequestErrorText(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (isPlainObject(parsed) && typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
  } catch {
    // Not JSON (e.g. a platform error page) — fall through.
  }
  if (status === 413) return 'That message is too large to send — try fewer or smaller images.'
  return `The chat request failed (${status}).`
}

// "Fix in chat": the turn's 400 when the concept the client sent is gone or no
// longer ready. The chat drops its concept chip on it (client-safe copy here;
// chat-turn re-exports it).
export const MISSING_CONCEPT = 'That concept is no longer available — open the run and pick it again.'

// The route's 503 when the chat engine module fails to load — sent BEFORE
// anything is stored (the route imports it from here, so the two can't drift).
export const CHAT_ENGINE_UNAVAILABLE_ERROR = 'The design chat is unavailable right now.'

// A 4xx is refused before the user message is stored, and so is the route's
// pre-engine 503 (recognized by its exact text) — the composer gets its text
// and attachments back to fix and resend. Any other 5xx may have stored the
// message (and referenced its attachments), so it stays in the transcript.
export const restoresComposer = (status: number, errorText = ''): boolean =>
  (status >= 400 && status < 500) || (status === 503 && errorText === CHAT_ENGINE_UNAVAILABLE_ERROR)

// "Fix in chat": the concept chip after a refused turn. Only the turn's 400
// for THAT concept (gone / no longer ready) drops it; any other refusal keeps
// it, since the id is simply re-sent with the retried message.
export function adoptAfterRefusal<T extends { conceptId: string }>(current: T | null, sent: T | null, status: number, errorText: string): T | null {
  if (!sent || !current || status !== 400 || errorText !== MISSING_CONCEPT) return current
  return current.conceptId === sent.conceptId ? null : current
}
