import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { recordTokenUsage, type TokenContext } from '@/lib/content/token-usage'

const MBP_JSON_MODEL = 'claude-sonnet-4-6'

// JSON-mode generation matching the codebase convention (generateText +
// fenced-JSON parse, e.g. lib/content/brand-fit.ts) rather than the AI SDK's
// generateObject, which this project does not use. Returns null on any
// generation or parse failure — callers treat that as "no result".
//
// `ctx` is optional attribution: when present, each call's token usage is
// persisted for the Token Usage dashboard. This helper is shared by MBP
// generation (task 'onboarding') and the audit intelligence layer (task
// 'audit'), so the category is supplied per-call by the caller.
export async function generateMbpJson<T>(
  prompt: string,
  validate: (parsed: unknown) => T | null,
  maxOutputTokens = 2500,
  ctx?: TokenContext
): Promise<T | null> {
  try {
    const { text, usage } = await generateText({
      model: anthropic(MBP_JSON_MODEL),
      system: 'You are a precise assistant for a CPA-firm marketing system. Return ONLY valid JSON — no prose, no markdown code fences.',
      prompt,
      maxOutputTokens,
    })
    if (ctx) {
      await recordTokenUsage({
        ...ctx,
        model: MBP_JSON_MODEL,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      })
    }
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed: unknown = JSON.parse(cleaned)
    return validate(parsed)
  } catch (err) {
    console.error('[mbp-json] generation/parse failed:', err)
    return null
  }
}
