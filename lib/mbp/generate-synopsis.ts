import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { serializeSchemaFull } from '@/lib/agent/system-prompt'
import { GENERATION_PROVIDER_OPTIONS } from '@/lib/content/generation-tuning'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { asJson } from '@/lib/supabase/json-typed'

// Sonnet 5 (writing-tuned) — a short, infrequent, admin-triggered summary where
// capturing the firm's tone accurately matters more than shaving a few cents.
const SYNOPSIS_MODEL = 'claude-sonnet-5'

type Supabase = ReturnType<typeof createServerClient>

// Build a human-readable overview of the firm from the MBP so an operator can
// read/verify who the client is and how they sound. Stored on the session
// (_meta.firm_synopsis) and rendered at the top of the MBP page. On demand only.
export async function generateFirmSynopsis(
  sessionId: string,
  supabase: Supabase = createServerClient()
): Promise<{ text: string } | { error: string }> {
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  if (!session) return { error: 'Session not found' }

  const schemaData = session.schema_data ?? {}
  const profile = serializeSchemaFull(schemaData as Parameters<typeof serializeSchemaFull>[0])
  if (profile.trim() === '{}') return { error: 'Nothing in the profile to summarize yet.' }

  const prompt = `Below is a CPA/accounting firm's Master Business Profile as JSON.

${profile}

Write a concise, human-readable synopsis (2 short paragraphs, ~120-180 words total) that lets a Revaltus teammate quickly understand and VERIFY this client:
- Paragraph 1 — WHO they are: firm name, what they do, who they serve (niches/ideal clients), where, and what makes them distinct.
- Paragraph 2 — HOW they sound: their brand voice/tone and any positioning or content direction we should honor.
Ground every statement in the profile — never invent facts. If something central is missing, say so plainly (e.g. "No brand voice captured yet"). Plain prose only: no headings, no bullet lists, no markdown, no preamble.`

  let text: string
  let finishReason: string | undefined
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  try {
    const res = await generateText({
      model: anthropic(SYNOPSIS_MODEL),
      system: 'You are an internal analyst for a CPA-firm marketing agency. Be accurate, specific, and concise. Return prose only.',
      prompt,
      // Adaptive thinking at high effort shares this budget with the visible
      // text — 900 left the synopsis truncated mid-sentence.
      maxOutputTokens: 4000,
      providerOptions: GENERATION_PROVIDER_OPTIONS,
      maxRetries: 2,
    })
    text = res.text
    finishReason = res.finishReason
    usage = res.usage
  } catch (err) {
    console.error('[mbp-synopsis] generation failed:', err)
    return { error: 'Synopsis generation failed. Please try again.' }
  }

  await recordTokenUsage({
    task: 'onboarding',
    sessionId,
    stage: 'mbp_synopsis',
    model: SYNOPSIS_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

  if (finishReason === 'length') {
    return { error: 'Synopsis was cut off before it finished. Please try again.' }
  }
  const clean = text.trim()
  if (!clean) return { error: 'Synopsis came back empty. Please try again.' }

  // Re-read right before the write: the generation takes a while, and writing
  // back the pre-generation snapshot would clobber any edit made meanwhile.
  const { data: fresh } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  if (!fresh) return { error: 'Session not found' }
  const schema = (fresh.schema_data ?? {}) as Record<string, unknown>
  const meta = (schema._meta as Record<string, unknown>) ?? {}
  const updated = {
    ...schema,
    _meta: { ...meta, firm_synopsis: { text: clean, generatedAt: new Date().toISOString() } },
  }
  const { error } = await supabase.from('sessions').update({ schema_data: asJson(updated) }).eq('id', sessionId)
  if (error) return { error: error.message }

  return { text: clean }
}
