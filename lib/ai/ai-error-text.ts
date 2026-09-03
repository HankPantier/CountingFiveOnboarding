// Text-only classification of AI failures — safe to import in client
// components (no `ai`/provider SDK dependency). lib/ai/ai-error.ts builds on
// this to also inspect structured APICallError objects server-side.

export type AiErrorKind = 'overloaded' | 'rate_limit' | 'timeout' | 'auth' | 'unknown'

export interface AiErrorInfo {
  // True when the failure looks like a Claude/Anthropic outage, throttle,
  // network drop, or credential problem — i.e. NOT an ordinary app bug.
  isProviderIssue: boolean
  kind: AiErrorKind
  userMessage: string
}

// Where users can check for a real Anthropic outage.
export const ANTHROPIC_STATUS_URL = 'https://status.anthropic.com'

export function aiErrorMessageFor(kind: AiErrorKind): string {
  switch (kind) {
    case 'overloaded':
      return `The AI service (Claude) looks temporarily unavailable or overloaded, so this request may not have finished. Wait a minute and try again — your saved work is safe. If it keeps happening, check ${ANTHROPIC_STATUS_URL}.`
    case 'rate_limit':
      return `The AI service is rate-limited right now, so this request may not have finished. Wait a minute and try again — your saved work is safe. If it keeps happening, check ${ANTHROPIC_STATUS_URL}.`
    case 'timeout':
      return `The AI service didn't respond in time, so this request may not have finished. Wait a moment and try again — your saved work is safe. If it keeps happening, check ${ANTHROPIC_STATUS_URL}.`
    case 'auth':
      return `The AI service rejected our credentials, so AI features are unavailable right now. This is a configuration issue on our side — please tell an administrator. Your saved work is safe.`
    default:
      return 'The assistant hit an error — please try again.'
  }
}

// Recognise a Claude/Anthropic provider issue from an error string (message or
// a stored generation_error). Conservative keyword match so ordinary app
// errors aren't mislabelled.
export function aiErrorKindFromText(msg: string): AiErrorKind | null {
  if (/\boverloaded\b|overloaded_error|\b529\b|service unavailable/i.test(msg)) return 'overloaded'
  if (/rate.?limit|\btoo many requests\b|\b429\b/i.test(msg)) return 'rate_limit'
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network error|\btimed? ?out\b/i.test(msg)) {
    return 'timeout'
  }
  if (/\b401\b|invalid api key|authentication|could not load api key|x-api-key/i.test(msg)) return 'auth'
  return null
}

// Read-time classification of a stored error string (e.g. generated_pages.
// generation_error) for the admin UI. Returns a not-a-provider-issue result
// when the text doesn't match a known Claude failure.
export function classifyAiErrorText(text: string | null | undefined): AiErrorInfo {
  const kind = text ? aiErrorKindFromText(text) : null
  return kind
    ? { isProviderIssue: true, kind, userMessage: aiErrorMessageFor(kind) }
    : { isProviderIssue: false, kind: 'unknown', userMessage: aiErrorMessageFor('unknown') }
}
