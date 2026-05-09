# Agent Context — CountingFive Content Generation Pipeline

Use this file to onboard a new AI coding agent quickly. Read this before touching any code.

---

## What This Project Is

A Next.js 15 app that onboards CPA firm clients via an AI chatbot, then generates a complete website content package from the collected data. Two major systems:

1. **Onboarding Chat** (already built) — 7-phase AI conversation that collects firm info, team details, services, niches, brand voice, and assets.
2. **Content Generation Pipeline** (Steps 01–10) — 6-phase admin workflow that turns onboarding data into website copy, SEO metadata, and deliverable files.

---

## Stack (Quick Reference)

| Layer | Tech |
|-------|------|
| Framework | Next.js 15, App Router, TypeScript strict |
| Database | Supabase (Postgres + RLS, service role key server-only) |
| Auth | Supabase Auth, admin-only via `lib/auth/require-admin.ts` |
| AI | Anthropic Claude via Vercel AI SDK (`ai`, `@ai-sdk/anthropic`) |
| Email | Resend + React Email |
| Storage | Supabase Storage (private `session-assets` bucket) |
| UI | Tailwind CSS + shadcn/ui, design system in `raw-docs/design.md` |
| Hosting | Vercel (function timeouts configured in `vercel.json`) |

---

## File Structure You Need to Know

```
app/
  admin/
    dashboard/          — Session list, content gen count badge
    sessions/[id]/      — Session detail (chat transcript + schema viewer)
    content/            — Content generation hub
    content/[id]/       — Per-session 6-phase workflow
  session/[id]/         — Client-facing chat (no auth required)
  api/
    chat/               — Streaming chat endpoint (Claude + tool calling)
    content-jobs/[id]/  — 12 routes for content pipeline (all require admin auth)
    palette/generate/   — Logo color extraction
    sessions/           — Session CRUD
    upload/             — File upload (presign + confirm)
    whois/              — Domain lookup
    cron/               — Scheduled jobs (require CRON_SECRET)
    basecamp/           — OAuth flow
    pdf/                — PDF generation

lib/
  auth/                 — require-admin.ts (shared auth guard)
  agent/                — Chat system prompt, phase instructions, gap list
  content/              — Content generation pipeline (13 files)
    research-pipeline.ts    — Orchestrates keyword + competitor + existing content research
    outline-generator.ts    — Claude Sonnet outline generation per page
    content-generator.ts    — Full page copy + SEO metadata generation
    anti-slop-validator.ts  — Banned phrase detection + auto-retry
    deliverable-builder.ts  — Per-page markdown files
    docx-builder.ts         — Word document assembly
    llms-builder.ts         — llms.txt + llms-full.txt
    robots-builder.ts       — AI-friendly robots.txt
    zip-assembler.ts        — Archiver-based zip packaging
    keyword-research.ts     — Claude Haiku + Serper SERP validation
    competitor-fetch.ts     — Page scraping + body text extraction
    palette-tone-signal.ts  — Derives tone note from palette colors
    truncate-to-token-budget.ts — Token budget enforcement utility
  mfp-parser/           — Parses Marketing Foundation Profile documents (Sections 1–10B)
  supabase/             — server.ts (service role), client.ts (anon key), proxy.ts
  basecamp/             — OAuth client + project creation
  pdf/                  — PDF generation components

components/
  content/              — 15 components for the 6-phase workflow UI
  admin/                — Dashboard components (SchemaViewer, ApproveButton, etc.)
  chat/                 — Client chat interface

types/
  session-schema.ts     — Canonical shape of all collected data
  palette.ts            — PaletteData type (6 swatches)
  database.ts           — Auto-generated Supabase types (DO NOT edit manually)
  gap-item.ts           — Gap list item type

supabase/
  001_initial_schema.sql  — Core tables (sessions, messages, assets, admins, etc.)
  002_content_generation.sql — Content tables (content_jobs, research_results, page_outlines, generated_pages)
```

---

## Content Generation Pipeline — How It Works

| Phase | Name | Trigger | Auto/Manual |
|-------|------|---------|-------------|
| 1 | Color Palette | Admin visits workflow page | Manual — admin locks palette |
| 2 | Sitemap Confirm | Admin locks palette | Manual — admin confirms page list |
| 3 | Research | Sitemap confirmed | Auto — runs in background, batches of 3 |
| 4 | Outline Review | Research completes | Auto-generates, then manual admin approval per page |
| 5 | Content Generation | Admin approves all outlines | Auto — sequential, ~60s per page |
| 6 | Deliverables | Content generation completes | Manual — admin clicks "Assemble & Download" |

Phase transitions happen via:
- Phase 1→2: `PalettePhase.tsx` PATCHes content-jobs with `{ palette, phase: 2 }`
- Phase 2→3: `sitemap/route.ts` POST sets `phase: 3`, fires `runResearchPipeline()`
- Phase 3→4: `research-pipeline.ts` sets `phase: 4`, fires `runOutlineGeneration()`
- Phase 4→5: `content-jobs/[id]/route.ts` PATCH detects `phase: 5`, fires `runContentGeneration()`
- Phase 5→6: `content-generator.ts` sets `phase: 6` when all pages done

---

## Critical Rules (Violations = Bugs)

1. **Service role key is server-only.** Never in `/app` client components. Verify: `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` must return zero.
2. **All admin API routes must call `requireAdmin()`** from `lib/auth/require-admin.ts` as their first action.
3. **Client-facing routes** (chat, upload, phase) validate session ID but don't require admin auth.
4. **`new Resend()` must be inside the handler**, not at module scope — module-scope instantiation crashes the production build.
5. **`export const runtime = 'nodejs'`** required on any route using `node-vibrant`, `whoiser`, `@react-pdf/renderer`, `archiver`, or `docx`.
6. **Processing flag** in the chat route uses atomic conditional update: `.eq('processing', false)` — never read-then-write.
7. **Phase advancement is server-validated.** Claude requesting `advancePhase: true` is a request, not a guarantee.
8. **Token budgets:** Keyword research 800, outlines 3000, content 5000. Warning at 8000. Use `truncateToTokenBudget()`.
9. **Anti-slop:** Content with >2 banned phrases auto-retries once. See `lib/content/anti-slop-validator.ts`.
10. **Types live in `types/`**, not exported from API route files.

---

## Database Tables

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `sessions` | id, website_url, status, current_phase, schema_data (JSONB), mfp_content, content_generation_phase | Core session data |
| `content_jobs` | id, session_id (unique), phase, palette (JSONB), confirmed_sitemap (JSONB), status | One per session |
| `research_results` | id, content_job_id, page_url, target_keyword, competitor_references, research_status | One per page |
| `page_outlines` | id, content_job_id, page_url, h1, sections (JSONB), admin_approved | One per page |
| `generated_pages` | id, content_job_id, page_url, content_markdown, meta_title, meta_description, faq_block, generation_status | One per page |

---

## Environment Variables

**Required:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_APP_URL`

**For content pipeline:** `SERPER_API_KEY` (keyword validation — pipeline works without it but skips SERP data)

**For notifications:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_EMAIL` (all optional — pipeline works without them, just no emails)

**For cron:** `CRON_SECRET` (must be set before production deploy)

---

## Testing Commands

```bash
npx tsc --noEmit                          # TypeScript — must be zero errors
npx tsx scripts/test-parser.ts            # Parser — 28/28 must pass
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app  # Security — must return nothing
npm run build                             # Production build — must succeed
```

---

## Common Patterns

**Adding a new admin API route:**
```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const supabase = createServerClient()
  // ... your logic
}
```

**Adding a new content pipeline phase component:**
1. Create `components/content/YourPhase.tsx` (client component)
2. Import in `PhaseStepper.tsx`, add to the phase switch
3. Pass any needed props through from `app/admin/content/[id]/page.tsx`

**Polling pattern (self-terminating):**
```typescript
useEffect(() => {
  let cancelled = false
  let intervalId: ReturnType<typeof setInterval>
  const poll = async () => {
    const res = await fetch(`/api/...`)
    if (cancelled || !res.ok) return
    const data = await res.json()
    setData(data)
    if (isDone(data)) clearInterval(intervalId)
  }
  poll()
  intervalId = setInterval(poll, 5000)
  return () => { cancelled = true; clearInterval(intervalId) }
}, [dependency])
```

---

## What Was Already Audited & Hardened

Two full code reviews were run (security + architecture). 19 fixes applied including:
- Auth guards on all admin routes
- Atomic processing flag
- Module-scope Resend crash fix
- Input sanitization (fileName, storagePath)
- Polling memory leak fixes
- Race condition protections (content job upsert, sitemap re-confirmation)
- Security headers
- Middleware renamed from proxy.ts
- Basecamp retry limit
- UUID validation on client-facing routes

Production build verified passing. All tests green. Pushed as commit `957338d`.
