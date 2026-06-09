import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

// JSON-mode generation matching the codebase convention (generateText +
// fenced-JSON parse, e.g. lib/content/brand-fit.ts) rather than the AI SDK's
// generateObject, which this project does not use. Returns null on any
// generation or parse failure — callers treat that as "no result".
export async function generateMbpJson<T>(
  prompt: string,
  validate: (parsed: unknown) => T | null,
  maxOutputTokens = 2500
): Promise<T | null> {
  try {
    const { text } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: 'You are a precise assistant for a CPA-firm marketing system. Return ONLY valid JSON — no prose, no markdown code fences.',
      prompt,
      maxOutputTokens,
    })
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed: unknown = JSON.parse(cleaned)
    return validate(parsed)
  } catch (err) {
    console.error('[mbp-json] generation/parse failed:', err)
    return null
  }
}
