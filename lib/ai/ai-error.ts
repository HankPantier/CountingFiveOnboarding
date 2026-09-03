import { APICallError, LoadAPIKeyError } from 'ai'
import { aiErrorMessageFor, aiErrorKindFromText, type AiErrorInfo, type AiErrorKind } from './ai-error-text'

// Classify an error thrown by (or streamed from) a Claude/Anthropic call so
// every AI surface can tell the user "this looks like a Claude API issue" with
// consistent next steps, instead of a bare generic "try again". Mirrors the
// intent of lib/content/package-error-message.ts and lib/github/error-hint.ts.
// The pure text/keyword logic lives in ./ai-error-text (client-safe); this adds
// structured APICallError inspection (server-only, pulls the `ai` SDK).

export type { AiErrorInfo, AiErrorKind } from './ai-error-text'
export { ANTHROPIC_STATUS_URL, classifyAiErrorText } from './ai-error-text'

// Map an HTTP status (from an APICallError) to a provider-issue kind. 529 is
// Anthropic's "overloaded"; 5xx are transient upstream failures; 429 is a
// throttle; 401/403 is a credential/config problem.
function kindFromStatus(status: number | undefined): AiErrorKind | null {
  if (status === undefined) return null
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 529 || status === 500 || status === 502 || status === 503 || status === 504) return 'overloaded'
  return null
}

export function classifyAiError(error: unknown): AiErrorInfo {
  // streamText/generateText frequently wrap the underlying provider error in
  // `.cause`, so inspect the error and one level of cause.
  const candidates: unknown[] = [error, (error as { cause?: unknown } | null)?.cause]

  for (const e of candidates) {
    if (!e) continue

    if (APICallError.isInstance(e)) {
      const kind = kindFromStatus(e.statusCode) ?? (e.isRetryable ? 'timeout' : aiErrorKindFromText(e.message))
      if (kind) return { isProviderIssue: true, kind, userMessage: aiErrorMessageFor(kind) }
    }

    if (LoadAPIKeyError.isInstance(e)) {
      return { isProviderIssue: true, kind: 'auth', userMessage: aiErrorMessageFor('auth') }
    }

    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
    const kind = aiErrorKindFromText(msg)
    if (kind) return { isProviderIssue: true, kind, userMessage: aiErrorMessageFor(kind) }
  }

  return { isProviderIssue: false, kind: 'unknown', userMessage: aiErrorMessageFor('unknown') }
}

// User-facing string for a streamText response `onError` handler. Provider
// issues get the classified guidance; everything else gets the generic retry.
export function aiStreamErrorMessage(error: unknown): string {
  return classifyAiError(error).userMessage
}
