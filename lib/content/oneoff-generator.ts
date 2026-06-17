import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildBrandVoiceBlock, buildFirmContext, firmLocation } from './brand-voice'
import { ANTI_SLOP_RULES } from './anti-slop-validator'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { OFF_BRAND_MARKER } from './brand-fit'
import { DRAFT_BRANCH, listTree, readFile } from '@/lib/github/repo-files'
import { asJson } from '@/lib/supabase/json-typed'
import type { SessionSchema } from '@/types/session-schema'

const RESOLVE_MODEL = 'claude-haiku-4-5-20251001'
const ONEOFF_MODEL = 'claude-sonnet-4-6'

export type OneOffContext = { pageUrl?: string; teamMemberName?: string }
export type OneOffOption = { label: string; text: string }

function pageUrlFromFilename(path: string): string {
  const slug = path.slice('content/pages/'.length, -3)
  return slug === 'home' ? '/' : `/${slug.replace(/--/g, '/')}`
}

// Cheap pass: figure out which page and/or team member the admin's free-text
// prompt refers to, so the main generation can be grounded in the actual
// page content / member bio instead of the whole schema. Null on any failure.
async function resolveReferences(args: {
  prompt: string
  pageUrls: string[]
  teamNames: string[]
  contentJobId: string
  sessionId: string
}): Promise<OneOffContext> {
  if (args.pageUrls.length === 0 && args.teamNames.length === 0) return {}
  try {
    const { text, usage } = await generateText({
      model: anthropic(RESOLVE_MODEL),
      system: 'You resolve references. Return JSON only, no prose.',
      prompt: `An admin asked a content engine: "${args.prompt}"

Which of these (if any) does the request refer to?

PAGES: ${args.pageUrls.join(', ') || '(none)'}
TEAM MEMBERS: ${args.teamNames.join(', ') || '(none)'}

Return JSON: { "pageUrl": "exact url from the list or null", "teamMemberName": "exact name from the list or null" }`,
      maxOutputTokens: 100,
    })
    await recordTokenUsage({
      task: 'content',
      contentJobId: args.contentJobId,
      sessionId: args.sessionId,
      stage: 'oneoff',
      pageUrl: 'resolve',
      model: RESOLVE_MODEL,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    })
    const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    const out: OneOffContext = {}
    if (typeof parsed?.pageUrl === 'string' && args.pageUrls.includes(parsed.pageUrl)) {
      out.pageUrl = parsed.pageUrl
    }
    if (typeof parsed?.teamMemberName === 'string' && args.teamNames.includes(parsed.teamMemberName)) {
      out.teamMemberName = parsed.teamMemberName
    }
    return out
  } catch (err) {
    console.warn('[oneoff] Reference resolution failed (continuing without):', err)
    return {}
  }
}

export async function generateOneOff(
  generationId: string
): Promise<{ status: 'complete' | 'error' | 'skipped'; error?: string }> {
  const supabase = createServerClient()

  const { data: row } = await supabase
    .from('oneoff_generations')
    .select('id, content_job_id, session_id, prompt')
    .eq('id', generationId)
    .single()
  if (!row) return { status: 'error', error: 'Generation not found' }

  // Atomic claim (pending → running, .neq guard per CLAUDE.md pipeline
  // rule) so a sweep/retry overlap can't double-run the same row.
  const { data: locked } = await supabase
    .from('oneoff_generations')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', generationId)
    .neq('status', 'running')
    .select('id')
  if (!locked?.length) {
    return { status: 'skipped', error: 'Generation already running' }
  }

  const fail = async (message: string) => {
    await supabase
      .from('oneoff_generations')
      .update({ status: 'error', error: message, updated_at: new Date().toISOString() })
      .eq('id', generationId)
    return { status: 'error' as const, error: message }
  }

  try {
    const { data: job } = await supabase
      .from('content_jobs')
      .select('github_repo')
      .eq('id', row.content_job_id)
      .single()
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', row.session_id)
      .single()
    if (!job?.github_repo || !session) return await fail('Job or session not found')

    const schema = (session.schema_data ?? {}) as SessionSchema
    const offBrandApproved = row.prompt.startsWith(OFF_BRAND_MARKER)
    const prompt = offBrandApproved
      ? row.prompt.slice(OFF_BRAND_MARKER.length).trim()
      : row.prompt

    // Resolve which page / team member the ask refers to.
    let pageUrls: string[] = []
    try {
      const entries = await listTree(job.github_repo, DRAFT_BRANCH, 'content/pages/')
      pageUrls = entries
        .filter((e) => e.type === 'blob' && e.path.endsWith('.md'))
        .map((e) => pageUrlFromFilename(e.path))
    } catch (err) {
      console.warn('[oneoff] Page list failed (continuing without):', err)
    }
    const teamNames = (schema.team ?? []).map((m) => m.name).filter(Boolean)
    const context = await resolveReferences({
      prompt,
      pageUrls,
      teamNames,
      contentJobId: row.content_job_id,
      sessionId: row.session_id,
    })

    // Targeted context blocks.
    let pageBlock = ''
    if (context.pageUrl) {
      try {
        const filename = context.pageUrl === '/' ? 'home' : context.pageUrl.slice(1).replace(/\//g, '--')
        const file = await readFile(job.github_repo, `content/pages/${filename}.md`, DRAFT_BRANCH)
        pageBlock = `THE PAGE REFERENCED (${context.pageUrl}) — current content:\n${truncateToTokenBudget(file.content, 1500)}`
      } catch (err) {
        console.warn(`[oneoff] Page read failed for ${context.pageUrl}:`, err)
      }
    }
    let memberBlock = ''
    if (context.teamMemberName) {
      const member = (schema.team ?? []).find((m) => m.name === context.teamMemberName)
      if (member) {
        memberBlock = `THE TEAM MEMBER REFERENCED:\n${JSON.stringify(member, null, 2)}`
      }
    }

    const genPrompt = `You are producing one-off copy for ${schema.business?.name ?? 'a CPA firm'} in ${firmLocation(schema)}.

THE ADMIN'S REQUEST:
"${prompt}"
${offBrandApproved ? '\n(The admin explicitly approved this direction even where it diverges from the brand voice below — follow the request\'s direction; keep factual rigor.)\n' : ''}
${buildBrandVoiceBlock(schema)}

${buildFirmContext(schema)}

${memberBlock}

${pageBlock}

Produce EXACTLY 3 distinct options answering the request. Each must be fully usable standalone and format-appropriate to the ask (a LinkedIn bio reads like a LinkedIn bio; a hero title is under 12 words; a Google Business description fits its limits). Take three different angles — e.g. straightforward, benefit-led, distinctive — and ground every claim in the real details above. Never invent credentials, numbers, or history.

Return ONLY a JSON array:
[{ "label": "2-4 word angle descriptor", "text": "the option" }]

${ANTI_SLOP_RULES}`

    const { text, usage } = await generateText({
      model: anthropic(ONEOFF_MODEL),
      prompt: genPrompt,
      maxOutputTokens: 1500,
    })
    checkTokenBudget('oneoff', generationId, usage?.inputTokens, 5000)
    await recordTokenUsage({
      task: 'content',
      contentJobId: row.content_job_id,
      sessionId: row.session_id,
      stage: 'oneoff',
      model: ONEOFF_MODEL,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    })

    let options: OneOffOption[]
    try {
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
      if (!Array.isArray(parsed)) throw new Error('not an array')
      options = parsed
        .filter((o) => o && typeof o.text === 'string' && o.text.trim())
        .map((o) => ({ label: typeof o.label === 'string' ? o.label : 'Option', text: o.text.trim() }))
      if (options.length === 0) throw new Error('no options')
    } catch {
      return await fail('Generation returned unparseable output — try again')
    }

    await supabase
      .from('oneoff_generations')
      .update({
        options: asJson(options),
        context: asJson(context),
        status: 'complete',
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', generationId)

    console.warn(`[oneoff] Complete: ${options.length} option(s) for "${prompt.slice(0, 60)}"`)
    return { status: 'complete' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[oneoff] Error:', err)
    return await fail(message)
  }
}
