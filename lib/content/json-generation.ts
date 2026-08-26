import { generateText } from 'ai'
import { extractJson } from './extract-json'

type GenTextOpts = Parameters<typeof generateText>[0]
type ProviderOptions = GenTextOpts['providerOptions']
type Usage = Awaited<ReturnType<typeof generateText>>['usage']

// Shared robust JSON generation. One model call with the SDK's built-in backoff
// (`maxRetries`), a tolerant parse via `extractJson` (survives ```fences/prose and
// walks back to the last balanced bracket), and a single larger-budget retry when
// the first parse fails — usually a truncated `length` finish where adaptive
// thinking ate the budget. Mirrors the self-heal already proven in the page-body,
// resource-draft, and blog-idea generators, factored so every generator shares it.
//
// The helper NEVER throws: a model error or an unparseable response both resolve
// to `null`, which callers treat as "use the deterministic fallback".
//
// IMPORTANT: pass `providerOptions` ONLY for non-Haiku models — `effort` errors on
// Haiku 4.5. Omit it entirely for Haiku calls.
export async function generateJson(opts: {
  model: GenTextOpts['model']
  system?: string
  prompt: string
  firstBudget: number
  retryBudget?: number
  providerOptions?: ProviderOptions
  retryProviderOptions?: ProviderOptions
  label: string
  // Called once per attempt (only when the model call itself succeeded) so the
  // caller can record token usage / budget checks. Its own errors are swallowed
  // and never fail the attempt.
  onAttempt?: (usage: Usage, finishReason: string) => void | Promise<void>
}): Promise<unknown | null> {
  const attempt = async (
    maxOutputTokens: number,
    providerOptions: ProviderOptions
  ): Promise<{ ok: true; value: unknown } | { ok: false; finishReason: string }> => {
    let finishReason = 'error'
    try {
      const params: GenTextOpts = {
        model: opts.model,
        prompt: opts.prompt,
        maxOutputTokens,
        // Ride out transient overload/rate-limit (529/429) via exponential backoff
        // instead of throwing out of the generator.
        maxRetries: 4,
      }
      if (opts.system) params.system = opts.system
      if (providerOptions) params.providerOptions = providerOptions
      const result = await generateText(params)
      finishReason = result.finishReason ?? 'unknown'
      if (opts.onAttempt) {
        try {
          await opts.onAttempt(result.usage, finishReason)
        } catch {
          // usage accounting must never fail the generation
        }
      }
      return { ok: true, value: extractJson(result.text) }
    } catch {
      return { ok: false, finishReason }
    }
  }

  let res = await attempt(opts.firstBudget, opts.providerOptions)
  if (!res.ok && opts.retryBudget) {
    console.warn(`[${opts.label}] JSON parse failed (finish=${res.finishReason}) — retrying with larger budget`)
    res = await attempt(opts.retryBudget, opts.retryProviderOptions ?? opts.providerOptions)
  }
  if (res.ok) return res.value
  console.error(`[${opts.label}] Failed to parse model JSON after retry (finish=${res.finishReason})`)
  return null
}
