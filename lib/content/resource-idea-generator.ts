import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildBrandVoiceBlock, firmLocation } from './brand-voice'
import { headCheckUrls, type ExternalLink } from './link-checker'
import { checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { listTree, DRAFT_BRANCH } from '@/lib/github/repo-files'
import { asJson } from '@/lib/supabase/json-typed'
import type { SessionSchema } from '@/types/session-schema'

const IDEA_MODEL = 'claude-sonnet-4-6'
const DEFAULT_IDEA_COUNT = 9
const SEEDED_IDEA_COUNT = 5

export type GeneratedIdea = {
  title: string
  angle: string
  target_keyword: string
  secondary_keywords: string[]
  rationale: string
  suggested_external_links: ExternalLink[]
  score: number
  score_breakdown: {
    stickiness: number
    sharability: number
    localRelevance: number
    aioAnswerability: number
  }
}

type SerperResult = {
  organic: Array<{ title: string; link: string; snippet?: string }>
  peopleAlsoAsk: Array<{ question: string }>
}

async function serperSearch(query: string): Promise<SerperResult> {
  const empty: SerperResult = { organic: [], peopleAlsoAsk: [] }
  if (!process.env.SERPER_API_KEY) return empty
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, gl: 'us', num: 6 }),
    })
    if (!res.ok) return empty
    const data = await res.json()
    return {
      organic: (data.organic ?? [])
        .slice(0, 6)
        .map((r: { title?: string; link?: string; snippet?: string }) => ({
          title: r.title ?? '',
          link: r.link ?? '',
          snippet: r.snippet ?? '',
        })),
      peopleAlsoAsk: (data.peopleAlsoAsk ?? [])
        .slice(0, 6)
        .map((q: { question?: string }) => ({ question: q.question ?? '' })),
    }
  } catch (err) {
    console.warn('[resource-ideas] Serper call failed:', err)
    return empty
  }
}

// Read existing post titles from the repo's draft branch so brainstorming
// never re-suggests something already published. Slugs are a good-enough
// title proxy — no need to fetch each file's frontmatter here.
async function listExistingPostSlugs(githubRepo: string): Promise<string[]> {
  try {
    const entries = await listTree(githubRepo, DRAFT_BRANCH, 'content/posts/')
    return entries
      .filter((e) => e.type === 'blob' && e.path.endsWith('.md'))
      .map((e) => e.path.slice('content/posts/'.length, -3))
  } catch (err) {
    console.warn('[resource-ideas] Failed to list existing posts:', err)
    return []
  }
}

function buildResearchBlock(results: Array<{ query: string; result: SerperResult }>): string {
  const lines: string[] = []
  for (const { query, result } of results) {
    if (result.organic.length === 0 && result.peopleAlsoAsk.length === 0) continue
    lines.push(`Search: "${query}"`)
    for (const paa of result.peopleAlsoAsk) {
      if (paa.question) lines.push(`  People also ask: ${paa.question}`)
    }
    for (const o of result.organic) {
      lines.push(`  Result: [${o.title}](${o.link}) — ${o.snippet?.slice(0, 160) ?? ''}`)
    }
  }
  return lines.join('\n')
}

export async function generateResourceIdeas(
  contentJobId: string,
  sessionId: string,
  opts: { count?: number; seed?: string } = {}
): Promise<{ created: number }> {
  const supabase = createServerClient()
  const seed = opts.seed?.trim() || null
  // Seeded runs extrapolate one base idea — fewer, tighter variations.
  const count = opts.count ?? (seed ? SEEDED_IDEA_COUNT : DEFAULT_IDEA_COUNT)

  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo')
    .eq('id', contentJobId)
    .single()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  if (!job?.github_repo || !session) {
    console.error('[resource-ideas] Job/session not found or repo not linked')
    return { created: 0 }
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const firmName = schema.business?.name ?? 'the firm'
  const location = firmLocation(schema)
  const services = (schema.services ?? []).map((s) => s.name).filter(Boolean)
  const niches = (schema.niches ?? []).map((n) => n.name).filter(Boolean)

  // Serper research — up to 3 queries. Seeded runs research the seed itself;
  // open runs blend service × niche × locality. All failures are non-fatal;
  // ideas degrade to schema-only generation.
  const queries = (seed
    ? [
        seed,
        `${seed} ${location}`.trim(),
        `${seed} CPA advice`,
      ]
    : [
        `${services[0] ?? 'CPA'} questions ${location}`.trim(),
        niches[0] ? `${niches[0]} accounting advice` : null,
        `small business tax planning ${new Date().getFullYear()} ${location}`.trim(),
      ]
  ).filter((q): q is string => !!q)
  const research = await Promise.all(
    queries.map(async (query) => ({ query, result: await serperSearch(query) }))
  )

  // Dedupe context: existing ideas in any status + posts already in the repo.
  const { data: existingIdeas } = await supabase
    .from('resource_ideas')
    .select('title')
    .eq('content_job_id', contentJobId)
  const existingTitles = (existingIdeas ?? []).map((i) => i.title)
  const existingPosts = await listExistingPostSlugs(job.github_repo)

  const nicheDetail = (schema.niches ?? [])
    .slice(0, 4)
    .map((n) => `- ${n.name}: pain points: ${n.painPoints?.slice(0, 200) ?? ''} | value prop: ${n.valueProp?.slice(0, 200) ?? ''}`)
    .join('\n')

  const task = seed
    ? `The admin provided this base idea for a blog post:

"${seed}"

Extrapolate it into ${count} distinct, fully-formed post ideas for the firm's "Resources" section. Each must stay rooted in the base idea but take a different path: a sharper contrarian angle, a specific niche application (use the firm's actual niches below), a local tie-in, a seasonal/timely hook, or a practical framework/checklist treatment. Do not drift into unrelated topics.`
    : `Brainstorm ${count} blog post ideas for the firm's "Resources" section.`

  const prompt = `You are a content strategist for ${firmName}, a CPA firm in ${location}. ${task}

${buildBrandVoiceBlock(schema)}

SERVICES: ${services.join(', ') || 'Not specified'}
NICHES:
${nicheDetail || 'Not specified'}

${buildResearchBlock(research) ? `LIVE SEARCH RESEARCH (real questions and competing content — mine these for angles):\n${buildResearchBlock(research)}` : ''}

DO NOT DUPLICATE — these ideas/posts already exist (reject anything covering the same ground):
${[...existingTitles, ...existingPosts].map((t) => `- ${t}`).join('\n') || '- (none yet)'}

SCORING RUBRIC — score each idea 0-25 on each axis, sum to 0-100:
- stickiness: memorable, opinionated, specific to this firm's niches. Generic listicles ("Top 5 Tax Tips") score under 10.
- sharability: would a reader forward it to a peer or client? Seasonal hooks, quotable stats, named frameworks score high.
- localRelevance: ties naturally to ${location || 'the firm\'s market'} — local regulations, local industries, local economics.
- aioAnswerability: poses a clear question an AI search tool would surface, answerable in 2-3 crisp sentences, FAQ-friendly structure.

Score honestly — spread scores realistically, do not cluster everything at 80+.

EXTERNAL SOURCES: for each idea, suggest 1-3 authoritative URLs that would validate its claims. ONLY use domains you are confident exist: irs.gov, sba.gov, state department-of-revenue sites, aicpa-cima.com, bls.gov, federalreserve.gov, established financial publications. Use real, stable URLs (section landing pages over deep links).

Return ONLY a JSON array of ${count} objects:
[{ "title": "...", "angle": "one-line hook", "target_keyword": "...", "secondary_keywords": ["...", "..."], "rationale": "why this fits the firm and audience", "suggested_external_links": [{"url": "...", "title": "..."}], "score": 0-100, "score_breakdown": {"stickiness": 0-25, "sharability": 0-25, "localRelevance": 0-25, "aioAnswerability": 0-25} }]`

  const { text, usage } = await generateText({
    model: anthropic(IDEA_MODEL),
    system: 'You are an SEO and content strategist for CPA firms. Return JSON only, no prose.',
    prompt,
    maxOutputTokens: 4000,
  })

  checkTokenBudget('resource-ideas', contentJobId, usage?.inputTokens, 5000)
  await recordTokenUsage({
    contentJobId,
    sessionId,
    stage: 'idea',
    model: IDEA_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

  let ideas: GeneratedIdea[] = []
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) ideas = parsed as GeneratedIdea[]
  } catch {
    console.error('[resource-ideas] Failed to parse Claude response')
    return { created: 0 }
  }

  // Belt-and-suspenders dedupe by normalized title, then verify every
  // suggested external URL before it can ever reach a drafting prompt.
  const known = new Set(existingTitles.map((t) => t.toLowerCase().trim()))
  let created = 0
  for (const idea of ideas) {
    if (!idea?.title || typeof idea.title !== 'string') continue
    const norm = idea.title.toLowerCase().trim()
    if (known.has(norm)) continue
    known.add(norm)

    const verifiedLinks = await headCheckUrls(
      Array.isArray(idea.suggested_external_links) ? idea.suggested_external_links : []
    )

    const { error } = await supabase.from('resource_ideas').insert({
      content_job_id: contentJobId,
      session_id: sessionId,
      title: idea.title.trim(),
      angle: idea.angle ?? null,
      target_keyword: idea.target_keyword ?? null,
      secondary_keywords: asJson(Array.isArray(idea.secondary_keywords) ? idea.secondary_keywords : []),
      rationale: idea.rationale ?? null,
      score: typeof idea.score === 'number' ? Math.round(idea.score) : null,
      score_breakdown: asJson(idea.score_breakdown ?? {}),
      external_links: asJson(verifiedLinks),
      status: 'suggested',
    })
    if (error) {
      console.warn(`[resource-ideas] Insert failed for "${idea.title}": ${error.message}`)
      continue
    }
    created += 1
  }

  console.warn(`[resource-ideas] Created ${created} idea(s) for job ${contentJobId}`)
  return { created }
}
