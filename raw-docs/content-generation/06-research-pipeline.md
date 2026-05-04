# Step 06 — Research Pipeline (Phase 3)

Build the async research pipeline that runs keyword research, competitor analysis, and existing content extraction in parallel for every confirmed page. Admin gets an in-app status view and email notification when complete.

---

## What We're Building

A background research pipeline triggered when Phase 2 completes. Three research jobs run in parallel per page. Results are stored in `research_results`. Admin sees live status per page and gets a Resend email when all pages are done.

---

## Architecture

The pipeline is triggered server-side by the Phase 2 confirmation POST. Rather than a long-running HTTP connection, it uses a fire-and-forget pattern (same as the WHOIS lookup):

```typescript
// In /api/content-jobs/[id]/sitemap POST handler
runResearchPipeline(contentJobId, confirmedPages, session).catch(err =>
  console.error('[Research] Pipeline failed:', err)
)
```

The `runResearchPipeline` function processes pages in batches of 3 to avoid rate limits, updating each `research_results` row as it completes.

---

## Research Job 1 — Keyword Research

Per page:

1. **Claude draft phase** — call Claude Haiku with a focused prompt:
   - Input: page title, page URL, firm's services, locations, ICPs, niches (from `schema_data`)
   - Output: 1 primary keyword + 3-5 secondary keywords as JSON
   - Prompt note: "Generate realistic CPA-firm search terms a potential client in [location] would use. Prioritize local intent and service specificity over volume."

2. **Serper validation phase** — for the primary keyword only:
   - Call Serper `/search` with the keyword + location parameter
   - Extract: approximate result count (competition proxy), top 3 organic result URLs
   - Store these URLs as the competitor reference list for Job 2

```typescript
// research_results update after keyword job:
{
  target_keyword: string,
  secondary_keywords: string[],
  competitor_references: Array<{ url: string, title: string }>  // from SERP
}
```

---

## Research Job 2 — Competitor Page Analysis

For each competitor URL from the Serper results:

1. Fetch the page content using `lib/whois/lookup.ts` pattern (direct fetch, not Firecrawl — keep costs down for this use case)
2. Extract the main body text (strip nav, footer, sidebar via simple heuristic: take the longest contiguous text block)
3. Truncate to 800 tokens max per competitor page
4. Store as array in `competitor_references`:
   ```typescript
   { url: string, title: string, excerpt: string }
   ```

Limit: max 3 competitor pages per target keyword. If fetch fails, skip silently.

---

## Research Job 3 — Existing Content Extraction

Using `current_sitemap` from `schema_data`:

1. Find the current URL that maps to the proposed page URL (use the redirect table from Section 10A)
2. If a mapping exists, fetch that current page from the live site
3. Extract body text (same heuristic as Job 2)
4. Truncate to 1,200 tokens
5. Store in `research_results.existing_content`

If no mapping exists (new page with no current equivalent), leave `existing_content` as null.

---

## Status Tracking

Update `research_results.research_status` as each page progresses:
- `pending` → `running` → `complete` or `error`

The Phase 3 card polls `/api/content-jobs/[id]/research-status` every 5 seconds while any page is `running` or `pending`. Returns:
```typescript
{
  total: number,
  complete: number,
  running: number,
  error: number,
  pages: Array<{ url: string, title: string, status: string }>
}
```

---

## Email Notification

When all `research_results` rows for a job reach `complete` or `error`:

1. Send Resend email to `ADMIN_EMAIL` with subject: `[CountingFive] Research complete — {firmName}`
2. Body: count of pages researched, count of errors if any, direct link to `/admin/content/[id]`
3. Advance `content_jobs.phase` to `4`
4. Trigger outline generation (Step 07) automatically — outlines can start generating as soon as research is done

Create a new React Email template: `emails/ResearchCompleteEmail.tsx`

---

## Environment Variables Needed

```
SERPER_API_KEY=          # already used in audit pipeline
```

---

## Files to Create/Modify

```
app/
  api/
    content-jobs/
      [id]/
        research-status/
          route.ts          — GET polling endpoint
lib/
  content/
    research-pipeline.ts   — main orchestrator
    keyword-research.ts    — Job 1: Claude + Serper
    competitor-fetch.ts    — Job 2: fetch + extract
    existing-content.ts    — Job 3: current site fetch
emails/
  ResearchCompleteEmail.tsx
components/
  content/
    ResearchPhase.tsx       — Phase 3 card with live status grid
```

---

## Test Process

1. Complete Phase 2 on a test session — confirm `research_results` rows are created with `pending` status
2. Watch Phase 3 card — confirm status updates from `pending` → `running` → `complete` as pages process
3. Check Supabase: confirm `target_keyword`, `secondary_keywords`, `competitor_references`, and `existing_content` are populated for at least 3 pages
4. Confirm Resend email arrives when all research is complete
5. Confirm `content_jobs.phase` advances to `4` automatically
6. Simulate a fetch failure on one competitor page — confirm it's skipped gracefully without blocking the pipeline
7. Run `npx tsc --noEmit` — zero errors
