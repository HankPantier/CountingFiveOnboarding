import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildBrandVoiceBlock, firmLocation } from './brand-voice'
import { validateContent, ANTI_SLOP_RULES } from './anti-slop-validator'
import { checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { deriveImageStyleSuffix } from './visual-style-derivation'
import { resolveStockPhotos, type ImageRef } from './stock-photo-resolver'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  pushEntriesToBranch,
  readFile,
  FileNotFoundError,
} from '@/lib/github/repo-files'
import { buildInternalLinkTargets, type InternalLinkTarget } from './internal-link-targets'
import { insertReverseLinks } from './reverse-linker'
import { asJson } from '@/lib/supabase/json-typed'
import { generateSocialJson, buildSocialMarkdown, socialPathForSlug } from './social-generator'
import { OFF_BRAND_MARKER } from './brand-fit'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import type { NavJson } from '@/types/nav-json'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { ExternalLink } from './link-checker'

const DRAFT_MODEL = 'claude-sonnet-4-6'

type DraftFrontmatter = {
  title: string
  excerpt: string
  meta_title: string
  meta_description: string
  target_keyword: string
  secondary_keywords: string[]
  answer_block: string
  schema_markup: string
  tags: string[]
  hero_image: string | null
  hero_image_query: string | null
  image_alt: string | null
}

type DraftResult = { body: string; frontmatter: DraftFrontmatter }

function kebabSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

// Admin writer-notes block. The OFF_BRAND_MARKER first line means the admin
// confirmed a divergence from the documented brand voice for this post.
function buildNotesBlock(notes: string): string {
  if (notes.startsWith(OFF_BRAND_MARKER)) {
    const rest = notes.slice(OFF_BRAND_MARKER.length).trim()
    return `ADMIN NOTES FOR THIS POST (follow these; they take precedence over the angle — the admin explicitly approved this direction even where it diverges from the brand voice below; keep factual rigor and the anti-slop rules):
${rest}`
  }
  return `ADMIN NOTES FOR THIS POST (follow these; they take precedence over the angle):
${notes}`
}

async function generateDraftContent(args: {
  idea: { title: string; angle: string | null; target_keyword: string | null; rationale: string | null }
  notes: string | null
  secondaryKeywords: string[]
  externalLinks: ExternalLink[]
  internalTargets: InternalLinkTarget[]
  schema: SessionSchema
  contentJobId: string
  sessionId: string
  flaggedPhrases?: string[]
}): Promise<DraftResult | null> {
  const { idea, schema } = args
  const firmName = schema.business?.name ?? 'the firm'
  const location = firmLocation(schema)

  const retryNote = args.flaggedPhrases?.length
    ? `\n\nIMPORTANT: A previous draft was flagged for these issues — fix all of them: ${args.flaggedPhrases.join(' | ')}`
    : ''

  const externalBlock = args.externalLinks.length
    ? `APPROVED EXTERNAL SOURCES — you may cite ONLY these URLs, verbatim, as markdown links. Do not invent, modify, or cite any other external URL. If none fit a claim, cite none:\n${args.externalLinks.map((l) => `- ${l.url}${l.title ? ` — ${l.title}` : ''}`).join('\n')}`
    : 'EXTERNAL SOURCES: none approved — do NOT include any external URL in the body.'

  const prompt = `You are writing a blog post for the Resources section of ${firmName}, a CPA firm in ${location}.

${buildBrandVoiceBlock(schema)}

POST TO WRITE:
Title: ${idea.title}
Angle: ${idea.angle ?? ''}
Why it fits: ${idea.rationale ?? ''}

${args.notes ? buildNotesBlock(args.notes) : ''}

KEYWORD TARGET:
Primary: ${idea.target_keyword ?? idea.title.toLowerCase()}
Secondary: ${args.secondaryKeywords.join(', ')}

${externalBlock}

INTERNAL LINK TARGETS — link to these site pages and existing posts where genuinely relevant (site-relative markdown links, natural anchor text drawn from the topic, 2-4 links total, never force one). Pick targets whose subject actually overlaps what you're writing:
${args.internalTargets
  .map((t) => {
    const kw = t.keyword ? ` — keyword: ${t.keyword}` : ''
    const about = t.about ? ` — about: ${t.about}` : ''
    return `- ${t.url} — "${t.title}"${kw}${about}`
  })
  .join('\n') || '- (none yet)'}

FORMAT RULES:
- 1,200–1,800 words of plain markdown prose. Start with a paragraph, not a heading. Use ## for section headings (the page title renders separately — no H1).
- No HTML, no block-annotation comments — this renders through a plain markdown pipeline.
- GFM tables are allowed where data genuinely helps.
- If the topic suits it, end with a short "## Common Questions" section of 2-4 Q&As (bold question line, then answer paragraph) — this feeds AI-search answerability.
- Close with one clear call-to-action paragraph linking to /contact.
- Write for a human reader first: specific numbers, concrete scenarios, this firm's actual niches. Local relevance to ${location || 'the firm\'s market'} where natural.

OUTPUT: Return a JSON object:
{
  "body": "the full post markdown",
  "frontmatter": {
    "title": "final post title (may refine the working title)",
    "excerpt": "1-2 sentence listing-card excerpt",
    "meta_title": "50-60 chars, contains primary keyword",
    "meta_description": "150-160 chars, compelling + keyword",
    "target_keyword": "...",
    "secondary_keywords": ["..."],
    "answer_block": "2-3 sentences answering the post's core question directly",
    "schema_markup": "BlogPosting" | "Article" | "FAQPage",
    "tags": ["2-4 short topic tags"],
    "hero_image": "kebab-case-filename.jpg — ALWAYS provide one; every post gets a header image",
    "hero_image_query": "3-8 word SUBJECT-only Pexels query (people, setting, activity — no style words) — ALWAYS provide one",
    "image_alt": "descriptive alt text for the hero image"
  }
}

${ANTI_SLOP_RULES}${retryNote}`

  const { text, usage } = await generateText({
    model: anthropic(DRAFT_MODEL),
    prompt,
    maxOutputTokens: 4000,
  })

  console.warn(
    `[resource-draft] idea="${idea.title}" input=${usage?.inputTokens ?? '?'} output=${usage?.outputTokens ?? '?'}`
  )
  checkTokenBudget('resource-draft', idea.title, usage?.inputTokens, 5000)
  await recordTokenUsage({
    contentJobId: args.contentJobId,
    sessionId: args.sessionId,
    stage: 'resource',
    pageUrl: kebabSlug(idea.title),
    model: DRAFT_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!parsed?.body || !parsed?.frontmatter?.title) return null
    const fm = parsed.frontmatter
    return {
      body: parsed.body,
      frontmatter: {
        title: fm.title,
        excerpt: fm.excerpt ?? '',
        meta_title: fm.meta_title ?? fm.title,
        meta_description: fm.meta_description ?? '',
        target_keyword: fm.target_keyword ?? idea.target_keyword ?? '',
        secondary_keywords: Array.isArray(fm.secondary_keywords) ? fm.secondary_keywords : [],
        answer_block: fm.answer_block ?? '',
        schema_markup: fm.schema_markup ?? 'BlogPosting',
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        hero_image: typeof fm.hero_image === 'string' && fm.hero_image.trim() ? fm.hero_image.trim() : null,
        hero_image_query:
          typeof fm.hero_image_query === 'string' && fm.hero_image_query.trim()
            ? fm.hero_image_query.trim()
            : null,
        image_alt: typeof fm.image_alt === 'string' && fm.image_alt.trim() ? fm.image_alt.trim() : null,
      },
    }
  } catch {
    console.error(`[resource-draft] Failed to parse JSON for "${idea.title}"`)
    return null
  }
}

// Citation guard: strip any absolute URL that isn't in the approved list.
// The link itself is removed but its anchor text is preserved, so a stray
// hallucinated citation degrades to plain prose instead of a dead link.
function stripUnapprovedExternalLinks(body: string, approved: ExternalLink[]): string {
  const allowed = new Set(approved.map((l) => l.url.replace(/\/$/, '')))
  return body.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, anchor: string, url: string) => {
    if (allowed.has(url.replace(/\/$/, ''))) return full
    console.warn(`[resource-draft] Stripped unapproved external URL: ${url}`)
    return anchor
  })
}

function escapeFrontmatterValue(value: string): string {
  return value.replace(/\n/g, ' ').trim()
}

function buildPostMarkdown(args: {
  fm: DraftFrontmatter
  body: string
  slug: string
  date: string
  author: string | null
  canonicalUrl: string
  heroImage: string | null
}): string {
  const { fm } = args
  const lines = [
    '---',
    `title: ${escapeFrontmatterValue(fm.title)}`,
    `slug: ${args.slug}`,
    `date: ${args.date}`,
    ...(args.author ? [`author: ${escapeFrontmatterValue(args.author)}`] : []),
    `excerpt: ${escapeFrontmatterValue(fm.excerpt)}`,
    ...(args.heroImage ? [`image: ${args.heroImage}`] : []),
    ...(args.heroImage && fm.image_alt ? [`image_alt: ${escapeFrontmatterValue(fm.image_alt)}`] : []),
    `tags: [${fm.tags.map((t) => escapeFrontmatterValue(t)).join(', ')}]`,
    `meta_title: ${escapeFrontmatterValue(fm.meta_title)}`,
    `meta_description: ${escapeFrontmatterValue(fm.meta_description)}`,
    `target_keyword: ${escapeFrontmatterValue(fm.target_keyword)}`,
    `secondary_keywords: [${fm.secondary_keywords.map((k) => escapeFrontmatterValue(k)).join(', ')}]`,
    `canonical_url: ${args.canonicalUrl}`,
    `schema_markup: ${escapeFrontmatterValue(fm.schema_markup)}`,
    `answer_block: ${escapeFrontmatterValue(fm.answer_block)}`,
    '---',
    '',
  ]
  return lines.join('\n') + args.body.trim() + '\n'
}

// Self-register the Resources section in the site nav the first time a post
// is drafted. Packaged repos ship a nav.json built from the page sitemap, so
// /resources isn't there until a post exists to justify it. No-op when any
// top-level entry already points at /resources (admins may have customized).
async function updatedNavJson(githubRepo: string): Promise<{ path: string; content: string } | null> {
  let raw: string
  try {
    const blob = await readFile(githubRepo, 'content/nav.json', DRAFT_BRANCH)
    raw = blob.content
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) {
      console.warn('[resource-draft] nav.json read failed:', err)
    }
    return null
  }
  let nav: NavJson
  try {
    nav = parseNavJson(raw)
  } catch (err) {
    console.warn('[resource-draft] nav.json unparseable, leaving as-is:', err)
    return null
  }
  if (nav.primary.some((item) => item.url.replace(/\/$/, '') === '/resources')) return null

  const entry = { label: 'Resources', url: '/resources' }
  const contactIdx = nav.primary.findIndex((item) => item.url.replace(/\/$/, '') === '/contact')
  if (contactIdx >= 0) {
    nav.primary.splice(contactIdx, 0, entry)
  } else {
    nav.primary.push(entry)
  }
  return { path: 'content/nav.json', content: serializeNavJson(nav) }
}

// Append (or update) this post's entry in the static public/llms.txt that
// packaging pushed to the repo. The template serves it as a static file, so
// drafting is the only moment posts can self-register. Missing file → skip.
async function updatedLlmsTxt(
  githubRepo: string,
  slug: string,
  title: string,
  description: string
): Promise<{ path: string; content: string } | null> {
  let existing: string
  try {
    const blob = await readFile(githubRepo, 'public/llms.txt', DRAFT_BRANCH)
    existing = blob.content
  } catch (err) {
    if (err instanceof FileNotFoundError) return null
    console.warn('[resource-draft] llms.txt read failed:', err)
    return null
  }

  const entry = `- [${title}](/resources/${slug}): ${description.slice(0, 80)}`
  if (existing.includes(`(/resources/${slug})`)) return null

  let next: string
  if (/^## Resources$/m.test(existing)) {
    next = existing.replace(/^## Resources$/m, `## Resources\n\n${entry}`).replace(/\n{3,}/g, '\n\n')
  } else {
    next = `${existing.trimEnd()}\n\n## Resources\n\n${entry}\n`
  }
  return { path: 'public/llms.txt', content: next }
}

export async function generateResourceDraft(
  ideaId: string
): Promise<{ status: 'complete' | 'error' | 'skipped'; slug?: string; error?: string }> {
  const supabase = createServerClient()

  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('id, content_job_id, session_id, title, angle, target_keyword, secondary_keywords, rationale, external_links, status, draft_notes')
    .eq('id', ideaId)
    .single()
  if (!idea) return { status: 'error', error: 'Idea not found' }
  if (idea.status === 'dismissed') return { status: 'error', error: 'Idea is dismissed' }

  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo, palette')
    .eq('id', idea.content_job_id)
    .single()
  if (!job?.github_repo) return { status: 'error', error: 'Repo not linked' }

  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', idea.session_id)
    .single()
  if (!session) return { status: 'error', error: 'Session not found' }

  // Atomic lock — same pattern as generated_pages.generation_status. A second
  // caller racing on the same idea gets zero rows back and skips.
  const { data: locked } = await supabase
    .from('resource_ideas')
    .update({ draft_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', ideaId)
    .neq('draft_status', 'running')
    .select('id')
  if (!locked?.length) {
    return { status: 'skipped', error: 'Another worker is already drafting this idea' }
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const externalLinks = (idea.external_links as ExternalLink[]) ?? []
  const secondaryKeywords = (idea.secondary_keywords as string[]) ?? []

  try {
    await ensureDraftBranch(job.github_repo)
    const { targets, postSlugs } = await buildInternalLinkTargets(job.github_repo)

    // Slug: derive from the idea title, dodge collisions with existing posts.
    let slug = kebabSlug(idea.title) || `post-${ideaId.slice(0, 8)}`
    const taken = new Set(postSlugs)
    let suffix = 2
    while (taken.has(slug)) {
      slug = `${kebabSlug(idea.title)}-${suffix}`
      suffix += 1
    }

    let result = await generateDraftContent({
      idea,
      notes: idea.draft_notes,
      secondaryKeywords,
      externalLinks,
      internalTargets: targets,
      schema,
      contentJobId: idea.content_job_id,
      sessionId: idea.session_id,
    })
    if (!result) throw new Error('Draft generation returned unparseable output')

    const validation = validateContent(result.body)
    if (!validation.passed) {
      console.warn(
        `[resource-draft] Anti-slop flagged "${idea.title}": ${validation.flagged.join(' | ')} — retrying`
      )
      const retry = await generateDraftContent({
        idea,
        notes: idea.draft_notes,
        secondaryKeywords,
        externalLinks,
        internalTargets: targets,
        schema,
        contentJobId: idea.content_job_id,
        sessionId: idea.session_id,
        flaggedPhrases: validation.flagged,
      })
      if (retry) result = retry
    }

    result.body = stripUnapprovedExternalLinks(result.body, externalLinks)

    // Hero image via Pexels — non-fatal. Resolution persists an assets row +
    // storage object; we then download the bytes to push into the repo commit.
    const entries: Array<{ path: string; content: string | Buffer }> = []
    let heroImage: string | null = null
    const fm = result.frontmatter
    // Every post gets a header image: synthesize a ref when Claude omits one.
    if (!fm.hero_image || !fm.hero_image_query) {
      fm.hero_image = `${slug.slice(0, 48).replace(/-+$/, '')}-header.jpg`
      fm.hero_image_query = (idea.target_keyword ?? idea.title)
        .replace(/[^a-zA-Z0-9 ]+/g, ' ')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ')
    }
    if (fm.hero_image && fm.hero_image_query) {
      const palette = (job.palette ?? null) as PaletteData | null
      const styleSuffix = deriveImageStyleSuffix(palette, schema.brand)
      const { data: existingAssets } = await supabase
        .from('assets')
        .select('*')
        .eq('session_id', idea.session_id)
      const imageRefs: ImageRef[] = [
        { pageUrl: `/resources/${slug}`, filename: fm.hero_image, subjectQuery: fm.hero_image_query, source: 'hero' },
      ]
      const resolved = await resolveStockPhotos(
        {
          sessionId: idea.session_id,
          apiKey: process.env.PEXELS_API_KEY ?? '',
          styleSuffix,
          existingAssets: existingAssets ?? [],
          imageRefs,
        },
        supabase
      )
      if (resolved.length > 0) {
        const { data: bytes, error: dlErr } = await supabase.storage
          .from('session-assets')
          .download(`sessions/${idea.session_id}/${fm.hero_image}`)
        if (bytes && !dlErr) {
          entries.push({
            path: `public/content-assets/${fm.hero_image}`,
            content: Buffer.from(await bytes.arrayBuffer()),
          })
          heroImage = fm.hero_image
        } else {
          console.warn(`[resource-draft] Hero download failed for ${fm.hero_image}: ${dlErr?.message}`)
        }
      }
    }

    const date = new Date().toISOString().slice(0, 10)
    const author = schema.team?.[0]?.name ?? null
    const origin = session.website_url.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://')
    const canonicalUrl = `${origin}/resources/${slug}`

    const postMarkdown = buildPostMarkdown({
      fm,
      body: result.body,
      slug,
      date,
      author,
      canonicalUrl,
      heroImage,
    })
    entries.push({ path: `content/posts/${slug}.md`, content: postMarkdown })

    const llms = await updatedLlmsTxt(job.github_repo, slug, fm.title, fm.meta_description || fm.excerpt)
    if (llms) entries.push(llms)

    const nav = await updatedNavJson(job.github_repo)
    if (nav) entries.push(nav)

    // Social suggestions ride in the same atomic commit. Non-fatal: a parse
    // failure just means the admin backfills via the panel's button.
    let socialPath: string | null = null
    try {
      const social = await generateSocialJson({
        schema,
        title: fm.title,
        excerpt: fm.excerpt,
        answerBlock: fm.answer_block,
        body: result.body,
        canonicalUrl,
        contentJobId: idea.content_job_id,
        sessionId: idea.session_id,
        slug,
      })
      if (social) {
        socialPath = socialPathForSlug(slug)
        entries.push({
          path: socialPath,
          content: buildSocialMarkdown({ title: fm.title, slug, social }),
        })
      }
    } catch (err) {
      console.warn(`[resource-draft] Social generation failed for ${slug}:`, err)
    }

    const { commitSha } = await pushEntriesToBranch(
      job.github_repo,
      DRAFT_BRANCH,
      entries,
      `Draft resource post: ${fm.title}`,
      {}
    )

    await supabase
      .from('resource_ideas')
      .update({
        status: 'drafted',
        draft_status: 'complete',
        slug,
        draft_path: `content/posts/${slug}.md`,
        draft_commit_sha: commitSha,
        draft_error: null,
        social_path: socialPath,
        // Clear any prior run's audit so a re-draft starts from a clean slate;
        // the reverse-link pass below repopulates it for the current slug.
        reverse_links: asJson([]),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ideaId)

    console.warn(`[resource-draft] Complete: "${fm.title}" → content/posts/${slug}.md (${commitSha.slice(0, 7)})`)

    // Reverse-link pass: link the most relevant existing posts back to the
    // new one, as a second commit on the same draft branch (one reviewable
    // diff). Runs AFTER the row is marked complete, by design: the draft is
    // already published, so this is failure-isolated — a thrown error (incl. a
    // GitHub fast-forward conflict if a re-trigger raced us) is swallowed below
    // and never regresses the published draft. Trade-off: it runs outside the
    // draft_status lock, so a concurrent re-draft could double-run; worst case
    // is a duplicate/missing back-link, not corruption.
    // Lifecycle note: links point at a post we just created, so they're valid
    // at insertion. If that post is later deleted manually in GitHub the
    // inbound links become orphaned — there is no app-level post-delete flow to
    // hook cleanup onto, so this is an accepted, documented limitation.
    try {
      const { results, entries: reverseEntries } = await insertReverseLinks({
        githubRepo: job.github_repo,
        newPost: {
          slug,
          title: fm.title,
          keyword: fm.target_keyword || null,
          tags: fm.tags,
          excerpt: fm.excerpt,
          answerBlock: fm.answer_block,
        },
        contentJobId: idea.content_job_id,
        sessionId: idea.session_id,
      })
      if (reverseEntries.length > 0) {
        await pushEntriesToBranch(
          job.github_repo,
          DRAFT_BRANCH,
          reverseEntries,
          `Add reverse links to: ${fm.title}`,
          {}
        )
        await supabase
          .from('resource_ideas')
          .update({ reverse_links: asJson(results), updated_at: new Date().toISOString() })
          .eq('id', ideaId)
        console.warn(`[reverse-link] Linked ${results.length} existing post(s) to ${slug}`)
      }
    } catch (err) {
      console.warn(`[reverse-link] Pass failed for ${slug} (draft already published):`, err)
    }

    return { status: 'complete', slug }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[resource-draft] Error on "${idea.title}":`, err)
    await supabase
      .from('resource_ideas')
      .update({ draft_status: 'error', draft_error: message, updated_at: new Date().toISOString() })
      .eq('id', ideaId)
    return { status: 'error', error: message }
  }
}
