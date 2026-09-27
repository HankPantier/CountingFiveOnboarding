// Pure (no SDK import — generator tests mock the `ai` module wholesale; the
// SDK's error classes are recognised by the same marker symbols their own
// isInstance() checks). Sorts a failed model call
// into what the CALLER should do next — distinct from lib/ai/ai-error.ts, which
// picks the words a chat user sees:
//   • rejected  — an account-level refusal (usage/spend limit reached, credit
//                 balance too low, invalid/missing API key, permission denied).
//                 Every further call fails identically until a human fixes the
//                 account, so retries and repair turns are pointless.
//   • transient — throttle (429), overload (529), 5xx, network drop, timeout.
//   • other     — anything else (a bad request, an app error, unparseable output).
// Plus `requestWasRejected`: the provider answered with an HTTP error (or no
// request was sent at all), so nothing was generated or billed.
import { aiErrorKindFromText, usageLimitResetDate } from './ai-error-text'

type ApiCallErrorLike = { message: string; statusCode?: number; responseBody?: unknown; isRetryable: boolean }
type RetryErrorLike = { errors: unknown[]; lastError: unknown }

// AISDKError.hasMarker: every SDK error carries Symbol.for('vercel.ai.error')
// and Symbol.for('vercel.ai.error.<name>').
function hasSdkMarker(error: unknown, name: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as Record<symbol, unknown>
  return e[Symbol.for('vercel.ai.error')] === true && e[Symbol.for(`vercel.ai.error.${name}`)] === true
}
const isApiCallError = (e: unknown): e is ApiCallErrorLike => hasSdkMarker(e, 'AI_APICallError')
const isLoadApiKeyError = (e: unknown): boolean => hasSdkMarker(e, 'AI_LoadAPIKeyError')
const isRetryError = (e: unknown): e is RetryErrorLike => hasSdkMarker(e, 'AI_RetryError')

export type ProviderRejectionKind = 'usage_limit' | 'credit' | 'auth' | 'permission'

export type ProviderRejection = { kind: ProviderRejectionKind; resetDate: string | null }

export type ProviderErrorClass = ({ class: 'rejected' } & ProviderRejection) | { class: 'transient' } | { class: 'other' }

// The provider error itself: after the SDK's backoff gives up it throws a
// RetryError wrapping every attempt's error; wrappers may also hang it on `.cause`.
function unwrap(error: unknown): unknown {
  if (isRetryError(error)) return error.lastError ?? error
  return error
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}

function apiText(e: ApiCallErrorLike): string {
  return `${e.message} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`
}

export function classifyProviderError(error: unknown): ProviderErrorClass {
  const e = unwrap(error)
  if (isLoadApiKeyError(e)) return { class: 'rejected', kind: 'auth', resetDate: null }
  if (isApiCallError(e)) {
    const text = apiText(e)
    const textKind = aiErrorKindFromText(text)
    // The body's reason is more specific than the status: a usage limit or a
    // credit shortfall arrives as a 400 (or even a 429).
    if (textKind === 'usage_limit') return { class: 'rejected', kind: 'usage_limit', resetDate: usageLimitResetDate(text) }
    if (textKind === 'credit' || e.statusCode === 402) return { class: 'rejected', kind: 'credit', resetDate: null }
    if (e.statusCode === 401 || (textKind === 'auth' && e.statusCode !== 403)) return { class: 'rejected', kind: 'auth', resetDate: null }
    if (e.statusCode === 403) return { class: 'rejected', kind: 'permission', resetDate: null }
    if (e.isRetryable || (e.statusCode !== undefined && (e.statusCode === 429 || e.statusCode >= 500))) return { class: 'transient' }
    return { class: 'other' }
  }
  if (isTimeout(e)) return { class: 'transient' }
  return { class: 'other' }
}

export function providerRejection(error: unknown): ProviderRejection | null {
  const c = classifyProviderError(error)
  return c.class === 'rejected' ? { kind: c.kind, resetDate: c.resetDate } : null
}

// An HTTP error status the provider returns BEFORE generating: every 4xx
// (refused request), 529 (overloaded) and 503 (unavailable). NOT 500, 502 or
// 504 — an internal error or a gateway timeout can land after a long
// generation that may have been billed — and never a 2xx (e.g. an "Invalid
// JSON response" APICallError on a 200, which the model did generate).
function isPreGenerationStatus(status: number | undefined): boolean {
  if (typeof status !== 'number') return false
  return (status >= 400 && status < 500) || status === 529 || status === 503
}

// True when the call failed WITHOUT the model generating anything: the provider
// answered with a pre-generation HTTP error (every attempt of a backoff loop
// included), or the request was never sent (no API key). A timeout abort, a
// network drop with no status, a 500/502/504, a 2xx or anything unknown is
// NOT — the provider may have billed, so the caller keeps its estimate.
export function requestWasRejected(error: unknown): boolean {
  if (isLoadApiKeyError(error)) return true
  if (isRetryError(error)) {
    return error.errors.length > 0 && error.errors.every((x) => isApiCallError(x) && isPreGenerationStatus(x.statusCode))
  }
  return isApiCallError(error) && isPreGenerationStatus(error.statusCode)
}
