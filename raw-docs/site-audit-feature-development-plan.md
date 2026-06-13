# Site Audit — Feature Development Plan

**Version:** 1.0
**Date:** 2026-06-12
**Owner:** Hank
**Target codebase:** `counting-five-onboarding` (Next.js 16 / React 19 / Supabase / Vercel)
**Audience:** Claude Code (implementation)

---

## 0. Purpose & Context

This plan ports the standalone **Counting Five Internal Audit** tool (currently a Claude Cowork skill — a ~120KB Python script `audit.py` that crawls a site, scores it across 10 categories, and emits a branded HTML report) into the existing `counting-five-onboarding` web application as a first-class, on-demand feature with saved history.

The source-of-truth spec for *what the audit checks and how it scores* is the original skill plan. Reproduce its logic faithfully — this plan does **not** restate every check. The authoritative references are:

- `Counting-Five-Internal-Audit/raw/internal-audit-skill-plan.md` — the full 10-category, ~80-check spec and scoring methodology.
- `Counting-Five-Internal-Audit/internal-audit.skill` — a zip containing `SKILL.md`, `references/audit_checks.md`, and `scripts/audit.py` (the working reference implementation). **Unzip this and keep `audit.py` open while porting** — it is the canonical behavior to match.
- `Counting-Five-Internal-Audit/reports/audit-stgcpas-com-2026-04-20.html` + `.json` — a real sample output to diff against for parity.

> **Before starting, copy these three reference files into `raw-docs/site-audit/reference/` in this repo** so they live alongside the code and can be used as test fixtures (see Step 1).

### What is being built

An **internal agency tool** (Counting Five staff only — no client-facing accounts) that lets an admin enter a URL, runs the full audit asynchronously in the background, persists every run to the database, renders a branded report in-app, and tracks score deltas across runs for the same site.

### Key decisions already made (do not relitigate)

| Decision | Choice | Rationale |
|---|---|---|
| **Audience** | Internal-only | Reuse existing `admins` auth; no new client tenancy. |
| **Persistence** | On-demand runs + full saved history | Enables score-delta tracking per site across engagements. |
| **Audit engine runtime** | **Port `audit.py` to TypeScript**, run in the existing async-job architecture | See §1 — keeps one codebase, no Python runtime on Vercel, reuses the proven `content-jobs` background pattern. A Python-microservice fallback is documented in §1.3 but is **not** the chosen path. |

---

## 1. Architecture Decision: How the Audit Engine Runs

### 1.1 The constraint

A full audit = crawl up to 50 pages + per-page HTML analysis + 2 PageSpeed Insights API calls (mobile + desktop) + scoring + report assembly. This is far too long for a single synchronous request and must run as a background job.

### 1.2 Chosen approach — TypeScript port on the existing job architecture

This repo **already solves this exact problem** for content generation. Reuse that machinery rather than inventing new infrastructure:

- **Background execution:** `after()` from `next/server` (see `app/api/content-jobs/[id]/generate/route.ts`) fires the job after the HTTP response returns.
- **Long jobs:** `export const runtime = 'nodejs'` + `export const maxDuration = 300` on the route, plus a `functions` entry in `vercel.json`.
- **Self-chaining across invocations:** for sites that exceed one function lifetime, the worker re-invokes its own route with `Authorization: Bearer ${CRON_SECRET}` (the `isInternalChain` pattern already in `generate/route.ts`). Audits will rarely need this at 50 pages, but the pattern is there if needed.
- **Status polling:** mirror `app/api/content-jobs/[id]/status/route.ts` — the UI polls a `/status` endpoint while `audit_status` transitions `queued → crawling → analyzing → scoring → rendering → complete | error`.
- **Atomic concurrency guard:** mirror `content-generator.ts` — flip `audit_status` to a running state only with a `.neq('audit_status', '<running>')` guard so a double-click can't start two runs for the same job.
- **Stuck-job recovery:** extend the existing `/api/cron/sweep-stuck-jobs` cron to also reset audit jobs stuck in a running state for >15 min to `error`. **Do not** write a separate recovery script (CLAUDE.md rule).

**Why port to TS rather than keep Python:** the project is a single TypeScript/Next app on Vercel with no Python runtime in production (`generate-overview-pdf.py` at repo root is a one-off local utility, not deployed). Introducing a Python service adds a second deploy target, a second language, and cross-service auth for no functional gain. Every dependency in `audit.py` has a mature Node equivalent (see §1.4).

### 1.3 Documented fallback (NOT the chosen path)

If, mid-implementation, the TS port of a specific subsystem proves disproportionately costly (most likely the Flesch-Kincaid readability and any HTML-heuristic parsing), the fallback is to stand up `audit.py` behind a minimal FastAPI service on Railway/Render and have the Next worker call it over HTTP with a shared secret. Treat this as a last resort for an isolated subsystem, not the whole engine. **Flag it to Hank before taking this path.**

### 1.4 Python → Node dependency map (for the port)

| `audit.py` uses | Node/TS replacement | Notes |
|---|---|---|
| `requests` | `fetch` (built-in) / `undici` | Set timeouts; capture status codes + headers. |
| `BeautifulSoup` | `cheerio` | DOM parsing for titles, meta, headings, alt text, OG/Twitter tags, schema blocks, analytics snippets. |
| `textstat.flesch_kincaid_grade` | `text-readability` (npm) | Verify parity against `audit.py` on the same text; FK is a deterministic formula. |
| PageSpeed Insights API | `fetch` to the same Google endpoint | Free, no key for basic use. Add an optional `PAGESPEED_API_KEY` env to raise rate limits. |
| `site:` Google index check | existing crawl/search approach | Keep behavior parity; if no search tool, mark "Unable to verify" (audit.py already degrades gracefully). |
| robots.txt / sitemap.xml / llms.txt fetch | `fetch` | Direct GETs, same as `audit.py`. |
| SSL/cert expiry (`check_ssl`) | Node `tls` module | Connect, read `getPeerCertificate()`, compute days-to-expiry. |
| HTML report (`render_html`) | **React + Tailwind in-app** + `@react-pdf/renderer` for PDF | Do **not** port the Python string-template HTML. Re-render from stored JSON using the design system (§6). |
| Firecrawl MCP (optional crawler) | Optional: keep a Firecrawl path if an API key is present; otherwise the built-in `fetch`+`cheerio` crawler is the default | `audit.py` already treats Firecrawl as optional with a Python fallback. |

**Parity principle:** the scoring math (`SCORING_WEIGHTS`, `GRADE_SCALE`, `score_category`, `compute_scores`, `compute_overall`) must be ported **exactly**. These are pure functions — port them 1:1 and cover them with unit tests that reproduce the sample report's numbers.

```
SCORING_WEIGHTS = { performance:0.20, technical:0.15, onpage_seo:0.15,
                    ux:0.10, content:0.10, indexability:0.10, schema:0.10,
                    ai_llm:0.05, analytics:0.05 }
GRADE_SCALE     = A≥90, B≥80, C≥70, D≥60, F<60
```

---

## 2. Conventions This Plan Inherits (read `CLAUDE.md` first)

Claude Code must follow the existing project rules without exception. The ones most relevant to this feature:

1. **Service role key is server-only.** All audit DB/storage writes use `lib/supabase/server.ts` in API routes only. Run `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` before every commit (expect zero matches).
2. **Auth gating.** Audit routes are admin tools → gate with `requireAdminUser()` from `lib/auth/access.ts` as the first line. The internal self-chain path uses `Bearer ${CRON_SECRET}` exactly like `generate/route.ts`.
3. **CRON_SECRET fails closed.** Any cron or internal-chain check must 500 if the secret is empty (never let `Bearer undefined` validate).
4. **UUID primary keys only** (`gen_random_uuid()`) — no sequential IDs on audit tables.
5. **Never write raw SQL in app code.** Use the Supabase JS client + generated `types/database.ts`. Use `asJson()` from `lib/supabase/json-typed.ts` for JSONB writes.
6. **Regenerate types after every migration:** `npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts`.
7. **No `console.log`** in `app`/`lib` (use `console.warn`/`console.error`); no `localStorage`/`sessionStorage`; no `as any`.
8. **`@react-pdf/renderer` and `tls`/network code require `export const runtime = 'nodejs'`** — never Edge.
9. **Design system is mandatory.** Read `raw-docs/design.md`. Brand colors via tokens only (`brand-cyan #00C1DE`, `brand-navy #003B71`), Inter/Open Sans, pill buttons, navy-tinted shadows. Do **not** reuse the `audit.py` color palette (`#1A1A2E/#E94560` etc.) — that was the standalone tool's theme; the in-app report must use Counting Five tokens.
10. **Migrations** are numbered SQL files in `supabase/` — the latest is `033_content_edit_origin.sql`, so this feature starts at **`034_`**.

After every file change: `npx tsc --noEmit`. After each step: run that step's Test Process.

---

## 3. Data Model (Migration `034`)

Two tables, mirroring the `content_jobs` shape and its status/guard conventions. A "site" is identified by its normalized domain so multiple runs can be grouped for delta tracking.

### 3.1 `audit_runs`

One row per audit execution.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK `default gen_random_uuid()` | |
| `created_by` | `uuid` | FK → `admins.id`. Who triggered it. |
| `url` | `text not null` | The exact URL submitted. |
| `domain` | `text not null` | Normalized host (lowercased, no `www.`, no trailing slash). Group key for deltas. Index this. |
| `site_name` | `text` | Optional human label for the report header. |
| `max_pages` | `int not null default 50` | Crawl cap. |
| `focus_segments` | `text[]` | Optional customer segments to check content against. |
| `audit_status` | `text not null default 'queued'` | `queued`/`crawling`/`analyzing`/`scoring`/`rendering`/`complete`/`error`. |
| `status_detail` | `text` | Human-readable progress line for the UI. |
| `started_at` | `timestamptz` | |
| `completed_at` | `timestamptz` | |
| `overall_score` | `int` | 0–100, null until complete. |
| `overall_grade` | `text` | A–F. |
| `category_scores` | `jsonb` | `{ performance:{score,grade}, technical:{...}, ... }`. |
| `result` | `jsonb` | Full structured result: per-page analysis, findings, recommendations, crawl errors, raw PSI. The single source the report renders from. |
| `error_message` | `text` | Set when `audit_status='error'`. |
| `pages_crawled` | `int` | |
| `created_at` | `timestamptz default now()` | |

> **Design note:** store the full result as JSONB (`result`) typed via a new `types/audit-result.ts` interface (do **not** use `any`). This mirrors how `sessions.schema_data` is typed as `SessionSchema`. The report is always re-rendered from this JSON — never stored as pre-baked HTML.

### 3.2 Optional: `audit_run` ↔ `sessions` link

This tool is independent of onboarding sessions, but Counting Five may want to audit a prospect's current site during onboarding. Add a **nullable** `session_id uuid` FK on `audit_runs` (no cascade requirement). Leave it null for standalone audits. This is cheap to add now and avoids a later migration.

### 3.3 RLS

Follow the repo's pattern (migration `016` tightened RLS; app code uses the service-role client and enforces access in-app for admin tools). Add RLS policies requiring `admins` membership for direct access, consistent with every other table. Manager scoping (`manager_clients`) is **not** required for v1 — audits are admin-only. If managers should see audits later, gate with `requireAdminUser()` now and revisit.

### 3.4 Type definitions

- `types/audit-result.ts` — `AuditResult`, `CategoryScore`, `PageAnalysis`, `Finding`, `Recommendation`, `CrawlError`. Port these shapes from the keys `audit.py` writes into its JSON (diff against `audit-stgcpas-com-2026-04-20.json`).
- Regenerate `types/database.ts` after the migration applies.

---

## 4. The Audit Engine (`lib/audit/`)

Pure, framework-free TypeScript so it is unit-testable without Next/Supabase. One module per concern, mirroring `audit.py`'s function groups.

```
lib/audit/
  index.ts                # runAudit(input): orchestration entrypoint (returns AuditResult)
  crawl.ts                # crawlSite(startUrl, maxPages) → pages[]  (audit.py: crawl_site, normalize_url, same_domain, safe_get)
  fetch-meta.ts           # fetchRobots, fetchSitemap, fetchLlmsTxt  (audit.py: fetch_robots/_sitemap/_llms_txt)
  ssl.ts                  # checkSsl(baseUrl) via node:tls           (audit.py: check_ssl)
  pagespeed.ts            # checkPageSpeed(url, strategy)            (audit.py: check_pagespeed)
  analyze-page.ts         # analyzePage(page) → PageAnalysis         (audit.py: analyze_page, count_words, flesch_kincaid_grade)
  scoring.ts              # scoreCategory, computeScores, computeOverall, getGrade  (PORT EXACTLY)
  recommendations.ts      # generateRecommendations, pageIssues, suggestTitle, suggestMeta
  constants.ts            # SCORING_WEIGHTS, GRADE_SCALE, thresholds, target metrics
  firecrawl.ts            # optional: crawl via Firecrawl if FIRECRAWL_API_KEY present, else no-op
  types.ts                # re-export from types/audit-result.ts
```

### 4.1 Build order within the engine

1. `constants.ts` + `scoring.ts` (+ `getGrade`) — **port first, test first.** Pure math; lock parity against the sample JSON before anything else.
2. `crawl.ts` — `fetch`+`cheerio`, same-domain BFS, `max_pages` cap, status-code capture, redirect-chain detection, graceful per-page error logging (push to `crawlErrors`, never throw).
3. `fetch-meta.ts`, `ssl.ts`, `pagespeed.ts` — independent fetchers; each degrades to a "could not verify" result on failure (parity with `audit.py`).
4. `analyze-page.ts` — per-page checks feeding categories: technical, on-page SEO, content, schema, AI/LLM readiness, UX/accessibility, analytics detection.
5. `recommendations.ts` — priority-ranked (Critical/Warning), with effort + impact estimates.
6. `index.ts` — orchestrates: crawl → fetch meta/ssl/psi → analyze pages → compute scores → generate recs → assemble `AuditResult`. Accepts a progress callback so the worker can update `status_detail`/`audit_status` as it advances.

### 4.2 Orchestration contract

```ts
// lib/audit/index.ts
export interface RunAuditInput {
  url: string
  siteName?: string
  maxPages?: number          // default 50
  focusSegments?: string[]
  onProgress?: (stage: AuditStage, detail: string) => Promise<void>
}
export async function runAudit(input: RunAuditInput): Promise<AuditResult>
```

`runAudit` must be **pure with respect to the DB** — it knows nothing about Supabase. The worker (§5) owns all persistence and calls `onProgress` to write status. This keeps the engine unit-testable and matches how `lib/content/` separates generation logic from routes.

### 4.3 Error handling (parity with `audit.py`)

- A failed page fetch → logged crawl error, continue.
- PSI rate-limited/unavailable → category scored on what's available; mark metric "Unable to verify."
- A check that genuinely can't run → "Unable to verify" rather than a 0 that tanks the score.
- The crawl is hard-capped at `maxPages`; note the cap in the result.

---

## 5. API Routes & Background Worker (`app/api/audits/`)

Mirror the `content-jobs` route family exactly.

```
app/api/audits/
  route.ts                       # POST create audit_run (admin); GET list (admin, paginated)
  [id]/route.ts                  # GET one run (full result); DELETE a run
  [id]/run/route.ts              # POST kick off background execution (after()); also the self-chain target
  [id]/status/route.ts           # GET lightweight status poll (audit_status, status_detail, pages_crawled)
```

### 5.1 `POST /api/audits` — create

- Gate: `requireAdminUser()` first.
- Validate body with `zod`: `{ url: string(url), siteName?: string, maxPages?: int 1..100, focusSegments?: string[] }`.
- Normalize `url` → `domain`.
- Insert `audit_runs` row (`audit_status='queued'`, `created_by = currentUser.id`).
- Return `{ id }`. Do **not** run the audit here.

### 5.2 `POST /api/audits/[id]/run` — execute

- Copy the dual-auth pattern from `content-jobs/[id]/generate/route.ts`: admin session **or** `Bearer ${CRON_SECRET}` internal chain.
- `export const runtime = 'nodejs'`; `export const maxDuration = 300`.
- Atomic guard: update `audit_status` to `'crawling'` only if it is not already in a running state (`.neq(...)`). If the guard matches nothing, return `{ status: 'skipped' }`.
- `after(async () => { await runAuditJob(id) })` — the worker in `lib/audit/worker.ts`.
- Return `{ success: true }` immediately.

### 5.3 `lib/audit/worker.ts` — the bridge between route and engine

- Loads the `audit_runs` row, calls `runAudit()` with an `onProgress` that writes `audit_status`/`status_detail`/`pages_crawled` to the row.
- On success: write `result`, `category_scores`, `overall_score`, `overall_grade`, `pages_crawled`, `completed_at`, set `audit_status='complete'`.
- On throw: set `audit_status='error'`, `error_message`, `completed_at`. Always clear running state in a `finally` (same discipline as the `processing` flag rule in CLAUDE.md).

### 5.4 `vercel.json`

Add a `functions` entry:

```json
"app/api/audits/[id]/run/route.ts": { "maxDuration": 300 }
```

### 5.5 Stuck-job sweep

Extend `app/api/cron/sweep-stuck-jobs/route.ts`: any `audit_runs` in a running state with `started_at` older than 15 min → set `audit_status='error'`, `error_message='Timed out'`. Keep the existing CRON_SECRET gate.

---

## 6. Report Rendering (in-app, design-system-compliant)

The standalone tool emitted a self-contained HTML file. In-app, render from the stored `result` JSON using React + the Counting Five design system. **Read `raw-docs/design.md` before writing any of this UI.**

### 6.1 Pages

```
app/admin/audits/
  page.tsx                 # list of past runs: site, date, overall grade, score delta vs previous run
  new/page.tsx             # the "run an audit" form (URL, site name, max pages, segments)
  [id]/page.tsx            # the full report (server component; loads result, signs nothing — no storage needed)
```

Add an "Audits" entry to the admin nav alongside Dashboard/Sessions/Content/Settings.

### 6.2 Report components (`components/admin/audit/`)

Re-create the sample report's sections (see `audit-stgcpas-com-2026-04-20.html` for layout intent, **not** styling):

1. **Header** — CountingFive logo (use the white logo asset already in the repo), site name, URL, run date, "Snapshot Report" badge.
2. **Executive summary** — large overall score + letter grade, score ring/dial, one-line verdict, top 3 critical findings.
3. **Score dashboard** — grid of all 9 scored categories with grade badges.
4. **Per-category sections** — score + grade, findings table (check / status / detail), top quick wins.
5. **Page inventory** — sortable table: URL, title, status code, index status, H1 present, schema present, word count.
6. **Recommendations** — master list sorted Critical → Warning, each with effort (L/M/H) + impact.
7. **Score-delta panel** (new capability) — if a prior run exists for this `domain`, show per-category and overall change since last run (▲/▼ with color from `success`/`error` tokens).
8. **Footer** — "Audit generated by Counting Five" + date.

All visuals via design tokens — grade badge colors map to the existing `success`/`warning`/`error`/`info` tokens, **not** raw Tailwind `text-red-*` etc. (CLAUDE.md "Do Not" rule).

### 6.3 PDF export (reuse existing stack)

`@react-pdf/renderer` is already a dependency with an established pattern in `lib/pdf/`. Add `lib/pdf/audit-report.tsx` + an `app/api/audits/[id]/pdf/route.ts` (`runtime = 'nodejs'`) that renders the report to PDF and streams it for download. Storing the PDF in Supabase Storage is optional for v1 — generate on demand. If stored later, follow the private-bucket + signed-URL rules.

---

## 7. Step-by-Step Build Sequence

Each step is independently shippable and testable. Do them in order; run `npx tsc --noEmit` + the step's tests before moving on. This mirrors the `raw-docs/dev-steps/` cadence — if Hank prefers, each step below can be split into its own `raw-docs/dev-steps/NN-*.md` file later.

### Step 1 — Reference import & scaffolding
- Copy the three reference files (§0) into `raw-docs/site-audit/reference/`.
- Unzip `internal-audit.skill`; place `audit.py` and `audit_checks.md` in the reference folder.
- Create empty `lib/audit/` module files (§4) and `types/audit-result.ts` with stubbed interfaces.
- **Test:** `npx tsc --noEmit` passes with stubs.

### Step 2 — Database (migration `034`)
- Write `supabase/034_site_audit.sql` (tables, indexes on `domain` and `created_at`, RLS, optional nullable `session_id`).
- Apply it; regenerate `types/database.ts`.
- **Test:** insert a dummy row via Supabase SQL editor; confirm it appears typed in `types/database.ts`.

### Step 3 — Scoring core (port-first, the parity anchor)
- Port `constants.ts` + `scoring.ts` (`scoreCategory`, `computeScores`, `computeOverall`, `getGrade`) 1:1 from `audit.py`.
- **Test (vitest):** feed the per-page analysis arrays from `audit-stgcpas-com-2026-04-20.json` into `computeScores`/`computeOverall` and assert the output equals the `overall_score`, `overall_grade`, and `category_scores` in that JSON. This is the single most important test — it locks parity.

### Step 4 — Crawler
- Implement `crawl.ts` (`fetch`+`cheerio`, same-domain BFS, status codes, redirect chains, `maxPages` cap, error collection).
- **Test:** crawl `https://books.toscrape.com` (the existing sample target) with `maxPages=10`; assert page count, captured status codes, and zero thrown errors on a dead link.

### Step 5 — Independent fetchers
- `fetch-meta.ts` (robots/sitemap/llms.txt), `ssl.ts` (`node:tls`), `pagespeed.ts` (Google PSI).
- **Test:** unit-test each against a known site; assert graceful degradation when PSI is unavailable (returns "unable to verify", not a throw). Add `PAGESPEED_API_KEY` to `.env.example` (optional).

### Step 6 — Page analysis
- `analyze-page.ts` — all per-page category checks (technical, on-page SEO, content + FK readability, schema detection, AI/LLM readiness, UX/accessibility, analytics detection).
- **Test:** run on a saved HTML fixture; assert detected title/meta/H1/alt/OG/schema/analytics match hand-verified expectations. Verify `text-readability` FK output matches `textstat` on identical text (±0 ideally).

### Step 7 — Recommendations + orchestration
- `recommendations.ts` + `index.ts runAudit()` with `onProgress`.
- **Test:** `runAudit({ url: 'https://books.toscrape.com', maxPages: 10 })` returns a complete `AuditResult`; scores are sane; recommendations sorted Critical → Warning.

### Step 8 — API routes + worker
- `app/api/audits/route.ts`, `[id]/route.ts`, `[id]/run/route.ts`, `[id]/status/route.ts`; `lib/audit/worker.ts`; `vercel.json` function entry.
- Wire dual-auth, zod validation, atomic guard, `after()` execution, status writes.
- **Test:** as an admin, `POST /api/audits` then `POST /api/audits/[id]/run`; poll `/status` until `complete`; confirm `result` persisted. Confirm a non-admin gets 401/403. Confirm double-`run` returns `skipped`.

### Step 9 — Report UI
- `app/admin/audits/` pages + `components/admin/audit/` report components + nav entry, all on design tokens.
- Score-delta panel querying prior runs by `domain`.
- **Test:** open a completed run; verify all 7+ sections render; verify a second run on the same domain shows deltas; run the design.md Component Checklist.

### Step 10 — PDF export
- `lib/pdf/audit-report.tsx` + `app/api/audits/[id]/pdf/route.ts` (`runtime='nodejs'`).
- **Test:** download a PDF for a completed run; verify it opens and matches the on-screen report.

### Step 11 — Cron hardening + final pass
- Extend `sweep-stuck-jobs` for audit jobs.
- **Test/checklist:**
  - `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` → zero matches.
  - `grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx"` → zero matches.
  - `npx tsc --noEmit` clean; `npm run lint` clean; `npm run test` green.
  - No raw hex / no `text-red-*` etc. in the new UI.
  - A full audit of `stgcpas.com` reproduces scores within rounding tolerance of the sample report.

---

## 8. Environment Variables (additions)

Add to `.env.example` and Vercel:

```
PAGESPEED_API_KEY=          # optional — raises Google PSI rate limits
FIRECRAWL_API_KEY=          # optional — enables Firecrawl crawl path; falls back to built-in crawler if absent
```

Already present and reused: `SUPABASE_*`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`.

---

## 9. Out of Scope for v1 (backlog)

- Client-facing access / lead-gen teaser reports (audience decision = internal-only).
- Scheduled/recurring auto-audits (the `schedule` capability) — easy to add later via a cron that POSTs `/api/audits` for a saved list of domains.
- Competitor benchmarking (side-by-side multi-domain scoring).
- Google Search Console integration for real impression/click data.
- CMS detection + CMS-specific recommendations.
- Emailing reports to clients via Resend (the dependency exists; defer until client-facing is in scope).

---

## 10. Risks & Watch-Items

- **Scoring parity drift.** The single biggest correctness risk. Step 3's parity test against the sample JSON is the guardrail — do not skip it, and re-run it after any change to analysis logic (an analysis change shifts the inputs to scoring).
- **PSI rate limits / latency.** Two PSI calls per audit (mobile + desktop) on the home + top pages. Cache nothing for v1, but expect 10–30s of PSI wall-time; the background-job architecture absorbs this. Add `PAGESPEED_API_KEY` if rate-limited.
- **Crawl politeness.** Respect `robots.txt`; cap concurrency and `maxPages`; set a descriptive User-Agent. Avoid hammering a prospect's site.
- **SPA/JS-rendered sites.** The `fetch`+`cheerio` crawler sees server HTML only. For React/Vue/Angular SPAs, results undercount content — surface a note in the report and recommend the optional Firecrawl path (parity with `audit.py`'s guidance).
- **Function timeout on large sites.** 50 pages + PSI should fit in 300s. If a target genuinely exceeds it, lean on the self-chaining pattern already proven in `content-jobs` rather than raising limits indefinitely.
- **FK readability library parity.** Validate `text-readability` against `textstat` early (Step 6); if they diverge materially, pin the formula manually rather than trusting the lib.

---

## 11. Definition of Done

- An admin can submit a URL, watch live status, and view a branded, design-system-compliant report in-app.
- Every run is persisted; the audits list shows history with score deltas per domain.
- A PDF of any completed run can be downloaded.
- Full audit of `stgcpas.com` reproduces the reference report's scores within rounding tolerance.
- All CLAUDE.md security/architecture/type/design rules pass their grep + checklist gates; `tsc`, lint, and tests are green.
```
