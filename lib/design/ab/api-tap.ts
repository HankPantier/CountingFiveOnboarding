// Pure. Helpers for the design-model A/B script's fetch tap: it observes the
// raw Anthropic Messages responses (the shared generateJson swallows provider
// errors, so a 400 on an unsupported provider option would otherwise show up
// only as "no output") to report per-call token usage and API errors.
import { isPlainObject } from '../input-validation'

export type ApiUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

export const ZERO_USAGE: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const MAX_ERROR_CHARS = 300

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

// The `usage` of a non-streaming Messages response. input_tokens is the
// UNCACHED input (the API reports cache reads / writes separately).
export function parseAnthropicUsage(body: unknown): ApiUsage | null {
  if (!isPlainObject(body) || !isPlainObject(body.usage)) return null
  const u = body.usage
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
  }
}

export function addUsage(a: ApiUsage, b: ApiUsage): ApiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

// "HTTP 400 invalid_request_error: <message>" from an error response body
// (Anthropic's {"type":"error","error":{"type","message"}}), else the clipped text.
export function apiErrorSummary(status: number, bodyText: string): string {
  let detail = bodyText.trim()
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (isPlainObject(parsed) && isPlainObject(parsed.error)) {
      const type = typeof parsed.error.type === 'string' ? parsed.error.type : ''
      const message = typeof parsed.error.message === 'string' ? parsed.error.message : ''
      detail = [type, message].filter(Boolean).join(': ')
    }
  } catch {
    // not JSON — keep the raw text
  }
  const clipped = detail.length > MAX_ERROR_CHARS ? `${detail.slice(0, MAX_ERROR_CHARS - 1)}…` : detail
  return `HTTP ${status}${clipped ? ` ${clipped}` : ''}`
}
