// Text-only classification of AI failures — safe to import in client
// components (no `ai`/provider SDK dependency). lib/ai/ai-error.ts builds on
// this to also inspect structured APICallError objects server-side.

export type AiErrorKind = 'overloaded' | 'rate_limit' | 'timeout' | 'auth' | 'credit' | 'bad_request' | 'unknown'

export interface AiErrorInfo {
  // True when the failure looks like a Claude/Anthropic outage, throttle,
  // network drop, or credential problem — i.e. NOT an ordinary app bug.
  isProviderIssue: boolean
  kind: AiErrorKind
  userMessage: string
}

// Which kinds are a transient provider outage / throttle / network drop / config
// problem (drives AiErrorInfo.isProviderIssue). A bad_request is a request the
// model rejected (too long / malformed) and unknown is an app bug — neither is a
// provider outage, so retrying the identical request won't help.
export function isProviderIssueKind(kind: AiErrorKind): boolean {
  return kind === 'overloaded' || kind === 'rate_limit' || kind === 'timeout' || kind === 'auth'
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
    case 'credit':
      return `AI features are paused because the account's Claude API credits have run out. Retrying won't help until an administrator adds credits — please tell them. Your saved work is safe.`
    case 'bad_request':
      return `The AI service couldn't process that request — the page or your instruction may be too long or complex. Try a shorter, more specific instruction. If it keeps happening, tell an administrator. Your saved work is safe.`
    default:
      return 'The assistant hit an unexpected error — please try again. If it keeps happening, tell an administrator (the details are in the server logs). Your saved work is safe.'
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
  // Out of Claude API credits / a billing problem. Anthropic returns this as a 400
  // whose body says "credit balance is too low" with type invalid_request_error —
  // so it MUST be checked BEFORE bad_request (which also matches that type) or it
  // would be mislabeled "shorten your request". Retrying won't help; an admin must
  // add credits.
  if (/credit balance is too low|insufficient (?:credit|balance|funds)|\bbilling\b|plans? *& *billing|payment required|\b402\b/i.test(msg)) {
    return 'credit'
  }
  // A request the provider rejected: invalid request, or a prompt/payload that
  // exceeds the model's limits. Retrying the same input won't help — the user
  // needs to shorten/simplify. Checked last so outages/throttles win.
  if (/invalid_request_error|invalid request|prompt is too long|too many tokens|maximum.{0,20}tokens|request too large|payload too large|\b413\b|\b422\b/i.test(msg)) {
    return 'bad_request'
  }
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

// DefaultChatTransport (ai SDK) surfaces a non-2xx fetch response by throwing
// `new Error(await response.text())` — so a 429/500 with a JSON body like
// `{ "error": "You've reached..." }` (e.g. the chat spend-limit ceiling in
// lib/ai/chat-spend-limit.ts) reaches useChat()'s `error.message` as the raw
// JSON string, and components render it verbatim in AiIssueNotice. Unwrap that
// JSON envelope back into its human-readable text; anything that isn't a JSON
// object with a string `error` field (plain text, malformed JSON) passes
// through unchanged.
export function unwrapChatErrorMessage(message: string): string {
  const trimmed = message.trim()
  if (!trimmed.startsWith('{')) return message
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error?: unknown }).error
      if (typeof err === 'string' && err.trim()) return err
    }
  } catch {
    // Malformed JSON-looking text — fall through to the original message.
  }
  return message
}
