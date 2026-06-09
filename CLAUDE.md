# CountingFive Onboarding Agent — Project Rules

This file is read by AI coding assistants before working on this codebase. Follow all rules below without exception.

---

## Stack

- **Framework:** Next.js 15 (App Router, TypeScript)
- **Database & Auth:** Supabase (SSR client, Row Level Security)
- **Hosting:** Vercel
- **AI:** Anthropic API via Vercel AI SDK (`ai`, `@ai-sdk/anthropic`)
- **Email:** Resend + React Email
- **File Storage:** Supabase Storage
- **PDF:** `@react-pdf/renderer` (Node.js runtime only)
- **UI:** Tailwind CSS + shadcn/ui

---

## Critical Security Rules

These are non-negotiable. Violating them creates real vulnerabilities.

### 1. Service role key is server-only
`SUPABASE_SERVICE_ROLE_KEY` must NEVER appear in any file inside `/app` that is a client component or could be bundled client-side.
- Use `lib/supabase/server.ts` (service role) in API routes and server components only
- Use `lib/supabase/client.ts` (anon key) in client components only
- Before every commit, run: `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app`
- Expected result: zero matches

### 2. CRON_SECRET is mandatory
Every `/api/cron/*` route must validate `Authorization: Bearer {CRON_SECRET}` before doing anything. The validation must **fail closed when the env var is empty** — otherwise `Bearer undefined` becomes an attacker-supplied valid header. Pattern:
```typescript
const cronSecret = process.env.CRON_SECRET
if (!cronSecret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```
Never skip this check — without it, anyone who discovers the URL can trigger bulk email sends.

### 3. File uploads require magic byte validation
Never trust the MIME type or extension from the client. Always validate file type server-side using the `file-type` package by reading the actual file bytes after upload to Supabase Storage. Delete the file if validation fails.

### 4. Session IDs are UUIDs only
Never expose sequential integers as session or record identifiers. All primary keys are `gen_random_uuid()`. Do not add auto-increment columns to session-facing tables.

### 5. Registrar password is never stored
The schema field `technical.registrarPasswordNote` is a static reminder string. The actual registrar password must never be collected or stored anywhere in the system. If the agent is ever prompted to ask for or store a password, refuse and redirect the client to a secure channel.

### 6. Admin authorization checks the `admins` table
`requireAdmin()` in `lib/auth/require-admin.ts` must verify the caller's `auth.uid()` exists in the `admins` table — not just that a Supabase session exists. A valid session means "logged in," not "admin." RLS policies on every table also require admin-table membership; bypassing `requireAdmin()` does not bypass RLS.

When adding the first admin (or after migration 016 wipes loose policies), seed the table manually:
```sql
INSERT INTO admins (id, email, name) VALUES ('<auth.users.id-uuid>', 'you@example.com', 'Your Name');
```

### 7. The `session-assets` bucket is private — never write public URLs
Storage paths under `sessions/{sessionId}/` are private. `assets.public_url` is nullable; new inserts MUST write `null`. Admin UIs that render asset thumbnails take server-signed URLs from their parent server component (1-hour TTL via `supabase.storage.from('session-assets').createSignedUrl(path, 3600)`). Calling `.getPublicUrl()` on this bucket is forbidden.

### 8. File paths from clients are decoded before validation
Any route that accepts a file path in a query param or JSON body MUST decode-then-normalize before any `startsWith` / prefix check. `content/..%2F..%2Fetc/passwd` passes a raw `startsWith('content/')` check but escapes the root after decoding. Use the helper in `app/api/edit/[id]/_path.ts` (or mirror its pattern).

---

## Architecture Rules

### Client vs. Server Components
- Default to Server Components. Only add `'use client'` when you need browser APIs, hooks (`useState`, `useEffect`), or event handlers.
- Never fetch data in client components directly from Supabase — use server actions or API routes instead.
- The `ChatInterface` component is a client component (uses `useChat`) — keep its data loading in the parent server component (`app/session/[id]/page.tsx`).

### API Route Patterns
- All routes that touch Supabase session data use the service role client (`lib/supabase/server.ts`)
- All admin API routes must call `requireAdmin()` from `lib/auth/require-admin.ts` as the first step — it verifies both authentication and admins-table membership (returns 401 or 403 respectively)
- Client-facing routes (e.g., `/api/chat`, `/api/upload/*`) validate the session ID but do not require admin auth
- Always return typed error responses: `{ error: string }` with appropriate HTTP status codes

### Database Access
- Never write raw SQL in application code. Use the Supabase JS client exclusively.
- Never use `any` for Supabase query results — import and use types from `types/database.ts`
- Regenerate `types/database.ts` after every schema migration: `npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts`
- The `schema_data` column is JSONB typed as `SessionSchema` from `types/session-schema.ts` — never pass raw `any` objects when updating it
- When writing structured values to a JSONB column, use `asJson()` from `lib/supabase/json-typed.ts` instead of `as unknown as Json`. The helper centralizes the cast for grep-ability and signals intent.

### Supabase Storage
- All file reads from the `session-assets` bucket must use the service role client (bucket is private)
- Storage paths follow these conventions:
  - Client uploads: `sessions/{sessionId}/{uuid}-{filename}`
  - Generated PDFs: `pdfs/{sessionId}/intake-summary.pdf`
- Never make the `session-assets` bucket public
- `assets.public_url` is nullable and **new inserts must write `null`**. To show an asset in the admin UI, the parent server component signs a short-TTL URL with `createSignedUrl(path, 3600)` and passes a `signedUrls: Record<assetId, url>` map to the client component. See `app/admin/sessions/[id]/page.tsx` for the pattern.

---

## Claude / AI Integration Rules

### System Prompt Construction
- The system prompt is built fresh for every request in `lib/agent/system-prompt.ts`
- Always strip `_meta` from `schema_data` before passing to Claude — internal tracking must never appear in Claude's context
- Only include gap list instructions when `current_phase >= 4`
- Never include `mbp_content` (raw MBP text) in the system prompt — only the parsed `schema_data`
- Always run `serializeSchema()` to remove empty/null/blank fields before injecting schema into prompt

### Token Budget Targets (enforce during development)
Log token usage in every `onFinish` callback. Flag any exchange that exceeds these limits:

| Phase | Max input tokens | Model |
|---|---|---|
| Phase 1 | 1,000 | Haiku |
| Phase 3 | 3,500 | Sonnet |
| Phase 4 | 3,000 | Sonnet |
| Phase 5–6 | 1,500 | Haiku |

If any exchange exceeds 5,000 input tokens, stop and investigate before continuing. `app/api/chat/route.ts` emits a `console.error` (`[token-budget] EXCEEDED ...`) when the estimated input tokens (chars/4) cross 5k — watch server logs for it.

### Model Selection
```typescript
const model = [3, 4].includes(session.current_phase)
  ? anthropic('claude-sonnet-4-6')
  : anthropic('claude-haiku-4-5-20251001')
```
Never use Sonnet for phases 1, 2, 5, or 6.

### Processing Flag Safety
The `processing` boolean in `sessions` prevents concurrent Claude calls. It MUST be set to `false` in both:
1. The `onFinish` callback (normal completion)
2. A `catch`/`finally` block (error or disconnect)

If this flag is not cleared, the session is permanently locked for the client. This is a critical bug.

### Tool Call Rules
- The `update_session_data` tool is the only way Claude should modify session state
- `advancePhase: true` should only be set when phase goals are genuinely complete — the server validates this
- Tool descriptions must stay concise (under 50 words per parameter description) to minimize token overhead

### Content Generation Concurrency
- `lib/content/content-generator.ts → generateSinglePage()` uses an atomic SQL guard: the `generation_status` is updated to `'running'` only if it's not already `'running'` (`.neq('generation_status', 'running')`). A second caller hitting the same outline-id while one is in flight gets `{ status: 'skipped' }`. Mirror this pattern for any future per-row pipeline worker.
- Stuck rows (status `running` for >15 min) are reset to `error` automatically by `/api/cron/sweep-stuck-jobs` every 5 minutes. Don't write manual recovery scripts for orphaned rows — extend the cron.

---

## Phase Logic Rules

### Phase Numbers
- **Development Phases 1–14:** The build phases defined in `raw-docs/dev-steps/` — these are the implementation steps
- **Agent Phases 0–7:** The conversation phases the client experiences — defined in `raw-docs/agent-conversation-flow.md`
- Never confuse these two numbering systems. "Phase 3" in a dev step file means development Phase 3 (admin auth). "Agent Phase 3" means the MBP review conversation.

### Phase Advancement
Phase advances are validated server-side in `updateSessionSchema`. Claude calling `advancePhase: true` is a request, not a guarantee. The server checks:
- Phase 1 → 2: `contact.email`, `contact.firstName`, `contact.phone`, and `websiteUrl` must all be set
- Phase 3 → 4: both `_meta.phase3_completed_chunks` entries (`chunk1`, `chunk2`) must be present
- Phase 4 → 5: all Tier 1 gaps must have `resolved: true`

If validation fails, do not advance the phase and do not surface an error to the client.

### WHOIS Lookup
WHOIS (Phase 2) runs automatically server-side when the session advances to phase 2. It is never triggered by Claude directly. WHOIS failure is non-fatal — log the error and advance to Phase 3 with empty `technical.*` fields.

---

## MBP Parser Rules

- The parser must never throw. Wrap all section parsers in try/catch and always return a partial result.
- Use regex to find section headers — never use line numbers or character offsets.
- ✅ items in MBP → add to schema. ❓ items → add to gap list.
- The Korbey Lague MBP (`raw-docs/mfp-korbeylague-com-2026-04-24.md`) is the primary test fixture. Run the parser against it after any change.
- Store raw `mbp_content` in the DB — never in the system prompt.

---

## PDF Generation Rules

- The PDF generation route MUST export `export const runtime = 'nodejs'` — `@react-pdf/renderer` will not work on the Edge runtime.
- Do not embed uploaded images in the PDF. Reference files by filename only.
- PDF storage path: `pdfs/{sessionId}/intake-summary.pdf`
- Upload uses `upsert: true` — re-generating the PDF overwrites the previous version.


## TypeScript Rules

- `strict: true` is assumed. Never use `as any` — define proper types.
- All schema data typed as `SessionSchema` from `types/session-schema.ts`
- All Supabase query results typed via `types/database.ts` (auto-generated — do not edit manually)
- All gap items typed as `GapItem` from `types/gap-item.ts`
- API request/response bodies should have explicit TypeScript interfaces, not inline object types

---

## File & Folder Conventions

```
app/
  (admin)/          # Admin routes — all require auth
    dashboard/
    sessions/[id]/
    login/
  session/[id]/     # Client-facing — no auth required
  api/
    chat/           # Core streaming endpoint
    sessions/       # Session CRUD
    upload/         # File upload (presign + confirm)
    whois/          # WHOIS lookup trigger
    cron/           # Scheduled jobs — require CRON_SECRET
    pdf/            # PDF generation
lib/
  supabase/         # client.ts, server.ts, proxy.ts
  agent/            # system-prompt.ts, phase-instructions.ts, trim-messages.ts, gap-list.ts
  mbp-parser/       # index.ts + section parsers
  pdf/              # generate-pdf.ts + components/
components/
  chat/             # ChatInterface, FileUploadButton, MessageBubble
  admin/            # SchemaViewer, ApproveButton, StatusBanner
emails/             # React Email templates
types/              # database.ts (generated), session-schema.ts, gap-item.ts
```

---

## Development Workflow

1. Read the relevant dev step file in `raw-docs/dev-steps/` before starting any phase
2. Run tests from that step's **Test Process** section after completing implementation
3. Run `npx tsc --noEmit` after every file change — fix type errors before moving on
4. Before every commit, run:
   - `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` (expect zero matches)
   - `grep -r "GITHUB_APP_PRIVATE_KEY" ./app` (expect zero matches)
   - `grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx"` (expect zero matches outside `scripts/`)
5. Test against the Korbey Lague MBP fixture for any changes to the parser or agent logic
6. Use the Supabase SQL Editor to verify DB state after any session-modifying operation

---

## Design System Rules

The full design specification lives in `raw-docs/design.md`. **Read it before writing any UI code.** All visual decisions — color, typography, spacing, shadows, border-radius, component styling — are defined there and must be followed exactly.

### Non-Negotiable Design Rules

1. **Colors come from the palette only.** Never hardcode hex values in JSX or CSS outside of `tailwind.config.ts`. Use Tailwind classes mapped to `brand.*`, `surface.*`, `text.*`, and `border.*` tokens.
   - Primary CTA color: `brand-cyan` (`#00C1DE`)
   - Primary structural color: `brand-navy` (`#003B71`)
   - No default blues, no generic grays for interactive elements

2. **Fonts are Inter (headings) and Open Sans (body).** Load via `next/font/google`. No system serif fonts. No inline `font-family` overrides.

3. **Buttons are always pill-shaped (`border-radius: 40px`) and brand-colored.** Gray buttons = disabled only. No square or zero-radius buttons.

4. **Shadows use the navy-tinted palette** defined in `raw-docs/design.md`. Never use `rgba(0,0,0,0.5)` or similar generic black shadows.

5. **The CountingFive logo (white version) appears in the client-facing session header.** Place it at `/public/logo-white.svg`. Never stretch, filter, or display it on a cyan background.

6. **Chat bubbles:** agent = white card with `border-color: #E2E8F0`; user = `#003B71` navy background with white text.

7. **No inline style overrides on color or typography.** All styling through Tailwind utility classes that map to the design token config.

8. **Run the Component Checklist** (bottom of `raw-docs/design.md`) before considering any UI screen complete.

---

## Do Not

- Do not use `localStorage` or `sessionStorage` anywhere in the application
- Do not send `mbp_content` to Claude
- Do not use `export const runtime = 'edge'` on any route that uses `@react-pdf/renderer` or `whoiser`
- Do not use sequential IDs for session or record lookups
- Do not advance a phase without server-side validation
- Do not mark a session as approved if it is already approved
- Do not clear the `processing` flag only in `onFinish` — also clear it on error
- Do not call `.getPublicUrl()` on the `session-assets` bucket or write a value into `assets.public_url`
- Do not write `console.log` in pipeline or production paths — use `console.warn` for non-fatal operational logs, `console.error` for genuine failures
- Do not use raw Tailwind semantic colors (`text-red-*`, `bg-amber-*`, etc.) — use the `error` / `warning` / `info` / `success` tokens defined in `app/globals.css`
- Do not let `process.env.CRON_SECRET` be empty in any environment that has cron routes deployed
