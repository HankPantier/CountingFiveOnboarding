import type { SessionSchema } from '@/types/session-schema'

// The kinds of long-form content the resource pipeline can produce. Both the
// single-client workflow (ResourcesPanel → brainstorm → draft) and the batch
// workflow fan out through generateResourceDraft, which branches its prompt on
// this type. All types still land at content/posts/{slug}.md under /resources;
// the type only changes length/structure/voice + the frontmatter tag.
export type ContentType = 'blog' | 'thought-leadership' | 'article' | 'case-study'

export const DEFAULT_CONTENT_TYPE: ContentType = 'blog'

export interface ContentTypeSpec {
  // Short label for UI selectors and idea badges.
  uiLabel: string
  // Noun used in the drafting prompt's opening line ("You are writing a …").
  articleNoun: string
  // Inclusive word-count target [min, max].
  wordRange: [number, number]
  // schema.org type written to frontmatter when the model doesn't pick one.
  defaultSchemaMarkup: 'BlogPosting' | 'Article'
  // Case studies need real client data — the draft is blocked without it.
  requiresCaseData: boolean
}

export const CONTENT_TYPES: Record<ContentType, ContentTypeSpec> = {
  blog: {
    uiLabel: 'Blog',
    articleNoun: 'blog post',
    wordRange: [1200, 1800],
    defaultSchemaMarkup: 'BlogPosting',
    requiresCaseData: false,
  },
  article: {
    uiLabel: 'Article',
    articleNoun: 'in-depth article',
    wordRange: [1800, 2500],
    defaultSchemaMarkup: 'Article',
    requiresCaseData: false,
  },
  'thought-leadership': {
    uiLabel: 'Thought leadership',
    articleNoun: 'thought-leadership essay',
    wordRange: [1000, 1500],
    defaultSchemaMarkup: 'Article',
    requiresCaseData: false,
  },
  'case-study': {
    uiLabel: 'Case study',
    articleNoun: 'client case study',
    wordRange: [800, 1200],
    defaultSchemaMarkup: 'Article',
    requiresCaseData: true,
  },
}

// Selector options for the editor UIs, in presentation order.
export const CONTENT_TYPE_OPTIONS: Array<{ value: ContentType; label: string }> = (
  ['blog', 'article', 'thought-leadership', 'case-study'] as ContentType[]
).map((value) => ({ value, label: CONTENT_TYPES[value].uiLabel }))

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && value in CONTENT_TYPES
}

// Coerce any stored/incoming value to a valid ContentType, defaulting to blog.
export function asContentType(value: unknown): ContentType {
  return isContentType(value) ? value : DEFAULT_CONTENT_TYPE
}

// The per-type FORMAT RULES block injected into the drafting prompt's static
// (cached) prefix. It stays constant per (client, type) so every post in a
// batch — and the anti-slop retry of a single post — reuses it as a cache read.
export function buildFormatRules(type: ContentType, location: string): string {
  const [min, max] = CONTENT_TYPES[type].wordRange
  const words = `${min.toLocaleString()}–${max.toLocaleString()} words`
  const localMarket = location || "the firm's market"

  switch (type) {
    case 'article':
      return `FORMAT RULES:
- ${words} of plain markdown prose. Start with a paragraph, not a heading. Use ## for section headings (the page title renders separately — no H1); ### for sub-points within a long section.
- No HTML, no block-annotation comments — this renders through a plain markdown pipeline.
- This is a longer, researched explainer: go deep, cover the topic thoroughly and even-handedly, and support claims with the approved external sources where they genuinely fit. GFM tables/lists where data earns its place.
- End with a short "## Common Questions" section of 2-4 Q&As (bold question line, then answer paragraph) — this feeds AI-search answerability.
- Close with one clear call-to-action paragraph linking to /contact.
- Write for a human reader first: specific numbers, concrete scenarios, this firm's actual niches. Local relevance to ${localMarket} where natural.`

    case 'thought-leadership':
      return `FORMAT RULES:
- ${words} of plain markdown prose. Open with a clear point of view — a thesis or stance the firm is willing to stake out. Start with a paragraph, not a heading. Use ## sparingly (this reads as an essay, not a listicle; the page title renders separately — no H1).
- Write in an authoritative first-person-plural partner voice ("In our experience…", "We've seen…") — opinionated, grounded in the firm's real expertise and niches, never generic.
- No HTML, no block-annotation comments — this renders through a plain markdown pipeline. GFM tables only if they truly earn their place.
- Make an argument and back it: concrete scenarios, specific numbers, a defensible position — not a neutral overview.
- Close with a forward-looking call-to-action paragraph linking to /contact.
- Local relevance to ${localMarket} where natural.`

    case 'case-study':
      return `FORMAT RULES:
- ${words} of plain markdown prose. Start with a paragraph, not a heading. Use ## section headings for the narrative arc: Client & Context, The Challenge, Our Approach, Results.
- No HTML, no block-annotation comments — this renders through a plain markdown pipeline. A short GFM before/after metrics table is welcome ONLY if those numbers were supplied.
- Tell a real client story: who they were (anonymize the identity if the details require it), the problem they faced, what this firm actually did, and the concrete outcome.
- CRITICAL: use ONLY the client details, actions, and results provided in the firm context or the admin notes below. Never invent a client, a figure, a timeline, or a result. If a specific number was not supplied, describe the outcome qualitatively rather than fabricating one.
- Close with one clear call-to-action paragraph linking to /contact.
- Local relevance to ${localMarket} where natural.`

    case 'blog':
    default:
      return `FORMAT RULES:
- ${words} of plain markdown prose. Start with a paragraph, not a heading. Use ## for section headings (the page title renders separately — no H1).
- No HTML, no block-annotation comments — this renders through a plain markdown pipeline.
- GFM tables are allowed where data genuinely helps.
- If the topic suits it, end with a short "## Common Questions" section of 2-4 Q&As (bold question line, then answer paragraph) — this feeds AI-search answerability.
- Close with one clear call-to-action paragraph linking to /contact.
- Write for a human reader first: specific numbers, concrete scenarios, this firm's actual niches. Local relevance to ${localMarket} where natural.`
  }
}

// Case-study data gate: a case study may only be drafted when there is real
// material to ground it — a client success story on the MBP or operator-supplied
// details in the draft notes. Without either, the drafter must refuse rather
// than fabricate a client, per CLAUDE.md's anti-hallucination rules.
export function hasCaseStudyData(schema: SessionSchema, notes: string | null): boolean {
  const stories = schema.business?.clientSuccessStories ?? []
  const hasStory = stories.some((s) => typeof s === 'string' && s.trim().length > 0)
  const hasNotes = typeof notes === 'string' && notes.trim().length > 0
  return hasStory || hasNotes
}
