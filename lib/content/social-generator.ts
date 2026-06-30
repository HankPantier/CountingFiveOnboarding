import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildBrandVoiceBlock, buildFirmContext, firmLocation } from './brand-voice'
import { ANTI_SLOP_RULES } from './anti-slop-validator'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { DRAFT_BRANCH, readFile, writeFile, FileNotFoundError } from '@/lib/github/repo-files'
import { splitFile } from '@/lib/editor/frontmatter'
import type { SessionSchema } from '@/types/session-schema'

const SOCIAL_MODEL = 'claude-sonnet-5'

export type SocialJson = {
  linkedin: string
  twitter: string
  instagram: {
    caption: string
    hashtags: string[]
    image_concept: string
  }
}

type SocialInput = {
  schema: SessionSchema
  title: string
  excerpt: string
  answerBlock: string
  body: string
  canonicalUrl: string
  contentJobId: string
  sessionId: string
  slug: string
}

// One Sonnet call producing all three platform suggestions. Pure with respect
// to the repo — used inline by the draft generator (same commit) and by the
// on-demand backfill route. Returns null on unparseable output (non-fatal for
// callers).
export async function generateSocialJson(input: SocialInput): Promise<SocialJson | null> {
  const loc = firmLocation(input.schema)
  const prompt = `You are writing social media promotion copy for a blog post by ${input.schema.business?.name ?? 'a CPA firm'}${loc ? ` (${loc})` : ''}.

${buildBrandVoiceBlock(input.schema)}

${buildFirmContext(input.schema)}

THE POST BEING PROMOTED:
Title: ${input.title}
URL: ${input.canonicalUrl}
Excerpt: ${input.excerpt}
Core answer: ${input.answerBlock}

POST BODY (for specifics — pull real numbers and claims from here):
${truncateToTokenBudget(input.body, 2000)}

Write three platform-native promotions. Each must lead with a specific claim, number, or scenario from the post — never a generic teaser.

Return ONLY a JSON object:
{
  "linkedin": "120-200 words. Hook line, one concrete insight from the post, why it matters to the target client, CTA line with the URL. 3-5 hashtags on the final line.",
  "twitter": "A single post of 260 characters or less INCLUDING the URL. One punchy claim or stat. No hashtag stuffing — at most 2.",
  "instagram": {
    "caption": "2-4 short paragraphs, conversational but on-brand, ends with a CTA mentioning the link in bio",
    "hashtags": ["up to 10, niche + local, no # prefix"],
    "image_concept": "one line describing the visual to post (may reference the post's header image)"
  }
}

${ANTI_SLOP_RULES}`

  const { text, usage } = await generateText({
    model: anthropic(SOCIAL_MODEL),
    prompt,
    maxOutputTokens: 1500,
  })

  checkTokenBudget('social', input.slug, usage?.inputTokens, 5000)
  await recordTokenUsage({
    task: 'content',
    contentJobId: input.contentJobId,
    sessionId: input.sessionId,
    stage: 'social',
    pageUrl: input.slug,
    model: SOCIAL_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (
      typeof parsed?.linkedin !== 'string' ||
      typeof parsed?.twitter !== 'string' ||
      typeof parsed?.instagram?.caption !== 'string'
    ) {
      return null
    }
    return {
      linkedin: parsed.linkedin,
      twitter: parsed.twitter,
      instagram: {
        caption: parsed.instagram.caption,
        hashtags: Array.isArray(parsed.instagram.hashtags) ? parsed.instagram.hashtags : [],
        image_concept: parsed.instagram.image_concept ?? '',
      },
    }
  } catch {
    console.error(`[social-gen] Failed to parse JSON for "${input.title}"`)
    return null
  }
}

export function buildSocialMarkdown(args: {
  title: string
  slug: string
  social: SocialJson
}): string {
  const { social } = args
  const hashtags = social.instagram.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')
  return `---
title: Social suggestions — ${args.title.replace(/\n/g, ' ')}
post: /resources/${args.slug}
---
## LinkedIn

${social.linkedin.trim()}

## Twitter / X

${social.twitter.trim()}

## Instagram

${social.instagram.caption.trim()}

${hashtags}

*Image concept: ${social.instagram.image_concept.trim() || 'use the post header image'}*
`
}

export function socialPathForSlug(slug: string): string {
  return `content/social/${slug}.md`
}

// On-demand backfill: read the post as it currently exists on the draft
// branch (admin edits included), generate suggestions, commit the social
// file, and record social_path on the idea.
export async function generateSocialContent(
  ideaId: string
): Promise<{ status: 'complete' | 'error' | 'skipped'; error?: string }> {
  const supabase = createServerClient()

  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('id, content_job_id, session_id, title, slug, status, social_path')
    .eq('id', ideaId)
    .single()
  if (!idea) return { status: 'error', error: 'Idea not found' }
  if (idea.status !== 'drafted' || !idea.slug) {
    return { status: 'error', error: 'Idea has no drafted post' }
  }

  // Atomic claim — only one worker may generate per idea at a time
  // (same .neq pattern as generateSinglePage). updated_at marks when the
  // in-flight run started so the stuck-job sweep can reset it.
  const { data: locked } = await supabase
    .from('resource_ideas')
    .update({ social_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', ideaId)
    .neq('social_status', 'running')
    .select('id')
  if (!locked?.length) {
    return { status: 'skipped', error: 'Social generation already running' }
  }

  const fail = async (message: string) => {
    await supabase
      .from('resource_ideas')
      .update({ social_status: 'error', updated_at: new Date().toISOString() })
      .eq('id', ideaId)
    return { status: 'error' as const, error: message }
  }

  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo')
    .eq('id', idea.content_job_id)
    .single()
  if (!job?.github_repo) return await fail('Repo not linked')

  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', idea.session_id)
    .single()
  if (!session) return await fail('Session not found')

  try {
    let post
    try {
      post = await readFile(job.github_repo, `content/posts/${idea.slug}.md`, DRAFT_BRANCH)
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        return await fail('Post file missing from draft branch')
      }
      throw err
    }
    const parsed = splitFile(post.content)
    const fields = parsed.frontmatter?.fields ?? {}
    const origin = session.website_url.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://')

    const social = await generateSocialJson({
      schema: (session.schema_data ?? {}) as SessionSchema,
      title: fields['title'] ?? idea.title,
      excerpt: fields['excerpt'] ?? '',
      answerBlock: fields['answer_block'] ?? '',
      body: parsed.body,
      canonicalUrl: fields['canonical_url'] ?? `${origin}/resources/${idea.slug}`,
      contentJobId: idea.content_job_id,
      sessionId: idea.session_id,
      slug: idea.slug,
    })
    if (!social) return await fail('Social generation returned unparseable output')

    const path = socialPathForSlug(idea.slug)
    const markdown = buildSocialMarkdown({ title: fields['title'] ?? idea.title, slug: idea.slug, social })

    // Overwrite-friendly: pass the current sha when the file already exists.
    let existingSha: string | undefined
    try {
      existingSha = (await readFile(job.github_repo, path, DRAFT_BRANCH)).sha
    } catch (err) {
      if (!(err instanceof FileNotFoundError)) throw err
    }
    await writeFile(
      job.github_repo,
      path,
      markdown,
      DRAFT_BRANCH,
      `Add social suggestions: ${fields['title'] ?? idea.title}`,
      existingSha ? { expectedSha: existingSha } : {}
    )

    await supabase
      .from('resource_ideas')
      .update({
        social_path: path,
        social_status: 'complete',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ideaId)

    console.warn(`[social-gen] Complete: ${path}`)
    return { status: 'complete' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[social-gen] Error on "${idea.title}":`, err)
    return await fail(message)
  }
}
