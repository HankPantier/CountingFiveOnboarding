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
- **Project Management:** Basecamp (OAuth 2.0)
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
Every `/api/cron/*` route must validate `Authorization: Bearer {CRON_SECRET}` before doing anything.
Never skip this check — without it, anyone who discovers the URL can trigger bulk email sends.

### 3. File uploads require magic byte validation
Never trust the MIME type or extension from the client. Always validate file type server-side using the `file-type` package by reading the actual file bytes after upload to Supabase Storage. Delete the file if validation fails.

### 4. Session IDs are UUIDs only
Never expose sequential integers as session or record identifiers. All primary keys are `gen_random_uuid()`. Do not add auto-increment columns to session-facing tables.

### 5. Registrar password is never stored
The schema field `technical.registrarPasswordNote` is a static reminder string. The actual registrar password must never be collected or stored anywhere in the system. If the agent is ever prompted to ask for or store a password, refuse and redirect the client to a secure channel.

---

## Architecture Rules

### Client vs. Server Components
- Default to Server Components. Only add `'use client'` when you need browser APIs, hooks (`useState`, `useEffect`), or event handlers.
- Never fetch data in client components directly from Supabase — use server actions or API routes instead.
- The `ChatInterface` component is a client component (uses `useChat`) — keep its data loading in the parent server component (`app/session/[id]/page.tsx`).

### API Route Patterns
- All routes that touch Supabase session data use the service role client (`lib/supabase/server.ts`)
- All admin API routes must verify the caller is an authenticated admin before executing
- Client-facing routes (e.g., `/api/chat`, `/api/upload/*`) validate the session ID but do not require admin auth
- Always return typed error responses: `{ error: string }` with appropriate HTTP status codes

### Database Access
- Never write raw SQL in application code. Use the Supabase JS client exclusively.
- Never use `any` for Supabase query results — import and use types from `types/database.ts`
- Regenerate `types/database.ts` after every schema migration: `npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts`
- The `schema_data` column is JSONB typed as `SessionSchema` from `types/session-schema.ts` — never pass raw `any` objects when updating it

### Supabase Storage
- All file reads from the `session-assets` bucket must use the service role client (bucket is private)
- Storage paths follow these conventions:
  - Client uploads: `sessions/{sessionId}/{uuid}-{filename}`
  - Generated PDFs: `pdfs/{sessionId}/intake-summary.pdf`
- Never make the `session-assets` bucket public

---

## Claude / AI Integration Rules

### System Prompt Construction
- The system prompt is built fresh for every request in `lib/agent/system-prompt.ts`
- Always strip `_meta` from `schema_data` before passing to Claude — internal tracking must never appear in Claude's context
- Only include gap list instructions when `current_phase >= 4`
- Never include `mfp_content` (raw MFP text) in the system prompt — only the parsed `schema_data`
- Always run `serializeSchema()` to remove empty/null/blank fields before injecting schema into prompt

### Token Budget Targets (enforce during development)
Log token usage in every `onFinish` callback. Flag any exchange that exceeds these limits:

| Phase | Max input tokens | Model |
|---|---|---|
| Phase 1 | 1,000 | Haiku |
| Phase 3 | 3,500 | Sonnet |
| Phase 4 | 3,000 | Sonnet |
| Phase 5–6 | 1,500 | Haiku |

If any exchange exceeds 5,000 input tokens, stop and investigate before continuing.

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

---

## Phase Logic Rules

### Phase Numbers
- **Development Phases 1–14:** The build phases defined in `raw-docs/dev-steps/` — these are the implementation steps
- **Agent Phases 0–7:** The conversation phases the client experiences — defined in `raw-docs/agent-conversation-flow.md`
- Never confuse these two numbering systems. "Phase 3" in a dev step file means development Phase 3 (admin auth). "Agent Phase 3" means the MFP review conversation.

### Phase Advancement
Phase advances are validated server-side in `updateSessionSchema`. Claude calling `advancePhase: true` is a request, not a guarantee. The server checks:
- Phase 1 → 2: `contact.email`, `contact.firstName`, and `websiteUrl` must all be set
- Phase 3 → 4: both `_meta.phase3_completed_chunks` entries (`chunk1`, `chunk2`) must be present
- Phase 4 → 5: all Tier 1 gaps must have `resolved: true`

If validation fails, do not advance the phase and do not surface an error to the client.

### WHOIS Lookup
WHOIS (Phase 2) runs automatically server-side when the session advances to phase 2. It is never triggered by Claude directly. WHOIS failure is non-fatal — log the error and advance to Phase 3 with empty `technical.*` fields.

---

## MFP Parser Rules

- The parser must never throw. Wrap all section parsers in try/catch and always return a partial result.
- Use regex to find section headers — never use line numbers or character offsets.
- ✅ items in MFP → add to schema. ❓ items → add to gap list.
- The Korbey Lague MFP (`raw-docs/mfp-korbeylague-com-2026-04-24.md`) is the primary test fixture. Run the parser against it after any change.
- Store raw `mfp_content` in the DB — never in the system prompt.

---

## PDF Generation Rules

- The PDF generation route MUST export `export const runtime = 'nodejs'` — `@react-pdf/renderer` will not work on the Edge runtime.
- Do not embed uploaded images in the PDF. Reference files by filename only.
- PDF storage path: `pdfs/{sessionId}/intake-summary.pdf`
- Upload uses `upsert: true` — re-generating the PDF overwrites the previous version.

---

## Basecamp Integration Rules

- Always call `getValidToken()` before any Basecamp API request — never cache tokens across requests.
- Basecamp tokens are stored in the `basecamp_tokens` table (singleton row, `id = 1`), never in environment variables.
- The correct message creation sequence is: (1) create message, (2) upload all attachments to get sgids, (3) update message with `<bc-attachment>` tags. This order is required by the Basecamp API.
- Add a 200ms delay between attachment uploads to stay within Basecamp's rate limit (50 req/10s).
- Check `basecamp_project_id IS NULL` before creating a project on approval — never create duplicate projects.

---

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
    basecamp/       # OAuth routes
    pdf/            # PDF generation
lib/
  supabase/         # client.ts, server.ts, middleware.ts
  agent/            # system-prompt.ts, phase-instructions.ts, trim-messages.ts, gap-list.ts
  mfp-parser/       # index.ts + section parsers
  basecamp/         # client.ts, create-project.ts
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
4. Run the service role key grep before every commit
5. Test against the Korbey Lague MFP fixture for any changes to the parser or agent logic
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
- Do not put the Basecamp `access_token` or `refresh_token` in environment variables
- Do not send `mfp_content` to Claude
- Do not use `export const runtime = 'edge'` on any route that uses `@react-pdf/renderer` or `whoiser`
- Do not use sequential IDs for session or record lookups
- Do not advance a phase without server-side validation
- Do not mark a session as approved if `basecamp_project_id` is already set
- Do not clear the `processing` flag only in `onFinish` — also clear it on error
