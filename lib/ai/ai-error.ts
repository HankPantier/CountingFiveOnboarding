import { APICallError, LoadAPIKeyError } from 'ai'
import {
  aiErrorMessageFor,
  aiErrorKindFromText,
  isProviderIssueKind,
  type AiErrorInfo,
  type AiErrorKind,
} from './ai-error-text'

// Classify an error thrown by (or streamed from) a Claude/Anthropic call so
// every AI surface can tell the user "this looks like a Claude API issue" with
// consistent next steps, instead of a bare generic "try again". Mirrors the
// intent of lib/content/package-error-message.ts and lib/github/error-hint.ts.
// The pure text/keyword logic lives in ./ai-error-text (client-safe); this adds
// structured APICallError inspection (server-only, pulls the `ai` SDK).

export type { AiErrorInfo, AiErrorKind } from './ai-error-text'
export { ANTHROPIC_STATUS_URL, classifyAiErrorText } from './ai-error-text'

// Map an HTTP status (from an APICallError) to a kind. 529 is Anthropic's
// "overloaded"; 5xx are transient upstream failures; 429 is a throttle; 401/403
// is a credential/config problem; 400/413/422 is a request the model rejected
// (invalid, or too long) — that last group otherwise fell through to the generic
// "unknown" message even though it has an actionable cause.
function kindFromStatus(status: number | undefined): AiErrorKind | null {
  if (status === undefined) return null
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 529 || status === 500 || status === 502 || status === 503 || status === 504) return 'overloaded'
  if (status === 402) return 'credit'
  if (status === 400 || status === 413 || status === 422) return 'bad_request'
  return null
}

function infoFor(kind: AiErrorKind): AiErrorInfo {
  return { isProviderIssue: isProviderIssueKind(kind), kind, userMessage: aiErrorMessageFor(kind) }
}

export function classifyAiError(error: unknown): AiErrorInfo {
  // streamText/generateText frequently wrap the underlying provider error in
  // `.cause`, so inspect the error and one level of cause.
  const candidates: unknown[] = [error, (error as { cause?: unknown } | null)?.cause]

  for (const e of candidates) {
    if (!e) continue

    if (APICallError.isInstance(e)) {
      // Scan the message AND the response body — a billing/credit failure comes
      // back as a 400 whose BODY carries the real reason ("credit balance is too
      // low"), not the generic status.
      const text = `${e.message} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`
      const textKind = aiErrorKindFromText(text)
      // A credit or auth signal in the text is more specific and actionable than
      // the HTTP-status bucket (a credit error is a 400 that must NOT surface as
      // "shorten your request"), so it wins over kindFromStatus.
      const kind =
        textKind === 'credit' || textKind === 'auth'
          ? textKind
          : kindFromStatus(e.statusCode) ?? (e.isRetryable ? 'timeout' : textKind)
      if (kind) return infoFor(kind)
    }

    if (LoadAPIKeyError.isInstance(e)) {
      return infoFor('auth')
    }

    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
    const kind = aiErrorKindFromText(msg)
    if (kind) return infoFor(kind)
  }

  return infoFor('unknown')
}

// User-facing string for a streamText response `onError` handler. Provider
// issues get the classified guidance; everything else gets the generic retry.
export function aiStreamErrorMessage(error: unknown): string {
  return classifyAiError(error).userMessage
}

// Pull the diagnosable detail out of an error for logging: the message + name,
// the provider status + response body if it's (or wraps) an APICallError, and the
// stack. Kept compact and bounded so a log line stays readable.
function describeAiError(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause
  const api = APICallError.isInstance(error) ? error : APICallError.isInstance(cause) ? cause : null
  const base = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const apiPart = api
    ? ` [status=${api.statusCode ?? '?'} retryable=${api.isRetryable} body=${String(api.responseBody ?? '').slice(0, 600)}]`
    : ''
  const stack = error instanceof Error && error.stack ? `\n${error.stack}` : ''
  return `${base}${apiPart}${stack}`
}

// The `onError` handler every AI stream route should use: it returns the
// classified user-facing message AND logs the real error server-side. Without the
// log, an UNCLASSIFIED ('unknown') failure — an app exception, a rejected 400, a
// tool throw — vanishes behind the generic user message and is impossible to
// diagnose in production. Provider outages/throttles are logged at warn (expected,
// transient, noisy); genuine unknowns are logged at error with the full stack.
export function logAndFormatAiStreamError(routeTag: string, error: unknown): string {
  const info = classifyAiError(error)
  if (info.kind === 'unknown') {
    console.error(`[ai-error] ${routeTag} UNCLASSIFIED: ${describeAiError(error)}`)
  } else {
    console.warn(`[ai-error] ${routeTag} ${info.kind}: ${describeAiError(error)}`)
  }
  return info.userMessage
}
