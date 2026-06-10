# Step 08 — Content Generation (Phase 5)

Generate full copy for every approved page using Claude, applying the anti-slop layer, brand voice, and SEO/AIO/GEO metadata in a single pass per page.

---

## What We're Building

An async content generation pipeline that processes approved outlines into full page copy plus a complete metadata block. Results stored in `generated_pages`. Admin sees live progress per page.

---

## Anti-Slop Implementation

Before writing any page copy, study these reference implementations:
- https://github.com/hardikpandya/stop-slop
- https://github.com/blader/humanizer

The anti-slop approach is a combination of system prompt rules and a post-processing validation pass.

### System Prompt Anti-Slop Rules

Add a dedicated `ANTI-SLOP RULES` block to the content generation system prompt:

```
ANTI-SLOP RULES — read before writing a single word:

BANNED WORDS AND PHRASES (never use these):
- "In today's [adjective] landscape"
- "Navigate", "leverage", "utilize"
- "Game-changer", "game-changing"
- "Seamless", "seamlessly"
- "Unlock" (as metaphor)
- "Empower", "empowers"
- "Cutting-edge", "state-of-the-art"
- "Tailored solutions", "bespoke"
- "Passionate about", "we're passionate"
- "Dedicated to", "we're dedicated"
- "Partner with us", "your trusted partner"
- "In conclusion", "to summarize"
- Any sentence starting with "As a [role]..."

STRUCTURAL RULES:
- No more than 2 sentences in a row that start with "We" or "Our"
- No paragraph that begins and ends with a superlative claim
- Vary sentence length deliberately: mix short punchy sentences with longer ones
- Every claim must be specific: "clients in 12 Massachusetts counties" not "clients across the region"
- Proof over assertion: if you claim expertise, name the credential or give the example

VOICE RULES:
- Write like the firm's smartest person talking to a prospective client at a coffee meeting — knowledgeable, direct, no fluff
- The firm should sound like it already knows the client's problem, not like it's trying to impress them
- If something would sound like filler in a conversation, it's filler in copy too — cut it

HEADING RULES:
- Sentence case, specific, benefit-driven
- No parenthetical subtitles "(Beyond the Buzzwords)"; no colon-clichés ("A Deep Dive", "A Complete Guide", "Everything You Need to Know")
- No "What X Actually Means", "Beyond the …", "The Importance of …", "A Closer Look", "Demystifying/Decoding/Unpacking", or listicle titles ("5 Reasons …")
- No dashes in headings

AI-TELL PATTERNS (never use):
- Negative parallelism ("It's not just X, it's Y", "not only … but also")
- Copula avoidance ("serves as"/"stands as" — write "is")
- Signposting/persuasion tropes ("At its core", "Let's dive in", "When it comes to", "In this article")
- "A testament to", "ever-evolving", "in today's … landscape"
- Em-dashes/en-dashes — use commas, periods, or colons (en-dashes only for number ranges like 600–1200)
```

These heading + AI-tell rules also gate the **outline generator** (`outline-generator.ts`), since clever section titles originate at the outline stage.

### Post-Processing Validation

After Claude generates each page, run a validation check:
- Scan for any banned phrases from the list above
- Scan headings for parenthetical/colon-cliché/formulaic patterns, and prose for negative parallelism, copula avoidance, and signposting tropes
- Flag any violation for automatic regeneration (1 retry)
- Log flagged phrases to the console for monitoring

Implement as `lib/content/anti-slop-validator.ts`:
```typescript
export function validateContent(content: string): { passed: boolean; flagged: string[] }
export function humanizeDashes(text: string): string   // deterministic em/en-dash strip, applied before save
export function cleanHeading(text: string): string      // strips parenthetical subtitle + dashes, used at outline stage
```

Em-dashes are handled by the deterministic `humanizeDashes()` pass (applied to the body and visible metadata before save), **not** by `validateContent()` — models resist prompt-only em-dash bans, and routing them through the retry would burn the single regeneration on something we strip mechanically.

---

## Content Generation System Prompt (Full)

```
You are writing website copy for {firmName}, a CPA firm in {location}.

BRAND VOICE:
{brand.currentTone} | Aspirational: {brand.aspirationalTone}
Tone adjectives: {brand.toneAdjectives}
Avoid: {brand.toneToAvoid}
Positioning: {business.positioningOption} — {business.positioningStatement}

PALETTE TONE: {palette_tone_signal}

DIFFERENTIATORS (use these specifically, do not generalize):
{business.differentiators}

CREDENTIALS TO FEATURE:
{team credentials, affiliations, certifications from schema}

PAGE TO WRITE:
Title: {page_title}
URL: {page_url}
Approved outline: {outline_sections_as_json}

KEYWORD TARGET:
Primary: {target_keyword}
Secondary: {secondary_keywords}

EXISTING CONTENT ON THIS TOPIC (rewrite and improve — do not copy):
{existing_content}

COMPETITOR REFERENCES (differentiate from these — do not imitate):
{competitor_excerpts}

OUTPUT: Return a JSON object with two keys:
1. "content" — the full page copy in markdown. Use ## for H2s matching the approved outline. Write naturally, as if for a human reader first, search engine second.
2. "metadata" — a JSON object with all SEO/AIO/GEO fields (see schema below).

{anti_slop_rules}
```

---

## SEO/AIO/GEO Metadata Schema

```typescript
{
  meta_title: string,              // 50-60 chars, contains primary keyword
  meta_description: string,        // 150-160 chars, compelling + keyword
  target_keyword: string,
  secondary_keywords: string[],
  url_slug: string,                // final recommended slug
  canonical_url: string,           // full URL with domain placeholder

  // AIO / Generative Engine Optimization
  answer_block: string,            // 2-3 sentences answering the likely search query directly

  // Schema markup
  schema_markup_type: string,      // e.g. "LocalBusiness", "Service", "FAQPage"

  // E-E-A-T signals
  eeat_signals: string[],          // e.g. ["Ron Lague holds the PFS designation", "3 CPAs on staff"]

  // Internal linking
  internal_links: Array<{
    url: string,                   // other page in confirmed sitemap
    anchor_text: string,
    reason: string                 // why this link makes sense here
  }>,

  // FAQ block (People Also Ask / featured snippets)
  faq_block: Array<{
    question: string,
    answer: string                 // 40-60 words, direct and specific
  }>,

  // LLM citation optimization
  llm_citation_note: string        // what structured claim on this page an AI tool is most likely to cite
}
```

---

## Pipeline Architecture

Processes pages sequentially (not parallel) to avoid rate limits and manage Claude output quality. Estimated 45–90 seconds per page for Sonnet.

```typescript
for (const page of approvedOutlines) {
  await supabase.from('generated_pages')
    .update({ generation_status: 'running' })
    .eq('id', page.id)

  const result = await generatePageContent(page, session, contentJob)
  const validation = validateContent(result.content)

  if (!validation.passed) {
    // One retry with flagged phrases added to prompt
    const retry = await generatePageContent(page, session, contentJob, validation.flagged)
    // Store retry result regardless
  }

  await supabase.from('generated_pages')
    .update({
      content_markdown: result.content,
      ...result.metadata,
      generation_status: 'complete'
    })
    .eq('id', page.id)
}
```

---

## Progress Tracking (Phase 5 Card)

Same polling pattern as Phase 3. `/api/content-jobs/[id]/generation-status` returns:
```typescript
{ total: number, complete: number, running: number, error: number }
```

The Phase 5 card shows a progress bar and a per-page status list updating every 5 seconds.

---

## Email Notification

When all pages reach `complete` or `error`:
- Send Resend email: `[CountingFive] Content ready for download — {firmName}`
- Advance `content_jobs.phase` to `6`

Create `emails/ContentReadyEmail.tsx`

---

## Files to Create

```
app/
  api/
    content-jobs/
      [id]/
        generate/
          route.ts              — POST trigger generation
        generation-status/
          route.ts              — GET polling
lib/
  content/
    content-generator.ts        — main generation loop
    anti-slop-validator.ts      — post-processing validation
    metadata-generator.ts       — SEO/AIO/GEO metadata builder
emails/
  ContentReadyEmail.tsx
components/
  content/
    GenerationPhase.tsx         — Phase 5 card with progress bar
```

---

## Test Process

1. Approve all outlines in Phase 4, click "Start Content Generation"
2. Watch Phase 5 card — confirm progress bar advances as pages complete
3. Check Supabase `generated_pages` — confirm `content_markdown` and all metadata fields are populated
4. Run anti-slop validator on generated content — confirm banned phrases are caught
5. Check a page's `faq_block` — confirm questions are specific to the firm's niche and keyword
6. Check `internal_links` — confirm they reference other pages in the confirmed sitemap
7. Confirm Resend email arrives when generation completes
8. Run `npx tsc --noEmit` — zero errors
