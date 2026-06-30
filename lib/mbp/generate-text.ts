import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

// Prose sibling to generate-json.ts. Used by the audit narrative layer, which
// needs human-readable commentary rather than JSON. Returns null on any
// failure — callers treat that as "no narrative" and omit the section.
export async function generateMbpText(
  prompt: string,
  system = 'You are a senior digital-marketing analyst writing for a CPA-firm marketing system. Write clear, specific, jargon-free prose. No markdown headings, no preamble — return only the requested text.',
  maxOutputTokens = 2000,
): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: anthropic('claude-sonnet-5'),
      system,
      prompt,
      maxOutputTokens,
    })
    const trimmed = text.trim()
    return trimmed || null
  } catch (err) {
    console.error('[mbp-text] generation failed:', err)
    return null
  }
}
