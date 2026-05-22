# Content Generation Pipeline — Overview & Reference

This document covers the full content generation system built in Steps 01–10. It is the companion reference for anyone operating, debugging, or extending the pipeline.

---

## 1. Process & Deliverables

### How It Works

After a client completes the onboarding chat and an admin approves the session, the content generation pipeline produces a complete website content package. The pipeline is a 6-phase, admin-gated workflow accessible at `/admin/content`.

### Phase Walkthrough

| Phase | Name | Type | What Happens |
|-------|------|------|-------------|
| 1 | **Color Palette** | Admin action | Extracts 6 colors from the uploaded logo using `node-vibrant`. If no logo exists, shows defaults. Admin edits swatches, verifies WCAG contrast, then locks the palette. |
| 2 | **Sitemap Confirm** | Admin action | Loads the proposed sitemap parsed from MFP Section 10B. Admin can add, remove, rename, and reorder pages. Confirming seeds `research_results`, `page_outlines`, and `generated_pages` rows for every page. |
| 3 | **Research** | Automatic | Runs in the background after sitemap confirmation. Per page: (1) Claude Haiku generates target + secondary keywords, (2) Serper validates the primary keyword and returns top 3 competitor URLs, (3) competitor pages are fetched and excerpted, (4) existing content is extracted from the current live site using the Section 10A redirect mapping. Batched 3 pages at a time. |
| 4 | **Outline Review** | Admin action | Claude Sonnet generates a structured outline per page (H1, H2 sections with descriptions and word counts). Admin reviews each outline — can edit, regenerate, or approve individually. Content generation is blocked until all outlines are approved. |
| 5 | **Content Generation** | Automatic | Claude Sonnet writes full page copy + SEO/AIO/GEO metadata for each approved outline. Runs sequentially. Anti-slop validator checks for banned phrases and auto-retries once if >2 are found. |
| 6 | **Deliverables** | Admin action | Assembles all generated content into a downloadable zip package. |

### What the Deliverable Package Contains

```
{firm-name}-content/
├── pages/
│   ├── home.md
│   ├── about.md
│   ├── about--our-story.md
│   ├── services--virtual-cfo-advisory.md
│   └── ... (one file per confirmed page)
├── {firm-name}-content.docx    — Word document with cover, TOC, all pages, metadata appendix
├── llms.txt                    — LLM-readable site index (llmstxt.org spec)
├── llms-full.txt               — Full content version of llms.txt
├── robots.txt                  — AI-crawler-friendly robots.txt
└── ERRORS.md                   — (only if pages failed) lists pages needing manual copy
```

**Per-page markdown files** include:
- YAML frontmatter (title, URL, meta title, meta description, keywords, canonical URL, schema markup type)
- Full page copy in markdown
- SEO & AIO metadata appendix (answer block, E-E-A-T signals, internal links, FAQ block, LLM citation note)

**Word document** includes:
- Cover page with firm name, date, "Prepared by CountingFive"
- Auto-generated table of contents
- All page content organized as chapters
- Metadata appendix table (meta title, description, keyword, URL per page)

---

## 2. Environment Variables

### Required for the pipeline to function

| Variable | Purpose | If missing |
|----------|---------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | App crashes on startup — proxy and all DB operations fail |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key for client-side auth | Login page breaks, admin auth fails |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — bypasses RLS for server-side data access | All API routes return errors. No data can be read or written. **Never expose client-side.** |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude calls | Keyword research (Phase 3), outline generation (Phase 4), and content generation (Phase 5) all fail. The onboarding chat agent also fails. |
| `NEXT_PUBLIC_APP_URL` | Base URL of the application (e.g., `http://localhost:3000` or `https://onboard.countingfive.com`) | Email notification links will be broken. CopyLinkButton will show relative paths on first render. |

### Required for specific features

| Variable | Purpose | If missing |
|----------|---------|-----------|
| `SERPER_API_KEY` | Serper.dev API key for Google SERP validation | Phase 3 keyword research still works (Claude generates keywords) but skips SERP validation and competitor URL discovery. Competitor analysis will have no data. |
| `RESEND_API_KEY` | Resend email service API key | All email notifications are silently skipped. Pipeline still functions — admin just won't receive "research complete" / "outlines ready" / "content ready" emails. |
| `RESEND_FROM_EMAIL` | Sender email address for Resend (must be verified in Resend dashboard) | Same as above — emails skip if either Resend variable is missing |
| `ADMIN_EMAIL` | Recipient address for pipeline notification emails | Falls back to `RESEND_FROM_EMAIL`. If both are missing, emails skip. |
| `CRON_SECRET` | Shared secret for Vercel cron job authentication | The inactivity reminder cron endpoint becomes accessible without auth. **Set a strong random value before deploying.** Currently empty = any request with `Bearer ` passes. |
| `BASECAMP_CLIENT_ID` | Basecamp OAuth client ID | Basecamp integration disabled. Session approval works but no Basecamp project is created. |
| `BASECAMP_CLIENT_SECRET` | Basecamp OAuth client secret | Same as above |
| `BASECAMP_ACCOUNT_ID` | Basecamp account ID for project creation | Same as above |

### Minimum viable `.env.local` for content generation

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
ANTHROPIC_API_KEY=your-anthropic-key
SERPER_API_KEY=your-serper-key
ADMIN_EMAIL=you@example.com
```

Email notifications, Basecamp, and cron are optional for local development.

---

## 3. Recommendations for Next Steps

### High Priority

1. **Rotate the Supabase service role key.** The current key has been in the local environment during development. Rotate it in the Supabase dashboard (Settings > API) and update `.env.local` and Vercel environment variables.

2. ~~Set `CRON_SECRET` to a strong random value~~ — **DONE in remediation Bundle 1.** Cron routes now fail closed (return 500) if `CRON_SECRET` is empty, in addition to the 401 on a mismatched header. Still set a strong value in production.

3. ~~Tighten RLS policies~~ — **DONE in remediation Bundle 1.** Migration `016_tighten_rls.sql` rewrites every policy to require admins-table membership. Prerequisite: seed your UUID into `admins` before applying the migration or you'll lock yourself out.

4. ~~Add Basecamp OAuth CSRF protection~~ — **DONE in remediation Bundle 1.** `/api/basecamp/auth` sets a state cookie; `/api/basecamp/callback` rejects on mismatch.

5. **Deploy to Vercel preview** and run the full 6-phase workflow end-to-end in the production environment. The `vercel.json` function timeouts are configured but need real-world verification.

### Medium Priority

6. **Add a "Regenerate All Outlines" button** to Phase 4 for cases where the admin wants to scrap all outlines and start fresh (e.g., after major schema data changes).

7. **Add individual page preview** in Phase 5/6 — let the admin click on a completed page to read the generated copy inline, before downloading the full package.

8. **Add a content editing UI** — after generation, let the admin edit individual page copy directly in the browser before packaging. Currently, edits require downloading, editing locally, and re-uploading.

9. **Track API costs.** Token usage is logged to the console but not persisted. Add a `token_usage` table or column to track cumulative cost per content job for billing visibility.

10. **Add a progress email for Phase 5** — content generation can take 20–40 minutes for a full site. A mid-progress email ("12 of 27 pages complete") would reduce admin anxiety.

### Lower Priority

11. **Implement drag-and-drop reordering** in the sitemap confirmation UI using `@dnd-kit/core`. The current UI supports add/remove/edit but not drag reordering.

12. **Add a "Download Individual Files" option** in Phase 6 — separate download links for llms.txt, robots.txt, and the Word document without downloading the full zip.

13. **Add content diff view** — when regenerating a page, show a before/after diff so the admin can see what changed.

14. **Batch approve outlines** — "Approve All" button for admin who has reviewed and is satisfied with all outlines.

15. **Add webhook notification option** — Slack or webhook integration as an alternative to email notifications.

---

## 4. Additional Reference

### Database Tables (Content Generation)

| Table | Purpose |
|-------|---------|
| `content_jobs` | One row per session. Tracks current phase, locked palette, confirmed sitemap, status. |
| `research_results` | One row per page. Stores keywords, competitor references, existing content, research status. |
| `page_outlines` | One row per page. Stores Claude-generated outline (H1, sections), admin approval state. |
| `generated_pages` | One row per page. Stores final copy, all SEO/AIO/GEO metadata, generation status. |

Migration file: `supabase/002_content_generation.sql`

### Key File Locations

| Category | Path |
|----------|------|
| Pipeline orchestration | `lib/content/research-pipeline.ts`, `lib/content/outline-generator.ts`, `lib/content/content-generator.ts` |
| Deliverable builders | `lib/content/deliverable-builder.ts`, `lib/content/docx-builder.ts`, `lib/content/llms-builder.ts`, `lib/content/robots-builder.ts`, `lib/content/zip-assembler.ts` |
| Anti-slop | `lib/content/anti-slop-validator.ts` |
| Token budgets | `lib/content/truncate-to-token-budget.ts` |
| Palette logic | `lib/content/palette-tone-signal.ts` |
| API routes | `app/api/content-jobs/[id]/*` (8 route files) |
| UI components | `components/content/*` (12 component files) |
| Admin pages | `app/admin/content/page.tsx` (hub), `app/admin/content/[id]/page.tsx` (workflow) |
| Auth helper | `lib/auth/require-admin.ts` |
| Type definitions | `types/palette.ts`, `types/session-schema.ts` (extended with `proposed_sitemap`, `current_sitemap`, `reputation`, `content_gaps`) |

### Token Budget Targets

| Pipeline Stage | Model | Target Input Tokens | Warning Threshold |
|---------------|-------|--------------------|--------------------|
| Keyword research | Haiku | 800 | 8,000 |
| Outline generation | Sonnet | 3,000 | 8,000 |
| Content generation | Sonnet | 5,000 | 8,000 |

Exceeding 8,000 input tokens on any call logs a warning. The `truncateToTokenBudget` utility is applied to competitor excerpts and existing content before they enter the prompt.

### Anti-Slop Banned Phrases

The full list is in `lib/content/anti-slop-validator.ts`. Key phrases: "navigate", "leverage", "seamless", "game-changer", "cutting-edge", "tailored solutions", "passionate about", "your trusted partner", "in conclusion". Content with >2 banned phrases triggers one automatic retry with the flagged phrases added to the prompt as explicit exclusions.

### Error Recovery Summary

| Failure Point | Recovery Behavior |
|--------------|-------------------|
| Research fetch fails for one page | Marked as `error`, pipeline continues. Phase completes when all rows are `complete` or `error`. |
| Outline JSON parse fails | Fallback outline stored: `{ h1: page_title, sections: [{ h2: 'Overview' }] }` with admin note requiring manual edit. |
| Content generation fails twice | Page marked `error`. Deliverable package skips it and includes `ERRORS.md`. |
| Research / generation job stuck >15 minutes | `/api/cron/sweep-stuck-jobs` runs every 5 minutes via Vercel cron and flips rows with `status = 'running'` and `created_at` older than 15 min to `error`. No admin action required. The earlier per-job `/status` endpoint also still detects stuck rows on demand. |
| Concurrent generation attempt on same page | The atomic guard in `lib/content/content-generator.ts → generateSinglePage()` updates the row to `running` only if it's not already running; the second caller gets `{ status: 'skipped' }`. No double-writes. |
| Resend email fails | Logged to console, pipeline continues unaffected. |
| Serper API unavailable | Keywords still generated by Claude, competitor analysis skipped. |

### Vercel Function Timeouts

| Route | Max Duration |
|-------|-------------|
| `content-jobs/[id]/generate` | 300 seconds (content generation for all pages) |
| `content-jobs/[id]/package` | 120 seconds (zip assembly + upload) |
| `content-jobs/[id]/outlines/generate` | 120 seconds (outline generation for all pages) |

All long-running routes declare `export const runtime = 'nodejs'`.
