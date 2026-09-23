import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { recordTokenUsage, type TokenContext } from '@/lib/content/token-usage'
import { extractJson } from '@/lib/content/extract-json'
import { buildCachedMessages, extractCacheUsage } from '@/lib/content/cache-control'
import type { CacheTtl } from '@/lib/content/token-pricing'

const MBP_JSON_MODEL = 'claude-sonnet-5'

// Hard ceiling on a single generation. Without it an AI SDK call has no timeout
// and can hang indefinitely — which, in the audit intelligence stage (many
// sequential Sonnet passes), is enough to run the whole function past its
// maxDuration and get the row swept to 'error'. 110s stays under the tightest
// caller route (the 120s draft-session) while bounding every call. Overridable
// per-call via `opts.timeoutMs`. On abort, generateText throws → we return null,
// which every caller already treats as "no result".
// Sized against the TIGHTEST caller route. Callers on a longer budget should pass
// their own `timeoutMs` — a value tuned for a 120s route is needlessly strict for
// one running in a 600s function.
const GENERATION_TIMEOUT_MS = 110_000

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// JSON-mode generation matching the codebase convention (generateText +
// fenced-JSON parse, e.g. lib/content/brand-fit.ts) rather than the AI SDK's
// generateObject, which this project does not use. Returns null on any
// generation or parse failure — callers treat that as "no result".
//
// `ctx` is optional attribution: when present, each call's token usage is
// persisted for the Token Usage dashboard. This helper is shared by MBP
// generation (task 'onboarding') and the audit intelligence layer (task
// 'audit'), so the category is supplied per-call by the caller.
// `opts.model` overrides the default Sonnet tier (e.g. the audit→session draft
// runs on the sonnet-5 published-content model); `opts.providerOptions` threads
// adaptive thinking / effort.
// Both default to the Sonnet, no-thinking behavior used by every other caller.
//
// `opts.attempts` (default 1) re-runs the call when it produces no usable result
// — a generation/parse error, or a `validate` that returns null. When set, an
// `opts.accept` predicate can additionally require a result be "complete enough"
// (e.g. a section whose content arrays are populated): a validated-but-rejected
// result is retried, and the last non-null result is returned as a fallback if
// no attempt satisfies `accept`. This is how the audit niche passes stop
// silently dropping their content on a single transient hiccup.
//
// `opts.cachePrefix` is sent BEFORE `prompt` behind a prompt-cache breakpoint.
// Put only text that repeats across calls in it (instructions + the MBP), and the
// per-call part in `prompt` — any per-call value in the prefix defeats the cache.
export async function generateMbpJson<T>(
  prompt: string,
  validate: (parsed: unknown) => T | null,
  maxOutputTokens = 2500,
  ctx?: TokenContext,
  opts?: {
    model?: string
    providerOptions?: Parameters<typeof generateText>[0]['providerOptions']
    attempts?: number
    accept?: (result: T) => boolean
    timeoutMs?: number
    cachePrefix?: string
    cacheTtl?: CacheTtl
  }
): Promise<T | null> {
  const model = opts?.model ?? MBP_JSON_MODEL
  const attempts = Math.max(1, opts?.attempts ?? 1)
  const timeoutMs = opts?.timeoutMs ?? GENERATION_TIMEOUT_MS
  let fallback: T | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await generateOnce<T>(
      model, prompt, validate, maxOutputTokens, ctx, opts?.providerOptions, timeoutMs, opts?.cachePrefix, opts?.cacheTtl,
    )
    if (result !== null) {
      if (!opts?.accept || opts.accept(result)) return result
      // Validated but not complete enough — keep as fallback and try again.
      fallback = result
      console.warn(`[mbp-json] attempt ${attempt}/${attempts} returned an incomplete result; retrying`)
    }
    if (attempt < attempts) await delay(400 * attempt)
  }

  return fallback
}

async function generateOnce<T>(
  model: string,
  prompt: string,
  validate: (parsed: unknown) => T | null,
  maxOutputTokens: number,
  ctx: TokenContext | undefined,
  providerOptions: Parameters<typeof generateText>[0]['providerOptions'] | undefined,
  timeoutMs: number,
  cachePrefix: string | undefined,
  cacheTtl: CacheTtl | undefined,
): Promise<T | null> {
  const startedAt = Date.now()
  // One extra generation when the output isn't parseable JSON (prose wrapper,
  // truncation) — but only while at least half the timeout budget remains, so a
  // retry can't push a caller on a tight route past its maxDuration.
  for (let parseAttempt = 1; parseAttempt <= 2; parseAttempt++) {
    const remaining = timeoutMs - (Date.now() - startedAt)
    let text: string
    try {
      const res = await generateText({
        model: anthropic(model),
        system: 'You are a precise assistant for a CPA-firm marketing system. Return ONLY valid JSON — no prose, no markdown code fences.',
        ...(cachePrefix
          ? { messages: buildCachedMessages(cachePrefix, prompt, cacheTtl) }
          : { prompt }),
        maxOutputTokens,
        abortSignal: AbortSignal.timeout(remaining),
        ...(providerOptions ? { providerOptions } : {}),
      })
      text = res.text
      if (ctx) {
        await recordTokenUsage({
          ...ctx,
          model,
          inputTokens: res.usage?.inputTokens,
          outputTokens: res.usage?.outputTokens,
          ...extractCacheUsage(res.usage),
          ...(cachePrefix ? { cacheTtl } : {}),
        })
      }
    } catch (err) {
      console.error('[mbp-json] generation failed:', err)
      return null
    }
    let parsed: unknown
    try {
      parsed = extractJson(text)
    } catch (err) {
      const canRetry = parseAttempt === 1 && Date.now() - startedAt < timeoutMs / 2
      console.error(`[mbp-json] parse failed${canRetry ? ' — retrying once' : ''}:`, err)
      if (canRetry) continue
      return null
    }
    try {
      return validate(parsed)
    } catch (err) {
      console.error('[mbp-json] validate failed:', err)
      return null
    }
  }
  return null
}
