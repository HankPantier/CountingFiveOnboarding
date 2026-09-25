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
  set_block_css: 'Block CSS',
  remove_block_css: 'Removed CSS',
}
const WORKING_LABELS: Record<string, string> = { render_preview: 'Rendering a preview…', commit_version: 'Saving to the draft…' }

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
    if (p.type === 'tool-commit_version' && p.state === 'output-available' && isPlainObject(p.output) && p.output.ok === true && typeof p.output.versionNo === 'number') {
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

// A 4xx is refused before the user message is stored, so the composer gets its
// text and attachments back to fix and resend. A 5xx may have stored the
// message (and referenced its attachments), so it stays in the transcript.
export const restoresComposer = (status: number): boolean => status >= 400 && status < 500
