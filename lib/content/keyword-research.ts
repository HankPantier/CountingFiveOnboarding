import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'

const KEYWORD_MODEL = 'claude-haiku-4-5-20251001'

type KeywordResult = {
  targetKeyword: string
  secondaryKeywords: string[]
  competitorRefs: Array<{ url: string; title: string }>
}

export async function runKeywordResearch(
  pageTitle: string,
  pageUrl: string,
  firmContext: { name: string; location: string; services: string[]; niches: string[] },
  ctx: { contentJobId: string; sessionId: string }
): Promise<KeywordResult> {
  // Step 1: Claude keyword generation
  const { text, usage } = await generateText({
    model: anthropic(KEYWORD_MODEL),
    system: 'You are an SEO keyword researcher for CPA firms. Return JSON only, no prose.',
    prompt: `Generate search keywords for this CPA firm page.

FIRM: ${firmContext.name} in ${firmContext.location}
SERVICES: ${firmContext.services.join(', ')}
NICHES: ${firmContext.niches.join(', ')}

PAGE: ${pageTitle} (${pageUrl})

Generate realistic CPA-firm search terms a potential client in ${firmContext.location} would use.
Prioritize local intent and service specificity over volume.

Return JSON: { "primary": "keyword phrase", "secondary": ["kw1", "kw2", "kw3"] }`,
    maxOutputTokens: 200,
  })

  checkTokenBudget('keyword-research', pageUrl, usage?.inputTokens, 800)
  await recordTokenUsage({
    task: 'content',
    contentJobId: ctx.contentJobId,
    sessionId: ctx.sessionId,
    stage: 'keyword',
    pageUrl,
    model: KEYWORD_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

  let primary = `${pageTitle.toLowerCase()} ${firmContext.location.toLowerCase()}`
  let secondary: string[] = []

  try {
    const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    primary = parsed.primary ?? primary
    secondary = parsed.secondary ?? []
  } catch {
    console.warn('[keyword-research] Failed to parse Claude response, using fallback')
  }

  // Step 2: Serper validation (if API key is available)
  const competitorRefs: Array<{ url: string; title: string }> = []

  if (process.env.SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: primary,
          gl: 'us',
          num: 3,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const organic = data.organic ?? []
        for (const result of organic.slice(0, 3)) {
          competitorRefs.push({
            url: result.link ?? '',
            title: result.title ?? '',
          })
        }
      }
    } catch (err) {
      console.warn('[keyword-research] Serper call failed:', err)
    }
  }

  return { targetKeyword: primary, secondaryKeywords: secondary, competitorRefs }
}
