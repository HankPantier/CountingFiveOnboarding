# Content Assembly Spec

**Version:** 1.0  
**Status:** Draft  
**Companion docs:** `block-annotation-spec.md` (annotation format), `component-library-build-spec.md` (block interfaces)

---

## Overview

The assembly system transforms a generated `.md` content file into a fully typed `PageManifest` that the rendering layer consumes. It runs server-side, at build time or request time depending on deployment strategy.

The pipeline has three stages:

```
.md file
  → Stage 1: Parse frontmatter + split sections
  → Stage 2: Extract typed block props from each section's markdown
  → Stage 3: Render blocks via BlockRenderer
```

---

## Markdown Handling Strategy: Hybrid

**Decision:** Structured parsing for list/card blocks; `react-markdown` for prose fields.

**Why:**
- Blocks like `feature-grid`, `service-cards`, `team-grid`, and `pricing` require typed arrays (`FeatureGridItem[]`, `ServiceCard[]`, etc.) — they cannot render from a blob of markdown. The structure must be extracted before the block sees the data.
- Blocks like `content-prose`, `content-split`, `intro-text`, and `checklist-section` (intro field) contain free-form prose — `react-markdown` handles this cleanly and preserves formatting.
- Claude already knows which block it's writing for, so its output format for structured blocks is consistent and parseable.

**The rule:** If a block has an `items[]`, `cards[]`, `steps[]`, `tiers[]`, `members[]`, `stats[]`, `testimonials[]`, or `logos[]` slot — that slot is pre-parsed by the assembler into a typed array. All `body`, `intro`, `description`, and `prose` slots are passed as raw markdown strings to `react-markdown`.

---

## Stage 1: Frontmatter + Section Splitting

```typescript
// lib/assembly/parse-page-md.ts

import matter from 'gray-matter'    // npm: gray-matter

export type RawSection = {
  blockId: string
  variant?: string
  image?: string
  rawContent: string    // everything between this <!-- block: --> and the next one
}

export type PageFrontmatter = {
  title: string
  url: string
  meta_title: string
  meta_description: string
  target_keyword: string
  secondary_keywords: string[]
  canonical_url: string
  schema_markup: string
  answer_block?: string
  eeat_signals?: string[]
  internal_links?: Array<{ url: string; anchor_text: string; reason: string }>
  faq_block?: Array<{ question: string; answer: string }>
  llm_citation_note?: string
  // Hero annotation
  hero: string
  hero_variant?: string
  hero_image?: string
}

const BLOCK_COMMENT_PATTERN =
  /^<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z0-9-]+))?(?:\s*\|\s*image:\s*([^\s>]+))? -->\s*$/m

export function parsePageMd(markdown: string): { frontmatter: PageFrontmatter; sections: RawSection[] } {
  const { data: frontmatter, content } = matter(markdown)

  // Split on block annotation comments
  // Each section starts with a <!-- block: --> comment followed by a ## heading
  const sectionPattern = /(?=^<!-- block:)/gm
  const rawParts = content.split(sectionPattern).filter(Boolean)

  const sections: RawSection[] = rawParts.map(part => {
    const lines = part.split('\n')
    const commentLine = lines[0]
    const match = commentLine.match(BLOCK_COMMENT_PATTERN)

    if (!match) return null

    return {
      blockId: match[1],
      variant: match[2] ?? undefined,
      image: match[3] ?? undefined,
      rawContent: lines.slice(1).join('\n').trim(),  // everything after the comment
    }
  }).filter(Boolean) as RawSection[]

  return { frontmatter: frontmatter as PageFrontmatter, sections }
}
```

---

## Stage 2: Typed Prop Extraction

Each `RawSection` is passed through a per-block extractor that returns the typed props the block component expects.

```typescript
// lib/assembly/extract-block-props.ts

import { RawSection } from './parse-page-md'
import {
  IntroTextProps, ContentSplitProps, FeatureGridProps,
  ServiceCardsProps, TeamGridProps, PricingProps,
  FaqAccordionProps, StatsBarProps, ProcessStepsProps,
  // ... all block prop types
} from '@/components/blocks'

export type BlockProps = {
  blockId: string
  variant?: string
  props: Record<string, unknown>
}

export function extractBlockProps(section: RawSection): BlockProps {
  const extractor = EXTRACTORS[section.blockId]
  if (!extractor) {
    // Unknown block — fall back to content-prose
    return {
      blockId: 'content-prose',
      props: { body: section.rawContent }
    }
  }
  return {
    blockId: section.blockId,
    variant: section.variant,
    props: extractor(section)
  }
}

const EXTRACTORS: Record<string, (section: RawSection) => Record<string, unknown>> = {
  'intro-text':         extractIntroText,
  'content-split':      extractContentSplit,
  'content-prose':      extractContentProse,
  'checklist-section':  extractChecklistSection,
  'process-steps':      extractProcessSteps,
  'feature-grid':       extractFeatureGrid,
  'service-cards':      extractServiceCards,
  'content-cards':      extractContentCards,
  'team-grid':          extractTeamGrid,
  'industry-cards':     extractIndustryCards,
  'testimonials':       extractTestimonials,
  'stats-bar':          extractStatsBar,
  'logo-bar':           extractLogoBar,
  'cta-banner':         extractCtaBanner,
  'pricing':            extractPricing,
  'faq-accordion':      extractFaqAccordion,
  'form':               extractForm,
  'content-table':      extractContentTable,
  'hero-split':         extractHeroSplit,
  'page-header':        extractPageHeader,
}
```

---

## Extraction Patterns

### Pattern A: Prose Blocks

For blocks where the entire section body is free-form narrative. Extract the H2 heading and pass the rest as a markdown string.

```typescript
function extractContentProse(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  return { headline: heading, body }
}

function extractIntroText(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  const { prose, cta } = extractTrailingCta(body)
  return {
    variant: section.variant ?? 'centered',
    headline: heading,
    body: prose,
    cta
  }
}

function extractContentSplit(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  const { prose, cta } = extractTrailingCta(body)
  return {
    variant: section.variant ?? 'image-right',
    headline: heading,
    body: prose,
    image: section.image ?? null,
    imageAlt: heading,  // fallback alt text to section heading
    cta
  }
}
```

### Pattern B: List Blocks

For blocks where the section body contains a markdown list that maps to a typed array. Claude writes these as standard markdown lists (`- item`) or definition-style lists.

```typescript
function extractFeatureGrid(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  const { intro, listBlock } = extractIntroAndList(body)

  // Claude writes feature-grid items as: - IconName: **Title** — Description
  const items = parseIconTitleDescriptionList(listBlock)

  return {
    variant: section.variant ?? '3-col',
    headline: heading,
    intro,
    items    // FeatureGridItem[]
  }
}

function extractChecklistSection(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  const { intro, listBlock, cta } = extractIntroListCta(body)
  const items = parseSimpleList(listBlock)   // string[]
  return {
    variant: section.variant ?? 'standalone',
    headline: heading,
    intro,
    items,
    image: section.image ?? null,
    cta
  }
}

function extractProcessSteps(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  // Claude writes steps as: 1. **Title** — Description
  const steps = parseNumberedSteps(body)
  return {
    variant: section.variant ?? 'vertical',
    headline: heading,
    steps    // Step[]
  }
}

function extractStatsBar(section: RawSection) {
  // Claude writes stats as: - **25+** Years in Business
  const stats = parseStatsList(section.rawContent)
  return {
    variant: section.variant ?? '3-up',
    stats    // Stat[]
  }
}
```

### Pattern C: Card Blocks

Card blocks follow the same list extraction pattern but with richer per-item structure.

```typescript
function extractServiceCards(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  const { intro, listBlock } = extractIntroAndList(body)

  // Claude writes service cards as:
  // - [Title](/url) — Description paragraph
  const cards = parseLinkCards(listBlock)    // ServiceCard[]

  return {
    variant: section.variant ?? '3-col',
    headline: heading,
    intro,
    cards
  }
}

function extractTeamGrid(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  // Claude writes team members as structured blocks:
  // ### Name, Credentials
  // **Title**
  // Bio paragraph
  const members = parseTeamMembers(body)
  return {
    variant: section.variant ?? '3-col',
    headline: heading,
    members    // TeamMember[]
  }
}

function extractPricing(section: RawSection) {
  const { heading, body } = splitHeadingFromBody(section.rawContent)
  // Claude writes pricing tiers as H3 sections:
  // ### Tier Name
  // **$Price / period**
  // Description
  // - Feature 1
  // - Feature 2
  // [CTA Label](/url)
  const tiers = parsePricingTiers(body)
  return {
    variant: section.variant ?? '3-tier',
    headline: heading,
    tiers    // PricingTier[]
  }
}
```

### Pattern D: Auto-Populated Blocks

`faq-accordion` — the section markdown contains the Q&A, but the structured `faq_block` from frontmatter is used as the typed source:

```typescript
function extractFaqAccordion(section: RawSection, frontmatter: PageFrontmatter) {
  const { heading } = splitHeadingFromBody(section.rawContent)
  // Prefer structured faq_block from frontmatter; fall back to parsing the markdown
  const items = frontmatter.faq_block?.length
    ? frontmatter.faq_block
    : parseFaqMarkdown(section.rawContent)
  return { headline: heading, items }
}
```

---

## Core Utility Functions

```typescript
// lib/assembly/md-utils.ts

/** Extract the first ## heading from content and return heading text + remaining body */
export function splitHeadingFromBody(content: string): { heading: string; body: string } {
  const match = content.match(/^##\s+(.+?)(?:\n|$)([\s\S]*)/)
  if (!match) return { heading: '', body: content.trim() }
  return { heading: match[1].trim(), body: match[2].trim() }
}

/** Extract a trailing CTA link from prose: last line matching [Label](url) */
export function extractTrailingCta(body: string): { prose: string; cta?: { label: string; url: string } } {
  const ctaMatch = body.match(/\[([^\]]+)\]\(([^)]+)\)\s*$/)
  if (!ctaMatch) return { prose: body }
  return {
    prose: body.slice(0, ctaMatch.index).trimEnd(),
    cta: { label: ctaMatch[1], url: ctaMatch[2] }
  }
}

/** Extract an optional intro paragraph before the first list item */
export function extractIntroAndList(body: string): { intro?: string; listBlock: string } {
  const listStart = body.search(/^[-*\d]/m)
  if (listStart <= 0) return { listBlock: body }
  return {
    intro: body.slice(0, listStart).trim() || undefined,
    listBlock: body.slice(listStart).trim()
  }
}

/** Parse a markdown list into string[] */
export function parseSimpleList(list: string): string[] {
  return list
    .split('\n')
    .filter(line => /^[-*]\s/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
}

/** Parse: - IconName: **Title** — Description */
export function parseIconTitleDescriptionList(list: string) {
  return list
    .split('\n')
    .filter(line => /^[-*]\s/.test(line))
    .map(line => {
      const cleaned = line.replace(/^[-*]\s+/, '')
      const iconMatch = cleaned.match(/^(\w+):\s+\*\*(.+?)\*\*\s*[—-]\s*(.+)$/)
      if (iconMatch) return { icon: iconMatch[1], title: iconMatch[2], description: iconMatch[3] }
      // Fallback: no icon, treat as title — description
      const parts = cleaned.split(/\s*[—-]\s*/)
      return { icon: 'CheckCircle', title: parts[0]?.replace(/\*\*/g, '') ?? '', description: parts[1] ?? '' }
    })
}

/** Parse: - **Value** Label */
export function parseStatsList(content: string) {
  return content
    .split('\n')
    .filter(line => /^[-*]\s/.test(line))
    .map(line => {
      const match = line.match(/^[-*]\s+\*\*([^*]+)\*\*\s+(.+)$/)
      return match ? { value: match[1], label: match[2] } : null
    })
    .filter(Boolean)
}

/** Parse numbered steps: 1. **Title** — Description */
export function parseNumberedSteps(content: string) {
  return content
    .split('\n')
    .filter(line => /^\d+\./.test(line))
    .map((line, i) => {
      const match = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*[—-]\s*(.+)$/)
      return match
        ? { number: String(i + 1).padStart(2, '0'), title: match[1], description: match[2] }
        : { number: String(i + 1).padStart(2, '0'), title: line.replace(/^\d+\.\s+/, ''), description: '' }
    })
}
```

---

## Claude Content Format Guide (for Phase 5 Prompt)

Claude needs to know the expected format for each structured block type. Add this to the Phase 5 system prompt's block catalog section:

```
STRUCTURED BLOCK CONTENT FORMATS:

feature-grid items — write as:
- Calculator: **Tax Planning** — [description]
- BarChart: **Financial Reporting** — [description]
(icon name from lucide-react, then colon, then **bold title**, then em dash, then description)

process-steps items — write as:
1. **Discovery Call** — We begin with a 30-minute call to understand your needs.
2. **Engagement Letter** — We send a clear scope of work and fee agreement.

stats-bar items — write as:
- **25+** Years serving Massachusetts businesses
- **400+** Active clients across 12 counties

service-cards / industry-cards — write as:
- [Advisory & Virtual CFO](/services/virtual-cfo-advisory) — CFO-level oversight for growing businesses.

team-grid members — write as:
### Ron Lague, CPA, PFS
**Managing Partner**
Ron founded the firm in 1999 and holds the Personal Financial Specialist designation...

pricing tiers — write as:
### Starter
**$500 / month**
For businesses just getting started with outsourced accounting.
- Monthly bookkeeping
- Bank reconciliation
- Quarterly financial statements
[Get Started](/contact)

testimonials — write as:
> "Working with Korbey Lague changed how we think about finances." — Jane Smith, CEO, Acme Corp

All other blocks (intro-text, content-split, content-prose, checklist-section, cta-banner) — write as normal markdown prose with optional trailing [CTA Label](/url).
```

---

## Stage 3: BlockRenderer

The `BlockRenderer` receives typed `BlockProps` and renders the matching component.

```tsx
// components/assembly/BlockRenderer.tsx

import type { BlockProps } from '@/lib/assembly/extract-block-props'
import {
  IntroText, ContentSplit, ContentProse, ChecklistSection,
  ProcessSteps, FeatureGrid, ServiceCards, ContentCards,
  TeamGrid, IndustryCards, Testimonials, StatsBar, LogoBar,
  CtaBanner, Pricing, FaqAccordion, Form, ContentTable,
  HeroSplit, PageHeader
} from '@/components/blocks'

const BLOCK_MAP = {
  'intro-text':         IntroText,
  'content-split':      ContentSplit,
  'content-prose':      ContentProse,
  'checklist-section':  ChecklistSection,
  'process-steps':      ProcessSteps,
  'feature-grid':       FeatureGrid,
  'service-cards':      ServiceCards,
  'content-cards':      ContentCards,
  'team-grid':          TeamGrid,
  'industry-cards':     IndustryCards,
  'testimonials':       Testimonials,
  'stats-bar':          StatsBar,
  'logo-bar':           LogoBar,
  'cta-banner':         CtaBanner,
  'pricing':            Pricing,
  'faq-accordion':      FaqAccordion,
  'form':               Form,
  'content-table':      ContentTable,
  'hero-split':         HeroSplit,
  'page-header':        PageHeader,
} as const

export function BlockRenderer({ blockId, variant, props }: BlockProps) {
  const Component = BLOCK_MAP[blockId as keyof typeof BLOCK_MAP]
  if (!Component) {
    console.warn(`[BlockRenderer] Unknown block "${blockId}" — falling back to content-prose`)
    return <ContentProse body={String(props.body ?? '')} />
  }
  // @ts-expect-error — variant merged with extracted props
  return <Component variant={variant} {...props} />
}
```

---

## Full Page Rendering

```tsx
// app/[...slug]/page.tsx  (simplified)

import { parsePageMd } from '@/lib/assembly/parse-page-md'
import { extractBlockProps } from '@/lib/assembly/extract-block-props'
import { BlockRenderer } from '@/components/assembly/BlockRenderer'
import { Hero, PageHeader, HeroSplit } from '@/components/blocks'
import { getPageByUrl } from '@/lib/content/get-page'

export default async function Page({ params }: { params: { slug: string[] } }) {
  const url = '/' + params.slug.join('/')
  const markdown = await getPageByUrl(url)   // reads from /content/*.md files in client repo
  const { frontmatter, sections } = parsePageMd(markdown)
  const blockProps = sections.map(section => extractBlockProps(section, frontmatter))

  return (
    <main>
      {/* Page opener — driven by frontmatter hero fields */}
      <HeroBlock
        hero={frontmatter.hero}
        variant={frontmatter.hero_variant}
        image={frontmatter.hero_image}
        headline={/* extracted from first H1 in content */}
        subheadline={/* extracted from opening paragraph */}
      />

      {/* Body sections */}
      {blockProps.map((bp, i) => (
        <BlockRenderer key={i} {...bp} />
      ))}
    </main>
  )
}
```

---

## Content Files in Client Repo

The deliverable package (zip from Phase 6) is unzipped into the client repo at:

```
content/
  pages/
    home.md
    about.md
    about--our-story.md
    services--virtual-cfo-advisory.md
    ... (one per confirmed page)
  nav.json          — seeded navigation structure
  brand.json        — parsed palette and brand voice
  design.json       — typography and token values
  llms.txt
  llms-full.txt
  robots.txt
  sitemap.xml
```

The `getPageByUrl` function reads from `content/pages/` using the URL path as a lookup key. The slug `services/virtual-cfo-advisory` maps to `content/pages/services--virtual-cfo-advisory.md`.

```typescript
// lib/content/get-page.ts

import fs from 'fs/promises'
import path from 'path'

export async function getPageByUrl(url: string): Promise<string> {
  const slug = url.replace(/^\//, '').replace(/\//g, '--')
  const filePath = path.join(process.cwd(), 'content/pages', `${slug}.md`)
  return fs.readFile(filePath, 'utf-8')
}

export async function getAllPageUrls(): Promise<string[]> {
  const dir = path.join(process.cwd(), 'content/pages')
  const files = await fs.readdir(dir)
  return files
    .filter(f => f.endsWith('.md'))
    .map(f => '/' + f.replace(/\.md$/, '').replace(/--/g, '/'))
}
```

`getAllPageUrls()` is used in `generateStaticParams()` for static export.
