# Step 07 — Outline Generation & Review (Phase 4)

Generate per-page outlines using Claude and present them to the admin for approval, editing, or regeneration. No copy is written until all outlines are approved.

---

## What We're Building

An outline generation job that runs automatically after Phase 3 completes, and an admin review UI where each page outline can be approved, edited, or regenerated individually.

---

## Outline Generation

Triggered automatically when research pipeline completes (end of Step 06). Runs per page using Claude Sonnet.

### System Prompt

```
You are a website content strategist for a CPA firm. Generate a structured page outline — not copy, just structure.

FIRM CONTEXT:
{brand_voice} {positioning_option} {differentiators} {niches} {palette_tone_signal}

PAGE: {page_title} ({page_url})
TARGET KEYWORD: {target_keyword}
SECONDARY KEYWORDS: {secondary_keywords}

EXISTING CONTENT (current site — improve on this):
{existing_content}

COMPETITOR REFERENCES (SERP top results — differentiate from these):
{competitor_excerpts}

OUTPUT FORMAT (JSON only, no prose):
{
  "h1": "...",
  "sections": [
    { "h2": "...", "description": "One sentence: what this section covers and why it matters for this audience.", "word_count": 150 }
  ],
  "target_keyword": "...",
  "notes": "Optional: anything the copywriter should know about tone or angle for this page."
}

RULES:
- 4–7 sections per page (fewer for simple pages, more for comprehensive service pages)
- H1 must contain or closely relate to the target keyword
- Section descriptions are for the copywriter — be specific about angle, not just topic
- Word counts should total 600–1200 words for standard pages, 1500–2000 for pillar pages
- Do not write any actual copy — structure only
```

### Palette Tone Signal

Derive a 1-sentence tone note from the locked palette:
- Warm palette (reds/oranges/yellows) → "The brand palette is warm and energetic — copy should feel approachable and action-oriented"
- Cool palette (blues/greens) → "The brand palette is cool and professional — copy should feel trustworthy and measured"
- High contrast → "The brand uses high-contrast colors — copy can be bold and direct"

Use chroma.js temperature analysis on the primary color to determine warm vs. cool.

---

## Outline Review UI (Phase 4 Card)

Client component. Displays all page outlines as an expandable card list.

Per outline card:
- Page title + URL (header, always visible)
- Status badge: Pending / Approved / Needs Revision
- Expand/collapse toggle
- When expanded:
  - **H1** — editable text input
  - **Sections table** — rows of: H2 (editable) | Description (editable) | Word count (number input)
  - Add section / remove section buttons
  - **Target keyword** — read-only (from research)
  - **Notes** — editable textarea
  - Action buttons: "Approve" | "Regenerate" | "Save Edits"

**Progress bar** at top: "14 of 23 pages approved"

"Start Content Generation →" button:
- Disabled until all outlines are approved
- On click: advances `content_jobs.phase` to `5`, triggers content generation pipeline (Step 08)

---

## API Routes

```
GET  /api/content-jobs/[id]/outlines          — load all outlines for a job
POST /api/content-jobs/[id]/outlines/generate — trigger outline generation for all pages
PATCH /api/content-jobs/[id]/outlines/[pageId] — save edits or approve a single outline
POST /api/content-jobs/[id]/outlines/[pageId]/regenerate — regenerate one outline
```

---

## Email Notification

When all outlines are generated and ready for review:
- Send Resend email: `[CountingFive] Outlines ready for review — {firmName}`
- Body: page count, link to `/admin/content/[id]`

Create `emails/OutlinesReadyEmail.tsx`

---

## Files to Create

```
app/
  api/
    content-jobs/
      [id]/
        outlines/
          route.ts              — GET + POST
          generate/
            route.ts            — trigger generation
          [pageId]/
            route.ts            — PATCH single outline
            regenerate/
              route.ts          — POST regenerate
lib/
  content/
    outline-generator.ts        — Claude outline generation logic
    palette-tone-signal.ts      — derive tone note from palette
emails/
  OutlinesReadyEmail.tsx
components/
  content/
    OutlinePhase.tsx            — Phase 4 card (client component)
    OutlineCard.tsx             — per-page outline card
    OutlineSectionRow.tsx       — editable section row
```

---

## Test Process

1. Complete Phase 3 — confirm outline generation triggers automatically
2. Check Supabase `page_outlines` — confirm rows have h1 and sections populated for all pages
3. Load Phase 4 card — confirm all outlines appear as expandable cards
4. Edit an H2 inline — confirm save works without full reload
5. Click "Regenerate" on one outline — confirm it re-calls Claude and updates the card
6. Approve all outlines — confirm "Start Content Generation" button becomes enabled
7. Confirm Resend email arrives when outlines are ready
8. Run `npx tsc --noEmit` — zero errors
