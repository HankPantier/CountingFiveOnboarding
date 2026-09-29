// Text-only classification of AI failures — safe to import in client
// components (no `ai`/provider SDK dependency). lib/ai/ai-error.ts builds on
// this to also inspect structured APICallError objects server-side.

export type AiErrorKind = 'overloaded' | 'rate_limit' | 'timeout' | 'auth' | 'credit' | 'usage_limit' | 'bad_request' | 'unknown'

export interface AiErrorInfo {
  // True when the failure looks like a Claude/Anthropic outage, throttle,
  // network drop, or credential problem — i.e. NOT an ordinary app bug.
  isProviderIssue: boolean
  kind: AiErrorKind
  userMessage: string
}

// Which kinds are a provider-side problem — a transient outage / throttle /
// network drop, or an account/config problem (bad key, credits out, usage limit
// reached) — i.e. NOT an app bug (drives AiErrorInfo.isProviderIssue; matches
// classifyAiErrorText, which flags every recognised kind). A bad_request is a
// request the model rejected (too long / malformed) and unknown is an app bug.
export function isProviderIssueKind(kind: AiErrorKind): boolean {
  return kind === 'overloaded' || kind === 'rate_limit' || kind === 'timeout' || kind === 'auth' || kind === 'credit' || kind === 'usage_limit'
}

// Where users can check for a real Anthropic outage.
export const ANTHROPIC_STATUS_URL = 'https://status.anthropic.com'

// The date an account-level usage limit lifts, when the provider's message
// carries it ("You will regain access on 2026-10-01 at 00:00 UTC.").
export function usageLimitResetDate(text: string): string | null {
  const m = /regain access on (\d{4}-\d{2}-\d{2})/i.exec(text)
  return m ? m[1] : null
}

export function aiErrorMessageFor(kind: AiErrorKind, detail: { resetDate?: string | null } = {}): string {
  switch (kind) {
    case 'overloaded':
      return `The AI service (Claude) looks temporarily unavailable or overloaded, so this request may not have finished. Wait a minute and try again — your saved work is safe. If it keeps happening, check ${ANTHROPIC_STATUS_URL}.`
    case 'rate_limit':
      return `The AI service is rate-limited right now, so this request may not have finished. Wait a minute and try again — your saved work is safe. If it keeps happening, check ${ANTHROPIC_STATUS_URL}.`
    case 'timeout':
      return `The AI service didn't respond in time, so this request may not have finished. Wait a moment and try again — your saved work is safe. If it keeps happening, check ${ANTHROPIC_STATUS_URL}.`
    case 'auth':
      return `The AI service rejected our API key or account setup, so AI features are unavailable right now. This is a configuration issue on our side — please tell an administrator. Your saved work is safe.`
    case 'credit':
      return `AI features are paused because the account's Claude API credits have run out. Retrying won't help until an administrator adds credits — please tell them. Your saved work is safe.`
    case 'usage_limit':
      return `AI features are paused because the account's Claude API usage limit has been reached${detail.resetDate ? ` (access returns ${detail.resetDate})` : ''}. Retrying won't help until an administrator raises the limit in the Anthropic Console — please tell them. Your saved work is safe.`
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
  // An account-level spend/usage limit ("You have reached your specified API
  // usage limits. You will regain access on …"). Arrives as a 400
  // invalid_request_error, so it must win over bad_request (and over a 429
  // status bucket) — retrying won't help until the limit is raised.
  if (/api usage limits?|reached your (?:specified )?(?:api )?usage limit|usage limits? (?:reached|exceeded)|regain access on/i.test(msg)) {
    return 'usage_limit'
  }
  if (/\boverloaded\b|overloaded_error|\b529\b|service unavailable/i.test(msg)) return 'overloaded'
  if (/rate.?limit|\btoo many requests\b|\b429\b/i.test(msg)) return 'rate_limit'
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network error|\btimed? ?out\b/i.test(msg)) {
    return 'timeout'
  }
  if (/\b401\b|invalid api key|authentication|could not load api key|x-api-key/i.test(msg)) return 'auth'
  // Account/key misconfiguration that Anthropic returns as a 400/403/404 (e.g. an
  // org-level key without a workspace, a model the workspace can't use). Checked
  // before bad_request, which also matches invalid_request_error — retrying or
  // shortening the request won't help; an admin has to fix the key or model id.
  if (/not scoped to a workspace|anthropic-workspace-id|permission_error|not_found_error[\s\S]{0,80}\bmodel\b/i.test(msg)) {
    return 'auth'
  }
  // Out of Claude API credits / a billing problem. Anthropic returns this as a 400
  // whose body says "credit balance is too low" with type invalid_request_error —
  // so it MUST be checked BEFORE bad_request (which also matches that type) or it
  // would be mislabeled "shorten your request". Retrying won't help; an admin must
  // add credits. A bare "402" alone is not enough (it could be any number in
  // another error's text) — a real 402 is caught by its HTTP status instead.
  if (/credit balance is too low|insufficient (?:credit|balance|funds)|\bbilling\b|plans? *& *billing|payment required|\b402\b.{0,40}(?:credit|billing|payment)/i.test(msg)) {
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
    ? { isProviderIssue: true, kind, userMessage: aiErrorMessageFor(kind, { resetDate: usageLimitResetDate(text ?? '') }) }
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
