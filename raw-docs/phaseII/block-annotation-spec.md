# Block Annotation Spec

**Version:** 1.0  
**Status:** Draft  
**Scope:** Defines how block recommendations are embedded in generated `.md` content files, how Claude selects them, how the validator checks them, and how the assembly system reads and renders them into pages.

---

## Overview

Every generated page `.md` file carries two levels of block annotation:

1. **Page-level** — in the YAML frontmatter. Declares the hero type and variant for the page opener.
2. **Section-level** — inline HTML comments immediately before each `##` heading. Declare which block should render that section and any variant.

Together, these annotations give the assembly system a complete, unambiguous map of how to compose the page from components.

---

## Level 1: Page-Level Annotation (Frontmatter)

The frontmatter block already contains SEO and metadata fields. Block annotation adds three new keys:

```yaml
---
title: Advisory & Virtual CFO Services | Korbey Lague PLLP
url: /services/virtual-cfo-advisory
meta_title: Advisory & Virtual CFO Services | Korbey Lague PLLP
meta_description: ...
target_keyword: virtual CFO services Massachusetts
canonical_url: https://korbeylague.com/services/virtual-cfo-advisory
schema_markup: Service

# Block annotation — page-level
hero: hero                    # block ID for the page opener
hero_variant: image           # image | video | slider (for hero) or image-right | image-left (for hero-split)
hero_image: cfo-team.jpg      # filename from session assets (optional — assembler falls back to brand color bg)
---
```

**Field definitions:**

| Field | Required | Values | Notes |
|---|---|---|---|
| `hero` | ✅ | `hero`, `hero-split`, `page-header` | The block used for the page opener. |
| `hero_variant` | ✅ | see block spec | Required when `hero` is `hero` or `hero-split`. Omit for `page-header`. |
| `hero_image` | ☐ | filename string | Filename from the session's uploaded assets. Assembler looks in `session-assets/{sessionId}/`. |

**Homepage special case:** The homepage always uses `hero` with the variant declared by Claude during Phase 5. No other block may use `hero` as the page-level block.

---

## Level 2: Section-Level Annotation (Inline Comments)

Each `##` section in the markdown body is preceded by an HTML comment annotation on the line immediately above:

```
<!-- block: {block-id} | variant: {variant} | image: {filename} -->
## Section Heading
```

**Syntax rules:**
- The comment must be on the line immediately preceding the `##` heading — no blank line between.
- `block:` is required. `variant:` and `image:` are optional.
- All values are lowercase, hyphen-separated (matching block IDs and variant names exactly).
- Unknown keys are ignored by the validator — they do not cause errors.

### Examples

```markdown
<!-- block: intro-text | variant: centered -->
## Why Growing Businesses Choose a Virtual CFO

Paragraph copy here...

<!-- block: feature-grid | variant: 3-col -->
## What's Included in Virtual CFO Services

Feature card content here...

<!-- block: content-split | variant: image-right | image: cfo-consultation.jpg -->
## Ongoing Financial Oversight

Narrative copy with image here...

<!-- block: cta-banner | variant: color-bg -->
## Ready to Strengthen Your Financial Strategy?

CTA copy here...

<!-- block: faq-accordion -->
## Frequently Asked Questions About Virtual CFO Services

Auto-generated from faq_block — see FAQ Auto-Append section below.
```

---

## FAQ Auto-Append

The `faq-accordion` block is **never selected by Claude**. It is always appended programmatically by `deliverable-builder.ts` after content generation completes.

### Logic

```typescript
// In deliverable-builder.ts, after content_markdown is assembled:

if (page.faq_block && page.faq_block.length > 0) {
  const faqHeadline = `Frequently Asked Questions About ${page.page_title}`
  const faqAnnotation = `<!-- block: faq-accordion -->`
  const faqMarkdown = buildFaqMarkdown(page.faq_block, faqHeadline)

  content_markdown += `\n\n${faqAnnotation}\n## ${faqHeadline}\n\n${faqMarkdown}`
}
```

### `buildFaqMarkdown` output format

```markdown
**Q: What does a virtual CFO do for a small business?**
A: A virtual CFO provides CFO-level financial oversight on a fractional basis...

**Q: How much does a virtual CFO cost?**
A: Virtual CFO fees typically range from...
```

### Placement rule

The FAQ block always appends as the second-to-last section — placed after all narrative content but before the final `cta-banner` or `form` block (if present). If neither a CTA nor a form closes the page, FAQ is the final section.

---

## Claude's Role: Block Selection in Phase 5

### System Prompt Addition

The following block catalog and selection instructions are appended to the Phase 5 content generation system prompt (defined in `lib/content/content-generator.ts`):

```
BLOCK ANNOTATION RULES:

Before every ## section heading, emit a block annotation comment on the immediately preceding line.
Format: <!-- block: {block-id} | variant: {variant} -->

Choose the block that best matches what the section contains. Use this catalog:

hero          → Page opener with background image, video, or slides [PAGE FRONTMATTER ONLY]
page-header   → Inner page title with no large visual [PAGE FRONTMATTER ONLY]
hero-split    → Page opener with text + image side by side [PAGE FRONTMATTER ONLY]
intro-text    → Short headline + paragraph transition
content-split → Narrative paragraph with a supporting image
content-prose → Long-form copy, no supporting image
checklist-section → List of benefits, inclusions, or qualifying criteria
process-steps → Numbered or sequential how-it-works steps
feature-grid  → 3–8 equal features with icon + short description
service-cards → 2–9 named services with descriptions and links
content-cards → Articles or resources with images
team-grid     → Staff or partner profiles with photos
industry-cards → Industry or niche verticals with icons
testimonials  → Client quotes or reviews
stats-bar     → 3–4 numeric proof points
logo-bar      → Certification badges or association logos
cta-banner    → A direct call to action with a button
pricing       → Tiered service packages with prices and feature lists
form          → A contact, quote, or newsletter form
content-table → Comparison data or structured reference info

DO NOT annotate with faq-accordion — this is added automatically.
DO NOT emit a hero/page-header/hero-split annotation inline — these are frontmatter only.

VARIANT RULES:
- content-split: alternate image-right and image-left across consecutive sections
- feature-grid: default to 3-col; use 4-col only if 8+ items
- service-cards: default to 3-col; use 2-col if descriptions exceed 4 sentences
- team-grid: match col count to team size (2-col ≤4 people, 3-col 5–9, 4-col 10+)
- cta-banner: use color-bg unless a specific background image is referenced in content
- form: use contact variant unless the page context implies quote or newsletter
- pricing: match tier count to the number of packages described (2-tier, 3-tier, or 4-tier)
```

---

## Validator: Block Assignment Rules

The validator (`lib/content/block-annotation-validator.ts`) runs after Claude generates content and before the content is written to `generated_pages`. It checks every `<!-- block: -->` comment against a rule set.

### Validator Interface

```typescript
export type BlockAnnotation = {
  blockId: string
  variant?: string
  image?: string
  headingText: string
  position: number   // section index (0-based)
}

export type ValidationResult = {
  passed: boolean
  warnings: string[]   // non-fatal — logged but don't block
  errors: string[]     // fatal — trigger a targeted re-prompt for that section
}

export function validateBlockAnnotations(
  annotations: BlockAnnotation[],
  pageUrl: string,
  faqBlock: { question: string; answer: string }[]
): ValidationResult
```

### Validation Rules

**Fatal errors (trigger re-prompt for that section):**

| Rule | Check |
|---|---|
| `hero` inline | `hero`, `hero-split`, or `page-header` must not appear as section-level annotations |
| `faq-accordion` inline | Claude must not emit `faq-accordion` — it's auto-appended |
| Invalid block ID | Block ID must match one of the 21 defined IDs exactly |
| Invalid variant | Variant must be a defined variant for that block |
| `stats-bar` without numbers | Section content must contain at least one numeric value |
| `pricing` without tiers | Section must contain 2–4 pricing tier definitions |
| `team-grid` without people | Section must reference at least 2 named individuals |
| `form` at non-terminal position | `form` should only appear in the last 2 sections of a page |
| `cta-banner` at position 0 | First section cannot be a CTA |

**Warnings (logged, not fatal):**

| Rule | Check |
|---|---|
| Consecutive `content-split` same variant | Two adjacent `content-split` sections should not have the same `image-right` or `image-left` variant |
| No CTA or form on page | Pages with 5+ sections should end with `cta-banner` or `form` |
| `intro-text` after `intro-text` | Two consecutive intro-text sections — likely a structural issue |
| `content-prose` with short copy | `content-prose` assigned to a section with fewer than 150 words — consider `intro-text` instead |
| Missing `image` on `content-split` | A split section without an image reference will need an asset assigned manually |

### Re-Prompt on Fatal Error

When a fatal validation error is detected, the validator constructs a targeted correction prompt instead of regenerating the full page:

```typescript
const correctionPrompt = `
The following section annotation is invalid:
Section ${error.position}: "${error.headingText}"
Current annotation: <!-- block: ${error.blockId} -->
Issue: ${error.reason}

Correct this annotation only and return the updated section (heading + annotation + copy unchanged).
Valid block for this content: ${error.suggestion}
`
```

This is sent as a single targeted Claude call — not a full page regeneration.

---

## Assembly System Design

The assembler reads a `.md` file and produces a structured page manifest that the rendering layer consumes. This happens at build time (or request time for dynamic pages).

### Parsing Pipeline

```typescript
// lib/assembly/parse-page-md.ts

export type PageSection = {
  blockId: string
  variant?: string
  image?: string
  heading: string
  content: string     // raw markdown content below the heading
}

export type PageManifest = {
  // From frontmatter
  title: string
  url: string
  meta_title: string
  meta_description: string
  target_keyword: string
  canonical_url: string
  schema_markup: string
  // Hero
  hero: string         // block ID
  hero_variant: string
  hero_image?: string
  // Body sections
  sections: PageSection[]
  // Structured data (passed through, not rendered as sections)
  answer_block: string
  eeat_signals: string[]
  internal_links: InternalLink[]
  faq_block: FaqItem[]   // available as structured data, also rendered in last section
  llm_citation_note: string
}

export function parsePageMd(markdown: string): PageManifest {
  // 1. Extract frontmatter (between --- delimiters)
  // 2. Parse body: split on /^<!-- block: (.+?) -->\n^## /m
  // 3. For each match: extract blockId, variant, image from comment; heading and content from what follows
  // 4. Return PageManifest
}
```

### Regex for Section Splitting

```typescript
const SECTION_PATTERN = /^<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z-]+))?(?:\s*\|\s*image:\s*([^\s>]+))? -->\n(##[^#].*?)\n([\s\S]*?)(?=<!-- block:|$)/gm
```

### Rendering (Pseudocode)

```typescript
// app/[client]/[...slug]/page.tsx (or equivalent)

const manifest = parsePageMd(pageMarkdown)
const clientTheme = loadClientTheme(sessionId)  // tokens from brand.md + design.md

return (
  <ThemeProvider theme={clientTheme}>
    <HeroBlock
      variant={manifest.hero_variant}
      image={manifest.hero_image}
      // headline and subheadline come from the page H1 and opening paragraph
    />
    {manifest.sections.map((section, i) => (
      <BlockRenderer key={i} section={section} manifest={manifest} />
    ))}
  </ThemeProvider>
)
```

### `BlockRenderer` Component

```typescript
// components/assembly/BlockRenderer.tsx

const BLOCK_MAP: Record<string, React.ComponentType<BlockProps>> = {
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
}

export function BlockRenderer({ section, manifest }: BlockRendererProps) {
  const Component = BLOCK_MAP[section.blockId]
  if (!Component) {
    console.warn(`[assembly] Unknown block: ${section.blockId} — rendering as content-prose`)
    return <ContentProse heading={section.heading} content={section.content} />
  }
  return (
    <Component
      variant={section.variant}
      image={section.image}
      heading={section.heading}
      content={section.content}
      manifest={manifest}
    />
  )
}
```

---

## Integration with Pipeline Steps

### Step 08 — Content Generation

**Changes required:**
1. Add the block catalog and selection instructions to the Phase 5 system prompt in `lib/content/content-generator.ts`
2. After Claude generates each page, run `validateBlockAnnotations()` before writing to `generated_pages`
3. If fatal errors, run the targeted correction prompt and re-validate (max 1 retry)
4. Store the validated content in `generated_pages.content_markdown`
5. Parse the frontmatter hero annotation and store `hero_block` and `hero_variant` as new columns on `generated_pages` (add to Step 02 migration or a new migration)

**New columns on `generated_pages`:**
```sql
ALTER TABLE generated_pages
  ADD COLUMN hero_block text DEFAULT 'page-header',
  ADD COLUMN hero_variant text DEFAULT NULL,
  ADD COLUMN hero_image text DEFAULT NULL;
```

### Step 09 — Deliverable Generation

**Changes required in `deliverable-builder.ts`:**
1. After assembling `content_markdown`, call `appendFaqBlock(page)` if `faq_block` is non-empty
2. The FAQ annotation comment and markdown are appended in the correct position (second-to-last section)
3. The assembled markdown (with FAQ) is what gets written to the per-page `.md` file in the zip

**New function:**
```typescript
// lib/content/deliverable-builder.ts

function appendFaqBlock(page: GeneratedPage): string {
  if (!page.faq_block || page.faq_block.length === 0) return page.content_markdown

  const headline = `Frequently Asked Questions About ${page.page_title}`
  const annotation = `<!-- block: faq-accordion -->`
  const faqMd = page.faq_block
    .map(item => `**Q: ${item.question}**\nA: ${item.answer}`)
    .join('\n\n')

  // Insert before the last ## section if it's a cta-banner or form
  const lastSectionMatch = page.content_markdown.match(/<!-- block: (cta-banner|form)[\s\S]*$/)
  if (lastSectionMatch) {
    const insertAt = page.content_markdown.lastIndexOf(lastSectionMatch[0])
    return (
      page.content_markdown.slice(0, insertAt) +
      `${annotation}\n## ${headline}\n\n${faqMd}\n\n` +
      page.content_markdown.slice(insertAt)
    )
  }

  // Otherwise append at the end
  return `${page.content_markdown}\n\n${annotation}\n## ${headline}\n\n${faqMd}`
}
```

---

## Complete Annotated .md File Example

```markdown
---
title: Advisory & Virtual CFO Services | Korbey Lague PLLP
url: /services/virtual-cfo-advisory
meta_title: Advisory & Virtual CFO Services | Korbey Lague PLLP
meta_description: Korbey Lague PLLP offers virtual CFO services for growing businesses in Massachusetts. Financial oversight, forecasting, and strategy on a fractional basis.
target_keyword: virtual CFO services Massachusetts
secondary_keywords: [fractional CFO, advisory accounting, financial strategy CPA]
canonical_url: https://korbeylague.com/services/virtual-cfo-advisory
schema_markup: Service
hero: hero
hero_variant: image
hero_image: cfo-team.jpg
---

<!-- block: intro-text | variant: centered -->
## CFO-Level Thinking Without the Full-Time Cost

More businesses are discovering they don't need a full-time CFO to get...

<!-- block: feature-grid | variant: 3-col -->
## What Virtual CFO Services Include

Monthly financial reporting and analysis...

<!-- block: content-split | variant: image-right | image: advisory-meeting.jpg -->
## Forecasting and Scenario Planning

When your business faces a major decision...

<!-- block: process-steps | variant: vertical -->
## How We Engage With Your Business

Our virtual CFO engagements follow a structured onboarding...

<!-- block: stats-bar | variant: 3-up -->
## By the Numbers

25+ years · 400+ clients · $2.1B in client revenue advised

<!-- block: testimonials | variant: grid -->
## What Our Clients Say

"Working with Korbey Lague changed how we think about our finances..."

<!-- block: cta-banner | variant: color-bg -->
## Start With a Conversation

No commitment. No jargon. Just a clear picture of where your finances stand...

<!-- block: faq-accordion -->
## Frequently Asked Questions About Virtual CFO Services

**Q: What does a virtual CFO do for a small business?**
A: A virtual CFO provides executive-level financial oversight...

**Q: How is a virtual CFO different from a bookkeeper?**
A: A bookkeeper records transactions. A virtual CFO interprets them...
```

---

## File Locations

```
lib/
  assembly/
    parse-page-md.ts          — markdown parser → PageManifest
  content/
    block-annotation-validator.ts  — validation rules
    (deliverable-builder.ts)       — FAQ auto-append logic added here

components/
  assembly/
    BlockRenderer.tsx          — routes blockId → component
    (individual block components added here as built)

raw-docs/
  content-generation/
    component-library-spec.md  — 21 block definitions (this spec's companion)
    block-annotation-spec.md   — this file
```
