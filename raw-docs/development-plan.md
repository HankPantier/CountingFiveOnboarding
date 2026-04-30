# Development Plan

**Project:** CountingFive AI Onboarding Agent
**Stack:** Next.js 15 · Supabase · Vercel · Anthropic · Resend · Basecamp
**Updated:** 2026-04-30

---

## Before You Write a Single Line of Code

All of the following must be in place before development begins. Skipping any of these causes downstream blockers.

### Accounts to Create / Verify
- [ ] **GitHub** — repo created, Vercel connected to it
- [ ] **Vercel** — project created, linked to GitHub repo
- [ ] **Supabase** — project created (use existing account); note project URL and keys
- [ ] **Resend** — account created at resend.com; domain verified for sending
- [ ] **Basecamp** — OAuth app registered at `launchpad.37signals.com/integrations` (requires existing Basecamp account); note Client ID and Client Secret
- [ ] **Anthropic** — API key generated at `console.anthropic.com`

### Credentials Checklist
Gather all of these before starting. Every item here maps to an environment variable.

| Credential | Where to get it | Used in phase |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Phase 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Phase 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | Phase 1 |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Phase 5 |
| `RESEND_API_KEY` | resend.com → API Keys | Phase 9 |
| `RESEND_FROM_EMAIL` | Verified sending domain in Resend | Phase 9 |
| `BASECAMP_CLIENT_ID` | launchpad.37signals.com/integrations | Phase 10 |
| `BASECAMP_CLIENT_SECRET` | launchpad.37signals.com/integrations | Phase 10 |
| `BASECAMP_ACCOUNT_ID` | Your Basecamp URL: `3.basecamp.com/{ACCOUNT_ID}` | Phase 10 |
| `CRON_SECRET` | Generate: `openssl rand -base64 32` | Phase 9 |
| `NEXT_PUBLIC_APP_URL` | `https://onboard.countingfive.com` | Phase 1 |

---

> **Naming note:** This plan uses "Development Phase 1–12" for build phases. The onboarding agent itself has "Agent Phases 0–7" (from `agent-conversation-flow.md`). These are different numbering systems — don't confuse them. When this plan mentions "Phase 5" it means Development Phase 5 (Client Chat Interface). When it references Phase 0–7 of the agent's conversation, it will say "Agent Phase X" explicitly.

---

## Phase 1 — Project Foundation
**Goal:** Working Next.js app deployed to Vercel with Supabase connected. Nothing functional yet — just the skeleton that everything else builds on.
**Credentials needed:** Supabase keys, `NEXT_PUBLIC_APP_URL`

### Tasks
- [ ] Scaffold Next.js app: `npx create-next-app@latest onboarding-agent --typescript --tailwind --app`
- [ ] Install core dependencies:
  ```bash
  npm install @supabase/supabase-js @supabase/ssr
  npm install ai @ai-sdk/anthropic
  npm install zod
  npm install resend react-email @react-email/components
  npm install whoiser
  npm install @react-pdf/renderer
  ```
- [ ] Initialize shadcn/ui (interactive — not a standard npm install):
  ```bash
  npx shadcn@latest init
  # Select: TypeScript, Default style, CSS variables
  # Add components as needed: npx shadcn@latest add button input table badge
  ```
- [ ] Create `.env.local` with all environment variables (use `.env.example` as a committed template with empty values)
- [ ] Set up Supabase client helpers:
  - `lib/supabase/client.ts` — browser client (anon key)
  - `lib/supabase/server.ts` — server client (service role key, for API routes)
  - `lib/supabase/middleware.ts` — for auth session refresh
- [ ] Create `middleware.ts` at root — protects `/admin` routes, allows all `/session/*` routes through unauthenticated
- [ ] Create `vercel.json` at project root (stub it now — the cron schedule gets added in Development Phase 9):
  ```json
  {
    "crons": []
  }
  ```
- [ ] Push to GitHub → verify Vercel auto-deploys
- [ ] Add all environment variables to Vercel (Settings → Environment Variables)
- [ ] Set up DNS: add `CNAME onboard → cname.vercel-dns.com` in DNS provider
- [ ] Add custom domain `onboard.countingfive.com` in Vercel → verify SSL provisioned

### Failure points
- **DNS propagation** takes up to 48 hours. Add the CNAME record on day one so it's ready.
- **Service role key in client code** — the service role key bypasses all RLS. It must only ever be used in server-side code (API routes, server components). Double-check no `SUPABASE_SERVICE_ROLE_KEY` reference appears in `/app` client components.
- **Missing `.env.example`** — commit a template with all variable names (empty values) so nothing gets forgotten when moving to a new machine or onboarding a second developer.

---

## Phase 2 — Database Schema
**Goal:** All Supabase tables created with correct types, indexes, and Row Level Security policies. TypeScript types generated.
**Credentials needed:** Supabase (already configured)

### Database tables

Run these migrations in Supabase → SQL Editor (or via Supabase CLI with `supabase migration new`):

```sql
-- Admins (links to Supabase Auth users)
CREATE TABLE admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (one per client onboarding)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'approved')),
  current_phase INTEGER NOT NULL DEFAULT 0 CHECK (current_phase BETWEEN 0 AND 7),
  schema_data JSONB NOT NULL DEFAULT '{}',  -- includes _meta sub-key for internal tracking
  gap_list JSONB NOT NULL DEFAULT '[]',
  mfp_content TEXT,                         -- raw MFP markdown stored for reference
  client_email TEXT,                        -- populated in Agent Phase 1 of conversation
  processing BOOLEAN NOT NULL DEFAULT FALSE, -- prevents concurrent Claude calls; set TRUE during streaming, FALSE on finish
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES admins(id),
  basecamp_project_id TEXT,
  pdf_url TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  content_generation_ready BOOLEAN NOT NULL DEFAULT FALSE  -- set TRUE on admin approval
);

-- Messages (conversation history per session)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assets (uploaded files per session)
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,               -- Supabase Storage path
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  asset_category TEXT CHECK (asset_category IN ('logo', 'headshot', 'photo', 'other')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reminders (log of all inactivity emails sent)
CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  days_inactive INTEGER NOT NULL
);

-- Basecamp OAuth tokens (admin-level, one record)
CREATE TABLE basecamp_tokens (
  id INTEGER PRIMARY KEY DEFAULT 1,         -- singleton row
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);
```

### Indexes
```sql
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_assets_session_id ON assets(session_id);
CREATE INDEX idx_reminders_session_id ON reminders(session_id);
```

### Row Level Security
```sql
-- Enable RLS on all tables
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE basecamp_tokens ENABLE ROW LEVEL SECURITY;

-- Admins: can only read/write their own record
CREATE POLICY "Admins manage own record"
  ON admins FOR ALL
  USING (auth.uid() = id);

-- Sessions: authenticated admins can read/write all
CREATE POLICY "Admins full access to sessions"
  ON sessions FOR ALL
  TO authenticated
  USING (true);

-- Messages: same
CREATE POLICY "Admins full access to messages"
  ON messages FOR ALL
  TO authenticated
  USING (true);

-- NOTE: Client-facing reads go through server-side API routes
-- using the service role key, which bypasses RLS entirely.
-- No public/anon policies are needed for sessions or messages.

-- Assets: admin full access
CREATE POLICY "Admins full access to assets"
  ON assets FOR ALL
  TO authenticated
  USING (true);

-- Reminders: admin full access
CREATE POLICY "Admins full access to reminders"
  ON reminders FOR ALL
  TO authenticated
  USING (true);

-- Basecamp tokens: admin full access
CREATE POLICY "Admins full access to basecamp tokens"
  ON basecamp_tokens FOR ALL
  TO authenticated
  USING (true);
```

### Supabase Storage
In Supabase → Storage, create a bucket named `session-assets`:
- Public: **No** (all access via signed URLs or server-side)
- Max file size: 300 MB
- Allowed MIME types: `image/jpeg, image/png, image/gif, image/tiff, application/pdf`

### Generate TypeScript types

Install the Supabase CLI first if not already installed: `npm install -g supabase`

```bash
# Get your project ID from Supabase → Settings → General
npx supabase gen types typescript --project-id YOUR_PROJECT_ID_HERE > types/database.ts
```

Regenerate this file any time the schema changes — treat it as a build artifact, not something to edit manually.

### Failure points
- **Forgetting to regenerate types** after schema changes — add this as a step in any future migration PR.
- **Service role key bypasses RLS** — this is intentional for client-facing routes but must not be used in browser code. Review every import of the server Supabase client.
- **JSONB vs TEXT for schema_data** — JSONB allows indexed querying later if needed. Do not change to TEXT.

---

## Phase 3 — Admin Authentication
**Goal:** Admin login page working. All `/admin` routes protected. First admin user created.
**Credentials needed:** Supabase (already configured)

### Tasks
- [ ] Enable **Email auth** in Supabase → Authentication → Providers (disable all others for now)
- [ ] Disable **email confirmation** in Supabase → Authentication → Settings (admin creates users manually — no self-signup)
- [ ] Disable **user signups** in Supabase → Authentication → Settings → "Disable signups" = ON
- [ ] Build `/app/(admin)/login/page.tsx` — email + password form, Supabase Auth sign-in
- [ ] Build `middleware.ts` logic:
  - `/admin/*` — redirect to `/admin/login` if no active session
  - `/session/*` — always allow through (no auth check)
  - `/api/cron/*` — validate `Authorization: Bearer {CRON_SECRET}` header
- [ ] Create the first admin user manually: Supabase → Authentication → Users → Add user. Then insert matching row into `admins` table.
- [ ] Build admin logout (server action that calls `supabase.auth.signOut()`)
- [ ] Stub out `/app/(admin)/dashboard/page.tsx` — empty page that confirms auth works

### Failure points
- **Supabase Auth session cookies** require the SSR package (`@supabase/ssr`) and the middleware refresh pattern. If session tokens expire and middleware doesn't refresh them, admins get randomly logged out. Follow the Supabase SSR docs exactly.
- **Signups disabled** — verify this is off before going to production. Without it, anyone who discovers the login URL could create an account.

---

## Phase 4 — MFP Parser & Session Creation
**Goal:** Admin can upload an MFP `.md` file, the system parses it into the session JSON schema, builds a gap list, stores the session, and generates a unique client URL.
**Credentials needed:** Supabase (already configured)

### MFP Parser (`lib/mfp-parser/index.ts`)

The parser reads the MFP markdown and extracts structured data. It must be defensive — the MFP format may vary slightly between clients.

**Mapping logic:**

| MFP Section | Extracted fields | Schema target |
|---|---|---|
| Section 1 — Firm Identity | Business name, website URL, address(es), phone, fax, email, hours | `locations[]`, `business.name`, `websiteUrl` |
| Section 2 — Firm Narrative | Tagline, positioning options A/B/C | `business.tagline`, `business.positioningStatement` (held as array of 3) |
| Section 3 — Accreditations | ✅ confirmed items → add; ❓ items → flag in gap list | `business.affiliations[]` |
| Section 4 — Social & Digital | ✅ confirmed URLs → add; ❓ → flag in gap list | `culture.socialMediaChannels[]` |
| Section 5 — Who They Serve | Niche names, ICP descriptions | `niches[]`, `business.idealClients[]` |
| Section 6 — Services | Service names, descriptions, offerings | `services[]` |
| Section 7 — Team | Names, titles (where found), certifications; missing titles → flag | `team[]` |

**Gap list structure:**
```typescript
type GapItem = {
  field: string;          // e.g., "team[2].title"
  label: string;          // human-readable: "Kristine Ciccarelli — Title"
  phase: number;          // which phase addresses this gap (3 or 4)
  topic?: string;         // for Phase 4: which topic (A–I)
  resolved: boolean;
};
```

**Parser error handling:**
- If a section is not found → log warning, leave corresponding schema fields empty, add to gap list
- If a field can't be parsed → leave empty, add to gap list
- Parser must never throw — always return a partial result

### Tasks
- [ ] Write `lib/mfp-parser/index.ts` — exports `parseMFP(markdown: string): { schema: SessionSchema, gaps: GapItem[] }`
- [ ] Write unit tests for the parser using the Korbey Lague MFP as the test fixture
- [ ] Build admin MFP upload UI: `/app/(admin)/dashboard/new-session/page.tsx`
  - Website URL input field (pre-fills from parsed MFP, editable)
  - File input (`.md` files only)
  - Preview of parsed data before confirming
  - "Create Session" button
- [ ] Build `POST /api/sessions` route:
  - Receives: `{ websiteUrl, mfpContent, schemaData, gapList }`
  - Creates session row in Supabase
  - Returns: `{ sessionId, clientUrl }`
- [ ] Display generated client URL in the admin UI with a copy button
- [ ] Add session to the dashboard session list

### Failure points
- **MFP format changes** — the parser is the most brittle part of the system. Build it with regex + section-header detection, not line-number assumptions. Test with edge cases (missing sections, different heading formats, extra whitespace).
- **Large MFP files** — store the raw `mfp_content` in the DB for debugging. If the parser fails in production, you can re-run it against the stored raw content without asking the client to re-upload.
- **UUID collision** — `gen_random_uuid()` in Postgres is cryptographically random (UUID v4). Collision probability is negligible.

---

## Phase 5 — Client Chat Interface
**Goal:** Client opens their URL, sees a chat interface, and can have a streaming conversation with the agent. Session state is saved after every exchange.
**Credentials needed:** `ANTHROPIC_API_KEY`

### Route: `/app/session/[id]/page.tsx`
- Server component: loads session from DB using session ID (service role key)
- If session not found → 404
- If session `status === 'approved'` → show "Thank you, your onboarding is complete" screen
- Otherwise → renders `<ChatInterface sessionId={id} initialData={session} />`

### Chat API: `POST /api/chat`
This is the core endpoint. It:
1. Validates the session ID exists
2. Loads current session state (schema, gap list, phase, message history)
3. Constructs the system prompt dynamically (see below)
4. Calls Claude with streaming via Vercel AI SDK
5. On completion: saves the assistant message to `messages` table, updates `schema_data` if the tool was called, advances phase if needed, updates `last_activity_at`

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export async function POST(req: Request) {
  const { sessionId, messages } = await req.json();

  // 1. Load session (server supabase client)
  const session = await getSession(sessionId);
  if (!session) return new Response('Not found', { status: 404 });

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt(session);

  // 3. Stream with tool support
  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: systemPrompt,
    messages,
    tools: {
      update_session_data: {
        description: 'Update one or more fields in the session schema when the client provides or confirms information.',
        parameters: z.object({
          updates: z.record(z.string(), z.unknown()),  // field path → value
          resolvedGaps: z.array(z.string()).optional(), // gap field paths resolved
          advancePhase: z.boolean().optional(),
        }),
        execute: async ({ updates, resolvedGaps, advancePhase }) => {
          await updateSessionSchema(sessionId, updates, resolvedGaps, advancePhase);
          return { success: true };
        },
      },
    },
    maxSteps: 5,  // allow tool call + follow-up response in same stream
    onFinish: async ({ text }) => {
      await saveMessage(sessionId, 'assistant', text);
      await updateLastActivity(sessionId);
    },
  });

  return result.toDataStreamResponse();
}
```

### System prompt builder (`lib/agent/system-prompt.ts`)

The system prompt is constructed fresh for every message. It includes:

1. **Role and context** — who the agent is, what the session is for
2. **Current schema state** — the full JSON of what has been collected (so Claude knows what's filled)
3. **Gap list** — what's still missing and which phase/topic should address each item
4. **Current phase instructions** — what the agent should be doing right now (from `agent-conversation-flow.md`)
5. **Tool instructions** — when and how to call `update_session_data`
6. **Guardrails** — never skip required fields without explicit user skip, always confirm MFP data before treating as final
7. **Time budget instruction** — "The full client session (Agent Phases 1–6) must complete in 5–7 minutes. Present MFP data in bulk, batch Phase 4 questions 2–3 per exchange, and respect the Tier 1 / Tier 2 / Tier 3 priority system. Do not probe thin answers more than once."

Keep the system prompt under 3,000 tokens to leave room for conversation history. Schema data is the biggest variable — serialize only non-empty fields.

### Client chat component (`components/chat/ChatInterface.tsx`)
- Uses `useChat` from `ai/react`
- Displays messages in a scrollable thread
- Streaming text renders in real time
- Input disabled while response is streaming
- File upload button (shows at Phase 5)
- "Session saved" indicator (updates `last_activity_at` is enough — client can close and return)

### Tasks
- [ ] Build `/app/session/[id]/page.tsx` (server component, session validation)
- [ ] Build `POST /api/chat/route.ts` with streaming + tool calling
- [ ] Write `lib/agent/system-prompt.ts`
- [ ] Write `lib/agent/phase-instructions.ts` — returns the right instructions for the current phase (mirrors `agent-conversation-flow.md`)
- [ ] Build `<ChatInterface>` client component with `useChat`
- [ ] Build `<MessageBubble>` component — different styles for user vs. assistant
- [ ] Build `<TypingIndicator>` for while response is streaming
- [ ] Test: open a session URL, send a message, verify streaming response, verify DB updated

### Failure points
- **Tool call + streaming in same response** — `maxSteps: 5` is required so Claude can call the tool and then continue the text response in the same stream. Without it, the response ends after the tool call with no message to the user.
- **Message history growing too large** — Claude's context window is large, but sending thousands of messages will slow response time and increase cost. Implement a `trimMessages` function that keeps the last N messages (suggest: last 40 messages plus the system prompt). Store the full history in the DB but only send recent messages to Claude.
- **Concurrent submits** — user double-clicks send. Disable the submit button while `isLoading` is true from `useChat`. Also add a server-side guard: reject requests if a response is already streaming for this session (use the `processing` boolean in the session row). **Critical:** wrap the entire streaming block in a try/finally and always set `processing = FALSE` in the `finally` block — if the function throws or the client disconnects mid-stream, the session will be permanently locked without this.
- **Session not found errors** — return a friendly error UI, not a raw 404. The client URL is permanent; if it 404s, something is very wrong.

---

## Phase 6 — Agent Phase Logic
**Goal:** The agent correctly progresses through all 8 phases, presents MFP data for confirmation, asks about gaps, and applies the guardrails.
**Credentials needed:** None additional

This phase is about the quality of the agent's behavior, not new infrastructure. The system prompt and phase instruction files do the heavy lifting.

### Phase instruction files (`lib/agent/phases/`)

Create one file per phase. Each exports a function that receives the current session state and returns the instruction string for that phase.

```
phases/
  phase-0.ts   # (runs server-side during parser — no Claude call)
  phase-1.ts   # Welcome & Identify
  phase-2.ts   # Domain Lookup (triggers WHOIS, no Claude call)
  phase-3.ts   # MFP Review (6 sub-sections: 3a–3f)
  phase-4.ts   # Fill Gaps (9 topics A–I, only unresolved)
  phase-5.ts   # Assets
  phase-6.ts   # Final Summary
  phase-7.ts   # (admin side — not a Claude phase)
```

### Phase advancement logic

Phase advances when:
- **Phase 1 → 2:** Contact info collected and URL confirmed
- **Phase 2 → 3:** WHOIS lookup completed (triggered automatically, not by Claude)
- **Phase 3 → 4:** All 6 MFP review sections completed
- **Phase 4 → 5:** All gap list items resolved or explicitly skipped
- **Phase 5 → 6:** Asset questions asked and file upload prompt shown
- **Phase 6 → 7:** Client confirms final summary

The `update_session_data` tool's `advancePhase: true` field triggers the phase increment server-side. Claude should only set this when the current phase's goals are genuinely met.

### WHOIS lookup (Agent Phase 2)

Agent Phase 2 is not an interactive Claude conversation — it's a server-side action triggered automatically. When the `update_session_data` tool call advances the session from Agent Phase 1 → 2, the `execute` function should immediately call the WHOIS route before returning. The client-side `useChat` hook then receives the phase update and the chat continues into Agent Phase 3.

```typescript
// app/api/whois/route.ts
import whoiser from 'whoiser';

export async function POST(req: Request) {
  const { sessionId, domain } = await req.json();
  try {
    const result = await whoiser(domain, { timeout: 8000 });
    // Extract: registrar, creation_date, expiration_date, name_servers
    // Update session schema_data with technical fields
    // Advance phase to 3
  } catch {
    // WHOIS failure is non-fatal — log it, advance phase anyway with empty technical fields
    // These will appear as gaps in Phase 3e
  }
}
```

**Failure point:** `whoiser` makes raw socket connections that Vercel's serverless functions support, but with a 10-second timeout. Use `timeout: 8000` to stay within Vercel's limit. If WHOIS fails, do not block the session — advance to Phase 3 with the technical fields empty.

### TypeScript session schema type

The `schema_data` JSONB column holds a typed object that mirrors the JSON schema in `agent-conversation-flow.md`. Create `types/session-schema.ts` and import it throughout — do not pass raw `any` objects. This type becomes the single source of truth for what the agent collects.

### Sub-phase tracking (Agent Phase 3)

Agent Phase 3 has 2 chunks (Chunk 1: practical info, Chunk 2: team/services/positioning). Track progress using a reserved `_meta` key inside `schema_data` (never shown to the client or included in Claude's schema dump):

```json
"_meta": {
  "phase3_completed_chunks": ["chunk1"],
  "phase4_resolved_tiers": { "tier1_done": false, "tier2_done": false },
  "phase4_flagged_for_followup": ["competitive_landscape"],
  "admin_overrides": { "business.foundingYear": true }
}
```

Strip `_meta` before passing schema data to Claude in the system prompt.

### Credential security note

The schema includes `technical.registrarUsername` and `technical.registrarPin` — these are stored in `schema_data`. The registrar **password** is intentionally excluded from the schema and must not be stored in the database. The agent's Phase 3 Chunk 1 instructions direct the client to share the password through a separate secure channel. The schema field `technical.registrarPasswordNote` is a static reminder string, not a collected value.

### Tasks
- [ ] Write all phase instruction files
- [ ] Write WHOIS route and trigger it when session enters Phase 2
- [ ] Implement sub-phase tracking in schema for Phase 3 (2 chunks) and Phase 4 (3 priority tiers)
- [ ] Write phase advancement server action
- [ ] Write `buildGapListInstructions(gapList)` — dynamically tells Claude only to ask about still-unresolved gaps in Phase 4; format by tier (Tier 1 first, flagged items noted separately)
- [ ] Test full conversation flow end-to-end using the Korbey Lague MFP as seed data; verify session completes in under 7 minutes

### Failure points
- **Claude skipping gaps** — the system prompt must explicitly list unresolved gap items in Phase 4. If the gap list is passed as a blob, Claude may not prioritize it correctly. Format it clearly: `"TIER 1 GAPS (ALWAYS ASK): 1. Founding year (business.foundingYear) 2. ..."`
- **Claude advancing phase too early** — set the `advancePhase` tool call instructions to require explicit confirmation: "Only set advancePhase: true when the user has explicitly confirmed this section is complete and there is nothing more to address."
- **Phase 3 chunk order** — Chunk 1 (practical) must complete before Chunk 2 (content/positioning). If Claude skips ahead, phase tracking gets confused.
- **Session running long** — if Phase 4 Tier 2/3 questions push the session past 6 minutes, the agent should flag remaining items as `_meta.flaggedForFollowup` and advance rather than continuing to ask. Build a session elapsed-time check into the Phase 4 instructions.

---

## Token & Cost Optimization

Claude API cost scales with tokens in + tokens out per request. Every message sent to Claude includes the system prompt + message history + tool definitions. A session with no optimization can balloon to 8,000–12,000 input tokens per exchange. The strategies below keep this well under 4,000 for a typical session.

These are not optional polish — build them into the system prompt builder and chat route from the start. Retrofitting them later is painful.

---

### 1. Phase-scoped system prompt

**Problem:** If you include all phase instructions in every system prompt, you're sending 2,000+ tokens of instructions the agent doesn't need right now.

**Fix:** `lib/agent/phase-instructions.ts` returns only the instructions for the current phase. The system prompt builder calls it with `session.current_phase` and injects only that block.

```typescript
// lib/agent/phase-instructions.ts
export function getPhaseInstructions(phase: number, session: Session): string {
  switch (phase) {
    case 1: return phase1Instructions(session);
    case 3: return phase3Instructions(session);  // includes chunk tracker
    case 4: return phase4Instructions(session);  // includes tier state
    // ...
  }
}
```

**Savings:** ~800–1,200 tokens per exchange once phases 3 and 4 instructions are excluded when not needed.

---

### 2. Sparse schema serialization

**Problem:** The full session schema has ~50 fields. Sending all of them — including empty ones — wastes tokens and adds noise.

**Fix:** Before injecting the schema into the system prompt, strip `_meta` and all null/empty-string/empty-array fields. Only send fields with actual values.

```typescript
// lib/agent/system-prompt.ts
function serializeSchema(schema: SessionSchema): string {
  const { _meta, ...rest } = schema;
  const sparse = deepOmitEmpty(rest);  // recursive, removes null/""/[]/{} values
  return JSON.stringify(sparse, null, 2);
}
```

**Note:** Empty fields are still meaningful — the gap list (below) tells Claude what's missing. The schema only needs to communicate what's been collected.

**Savings:** 300–600 tokens depending on session stage (biggest gain early in the session when most fields are still empty).

---

### 3. Gap list instead of full schema diff

**Problem:** Having Claude infer what's missing by comparing a full schema against an ideal schema is unreliable and wastes tokens.

**Fix:** Maintain an explicit `gap_list` column in the session row (already in the schema). After each `update_session_data` tool call, compute the updated gap list server-side and store it. Pass only the current gap list into the system prompt — not the full schema analysis.

```typescript
// Format for Claude — clear, scannable, tier-labeled
function buildGapListInstructions(gaps: GapItem[]): string {
  const tier1 = gaps.filter(g => g.tier === 1);
  const tier2 = gaps.filter(g => g.tier === 2);
  const tier3 = gaps.filter(g => g.tier === 3);

  return [
    tier1.length ? `TIER 1 — MUST ASK:\n${tier1.map(g => `• ${g.label} (${g.field})`).join('\n')}` : '',
    tier2.length ? `TIER 2 — ASK IF UNDER 5 MIN:\n${tier2.map(g => `• ${g.label} (${g.field})`).join('\n')}` : '',
    tier3.length ? `TIER 3 — SKIP IF RUNNING LONG:\n${tier3.map(g => `• ${g.label} (${g.field})`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
```

**Savings:** Eliminates the need to re-explain the full schema structure on every Phase 4 request. Claude gets a clean task list instead of reasoning from raw JSON.

---

### 4. Message history trimming

**Problem:** Sending the full message history for a 30-exchange session means thousands of tokens of context that is mostly redundant — the schema already captures what was confirmed.

**Fix:** Trim message history before sending to Claude. Keep only recent messages for conversational coherence; everything else is already reflected in `schema_data`.

```typescript
// lib/agent/trim-messages.ts
const MAX_MESSAGES = 20;  // last 10 exchanges (user + assistant pairs)

export function trimMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  // Always keep the first message (Phase 1 welcome establishes context)
  const first = messages.slice(0, 1);
  const recent = messages.slice(-MAX_MESSAGES + 1);
  return [...first, ...recent];
}
```

Store the full history in the DB (`messages` table). Only the trimmed slice goes to Claude.

**Savings:** 500–2,000 tokens per exchange in Phase 4+ when session history grows long.

---

### 5. MFP content: parse once, don't re-send

**Problem:** The MFP is a ~3,000-word markdown document. Sending it to Claude on every request to re-parse is expensive and unnecessary.

**Fix:** Parse the MFP once at session creation (in `lib/mfp-parser/`) and write the structured output directly into `schema_data`. After that, the MFP raw text is stored in `sessions.mfp_content` for admin reference only — it never goes into the Claude system prompt.

Claude only sees the already-parsed schema fields, not the source document.

**Savings:** ~800–1,500 tokens per exchange. The MFP is the single biggest source of unnecessary token spend if not handled this way.

---

### 6. Lean tool definition

**Problem:** The Vercel AI SDK serializes tool definitions (parameter schemas, descriptions) into every request. Verbose descriptions add up.

**Fix:** Keep the `update_session_data` tool description concise. Use Zod `.describe()` only for non-obvious fields. Avoid paragraph-length parameter descriptions.

```typescript
tools: {
  update_session_data: {
    description: 'Update collected session fields and advance phase state.',
    parameters: z.object({
      updates: z.record(z.string(), z.unknown()).describe('Field path → value pairs to write into schema_data'),
      resolvedGaps: z.array(z.string()).optional().describe('Gap field paths now resolved'),
      advancePhase: z.boolean().optional(),
    }),
    // ...
  }
}
```

**Savings:** ~100–200 tokens per request — small, but adds up across 15–20 exchanges in a session.

---

### 7. Model selection by phase

Not all phases need the same model. Claude Sonnet 4.6 is the right call for Phase 3 (nuanced MFP presentation) and Phase 4 (gap-filling conversation). Lighter phases can use a faster/cheaper model.

| Agent Phase | Recommended model | Reason |
|---|---|---|
| Phase 1 (welcome + contact) | `claude-haiku-4-5` | Simple structured collection, no nuance required |
| Phase 2 (WHOIS) | No Claude call | Server-side only — WHOIS result goes directly into schema |
| Phase 3 (MFP review) | `claude-sonnet-4-6` | Must present MFP data naturally and handle corrections gracefully |
| Phase 4 (gap filling) | `claude-sonnet-4-6` | Conversational depth, probing, adaptive batching |
| Phase 5 (assets) | `claude-haiku-4-5` | Simple checklist questions, file confirmation |
| Phase 6 (summary) | `claude-haiku-4-5` | Structured read-back of confirmed data |

Set model via `session.current_phase` in the chat route:

```typescript
const model = [3, 4].includes(session.current_phase)
  ? anthropic('claude-sonnet-4-6')
  : anthropic('claude-haiku-4-5-20251001');
```

**Savings:** Haiku is significantly cheaper than Sonnet. Phases 1, 5, and 6 are the simplest and run fine on Haiku.

---

### Token budget target per exchange

| Phase | Input tokens (target) | Notes |
|---|---|---|
| Phase 1 | < 1,000 | Haiku, minimal schema, short instructions |
| Phase 3 | < 3,500 | Sonnet, sparse schema, MFP chunk in prompt |
| Phase 4 (early) | < 3,000 | Sonnet, gap list, recent history |
| Phase 4 (late) | < 2,500 | History trimmed; schema mostly full (sparse = smaller) |
| Phase 5–6 | < 1,500 | Haiku, minimal instructions |

Log actual token usage (available in Vercel AI SDK's `onFinish` callback via `usage.promptTokens`) during development. If any exchange exceeds 5,000 input tokens, investigate which component is the culprit.

```typescript
onFinish: async ({ text, usage }) => {
  console.log(`[tokens] prompt=${usage.promptTokens} completion=${usage.completionTokens}`);
  await saveMessage(sessionId, 'assistant', text);
  await updateLastActivity(sessionId);
},
```

---

## Phase 7 — File Uploads
**Goal:** Client can upload logos, headshots, and photos directly within the chat interface. Files go to Supabase Storage. Asset records are created in the DB.
**Credentials needed:** Supabase (already configured)

> **Build timing note:** The file upload UI is used during Agent Phase 5 (Assets) of the conversation. Development Phase 7 can be built after Development Phase 6 (agent logic) without blocking it — just render a placeholder "File uploads coming soon" in the chat until this phase is complete. Do not let this hold up testing the full conversation flow.

### Upload route: `POST /api/upload`

```typescript
// Receives: FormData with file + sessionId + assetCategory
// 1. Validate session exists
// 2. Validate file type and size (max 300MB, allowed MIME types)
// 3. Generate storage path: sessions/{sessionId}/{uuid}-{filename}
// 4. Upload to Supabase Storage (service role key)
// 5. Get public URL (or signed URL if bucket is private)
// 6. Insert row into assets table
// 7. Return { assetId, publicUrl }
```

### UI component: `<FileUploadButton>`

- Appears in the chat when the agent enters Phase 5
- Accepts: jpg, gif, png, tif, pdf
- Shows upload progress bar
- On success: sends a system message to the chat: "Uploaded: [filename]"
- Multiple files can be uploaded sequentially
- Drag-and-drop support (optional, nice to have)

### Tasks
- [ ] Build `POST /api/upload/route.ts`
- [ ] Build `<FileUploadButton>` component
- [ ] Show upload button in chat only when `session.current_phase >= 5`
- [ ] Show uploaded file list in chat thread (read from `assets` table on load)
- [ ] Validate file types and sizes client-side before upload (better UX)
- [ ] Validate again server-side (security)

### Failure points
- **Large file timeouts** — Vercel's default function timeout is 10 seconds (Hobby) or 60 seconds (Pro). A 300MB file upload will exceed 10 seconds on most connections. Options: (a) use Vercel Pro, or (b) use Supabase's direct upload URL (bypass the Next.js function entirely). Recommend: generate a signed upload URL from the API route, then upload directly from the browser to Supabase. The Next.js route only records the asset in the DB after upload.
- **Missing MIME type validation** — browsers can lie about file types. Validate by reading file magic bytes server-side (use `file-type` npm package).

---

## Phase 8 — Admin Dashboard
**Goal:** Admins can view all sessions, track progress, review collected data, override fields, and approve sessions.
**Credentials needed:** None additional

### Pages

**`/admin/dashboard`** — Session list
- Table: client URL (first 20 chars), website URL, status badge, phase indicator, last activity, days since activity, action buttons
- Filter by status (pending / in_progress / completed / approved)
- Sort by last activity (most stale at top for follow-up)
- Button: "New Session" → MFP upload flow

**`/admin/sessions/[id]`** — Session detail
- Left panel: Chat transcript (read-only, shows full conversation)
- Right panel: Schema data viewer — all collected fields, organized by section
  - Each field shows: value + whether it came from MFP (auto) or conversation (user)
  - Inline edit for any field (admin override)
- Status banner: pending / in_progress / completed / awaiting approval
- When status is `completed`: shows **Approve** button
- Approve triggers: PDF generation → Basecamp project creation → status update to `approved`

### Tasks
- [ ] Build `/admin/dashboard/page.tsx` with session table
- [ ] Build session status badge component (color-coded: gray/blue/green/purple)
- [ ] Build phase progress indicator (0–7 steps)
- [ ] Build `/admin/sessions/[id]/page.tsx` with transcript + schema viewer
- [ ] Build inline field editor (click to edit, save on blur)
- [ ] Build `PATCH /api/sessions/[id]` route — handles schema field updates and status changes
- [ ] Build Approve button → triggers Phase 10 + 11 pipeline
- [ ] Add "Send Reminder" manual button (sends one-off email regardless of inactivity timer)

### Failure points
- **Admin editing schema data** — store admin overrides with a flag so it's clear what was provided by the client vs. overridden by admin. Add `_adminOverrides: { "field.path": true }` to schema_data.
- **Approve button double-tap** — the approval triggers Basecamp project creation. Disable the button immediately on click, show a spinner, and check `basecamp_project_id` is null before proceeding server-side.

---

## Phase 9 — Inactivity Monitoring & Email
**Goal:** If a session has no activity for 3 days, send a reminder email to the admin and the client email (if collected). Continue sending reminders until session is completed.
**Credentials needed:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

### Email templates

Two templates needed:
1. **Client reminder** — "Hi [name], you started your website intake a few days ago and we want to make sure you can finish at your convenience. [Link] Your progress is saved."
2. **Admin reminder** — "Session for [website_url] has been inactive for [N] days. [Link to admin session]"

Build these as React Email components (`@react-email/components` + `react-email`) for proper formatting.

### Cron job: `POST /api/cron/check-inactivity`

Called daily by Vercel Cron.

```typescript
// vercel.json
{
  "crons": [{
    "path": "/api/cron/check-inactivity",
    "schedule": "0 14 * * *"   // 2pm UTC daily
  }]
}
```

```typescript
// Logic:
// 1. Validate Authorization header = `Bearer {CRON_SECRET}`
// 2. Query sessions WHERE status IN ('pending', 'in_progress')
//    AND last_activity_at < NOW() - INTERVAL '3 days'
//    AND status != 'approved'
// 3. For each: send client email (if client_email is set) + admin email
// 4. Insert row into reminders table
// 5. Increment session.reminder_count
// Note: no max reminder count — continues until session completes
```

### Tasks
- [ ] Set up Resend account, verify sending domain
- [ ] Build email templates with `react-email`
- [ ] Build `POST /api/cron/check-inactivity/route.ts`
- [ ] Add `vercel.json` with cron schedule
- [ ] Add `CRON_SECRET` to Vercel env vars
- [ ] Test: manually call the cron route with the correct auth header
- [ ] Verify reminder rows appear in DB and emails arrive

### Failure points
- **Cron not firing on Vercel Hobby** — Vercel Hobby supports cron jobs but limits to 2 per project and minimum 1-day interval. This fits our daily check. If more frequent checks are needed later, upgrade to Pro.
- **Client email not yet collected** — Phase 1 collects the client email. If a session never got past "pending" (client never opened the link), `client_email` is null. Still send the admin email; skip the client email.
- **Duplicate reminders** — the cron runs daily. If it sends a reminder on day 3 and the client doesn't respond, it will send again on day 4, 5, etc. This is intentional per spec. The `reminders` table logs all sends.
- **CRON_SECRET missing** — the route must return 401 if the header is absent or wrong. Without this, anyone who discovers the URL can spam reminder emails.

---

## Phase 10 — Basecamp Integration
**Goal:** Admin approves a completed session. System creates a Basecamp project, posts the intake summary as a message, attaches the PDF, and uploads all assets to the project vault.
**Credentials needed:** `BASECAMP_CLIENT_ID`, `BASECAMP_CLIENT_SECRET`, `BASECAMP_ACCOUNT_ID`

### OAuth Setup (one-time, done by admin in the dashboard)

Basecamp uses OAuth 2.0 with refresh tokens.

1. Register the app at `launchpad.37signals.com/integrations`:
   - Redirect URI: `https://onboard.countingfive.com/api/basecamp/callback`
   - Note the Client ID and Client Secret
2. Build `/api/basecamp/auth` route — redirects to Basecamp's OAuth URL
3. Build `/api/basecamp/callback` route — exchanges code for tokens, stores in `basecamp_tokens` table
4. Build a "Connect Basecamp" button in the admin dashboard (only needs to be clicked once ever)

```typescript
// Token refresh helper — call before any Basecamp API request
async function getValidToken(): Promise<string> {
  const token = await getStoredToken();
  if (token.expires_at > new Date()) return token.access_token;
  
  const refreshed = await refreshBasecampToken(token.refresh_token);
  await updateStoredToken(refreshed);
  return refreshed.access_token;
}
```

### Project creation sequence

Triggered by admin clicking Approve:

```typescript
// lib/basecamp/create-project.ts
// 1. GET valid access token
// 2. POST /projects.json → create project named "Korbey Lague PLLP — Website Build"
// 3. GET project message board URL from project response
// 4. POST message to message board with formatted intake summary (rich HTML)
// 5. For each asset: POST /attachments.json with file binary, get attachable_sgid
// 6. If PDF exists: POST PDF attachment, get attachable_sgid
// 7. PATCH the message to include <bc-attachment sgid="..."> tags for all files
// 8. Update session: set basecamp_project_id, status = 'approved'
// 9. Set a content_generation_ready flag in the session (boolean) — the
//    content generation process reads this flag to know it can begin.
//    The actual content generation pipeline is a separate future system.
```

### Tasks
- [ ] Register Basecamp OAuth app (admin does this manually before development)
- [ ] Build OAuth flow: `/api/basecamp/auth` + `/api/basecamp/callback`
- [ ] Build `lib/basecamp/client.ts` — wrapper with auto token refresh
- [ ] Build `lib/basecamp/create-project.ts` — full project creation sequence
- [ ] Add Approve button handler in admin dashboard
- [ ] Show Basecamp project link in admin session detail after approval

### Failure points
- **Token expiry** — Basecamp access tokens expire after 2 weeks. Always refresh before use. The `getValidToken()` helper must be called at the start of every Basecamp API interaction.
- **Attachment upload order** — the message must be created first (as plain text), then all files attached, then the message updated with `<bc-attachment>` tags. The Basecamp API requires this sequence.
- **Rate limiting** — Basecamp allows 50 requests per 10 seconds. If a project has many assets, batch uploads carefully. Add a 200ms delay between attachment uploads.
- **Large file uploads** — Supabase Storage files must be fetched server-side (using signed URLs) and then re-uploaded to Basecamp. For large files, this is a memory concern in serverless functions. Stream the file from Supabase to Basecamp without buffering the full file in memory.

---

## Phase 11 — PDF Generation
**Goal:** When admin approves, generate a formatted PDF summary of all session data and upload it to Supabase Storage (to be attached to Basecamp).
**Credentials needed:** None additional

### PDF structure (using `@react-pdf/renderer`)

```
Page 1: Intake Summary
  - Firm name + website
  - Contact info
  - Date completed / approved

Pages 2+: Data sections (one per section)
  - Locations (all)
  - Team members (all)
  - Services & offerings
  - Industry niches + ICPs
  - Positioning selection
  - Technical / domain info
  - Client base info
  - Differentiators + success stories
  - Firm history + culture
  - Social media + affiliations
  - Assets inventory (list of what was uploaded)
  - Additional notes
```

### Tasks
- [ ] Build `lib/pdf/generate-pdf.ts` — takes session schema, returns PDF buffer
- [ ] Build React PDF components for each section
- [ ] Build `POST /api/pdf/generate` route:
  - Generates PDF
  - Uploads to Supabase Storage at `pdfs/{sessionId}/intake-summary.pdf`
  - Updates `sessions.pdf_url`
  - Returns URL
- [ ] Trigger PDF generation as first step of the Approve action (before Basecamp calls)

### Failure points
- **`@react-pdf/renderer` in Next.js App Router** — the library requires a Node.js runtime (not edge). In the route file, add `export const runtime = 'nodejs'` and `export const maxDuration = 30` (requires Vercel Pro for durations above 10s). Test PDF generation locally before assuming it works on Vercel.
- **Memory usage** — generating a large PDF with embedded images is memory-intensive. Do not embed the actual uploaded images in the PDF; instead reference them by filename. This keeps the PDF small and avoids memory issues.
- **PDF generation timeout** — complex PDFs can take 5–15 seconds. Vercel Hobby has a 10-second function timeout. Either upgrade to Pro or move PDF generation to a background job (Supabase Edge Function or a separate worker).

---

## Phase 12 — Testing & Hardening
**Goal:** The full flow works end-to-end without errors. Edge cases handled gracefully. Security reviewed.
**Credentials needed:** All (full environment needed)

### End-to-end test flow

Run this manually before launch:
1. Upload Korbey Lague MFP → verify session created, schema seeded correctly
2. Copy client URL, open in incognito → verify no admin session bleeds through
3. Complete Phase 1 (provide contact info)
4. Verify WHOIS lookup fires and populates technical fields
5. Walk through Phase 3 (confirm all 6 sub-sections)
6. Walk through Phase 4 (answer gap questions, skip 2 explicitly)
7. Upload 3 test files in Phase 5
8. Confirm final summary (Phase 6)
9. In admin: review data, edit one field, click Approve
10. Verify: PDF generated, Basecamp project created, message posted, assets uploaded
11. Verify: client URL now shows "completed" screen
12. Let session sit 3+ days (or manually call cron route) → verify reminder emails arrive

### Security checklist
- [ ] Service role key never referenced in any client component (grep for `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] All admin routes return 401/403 if auth check fails (not just redirect)
- [ ] `/api/cron/*` routes reject requests without valid `CRON_SECRET`
- [ ] `/api/upload` validates file type by magic bytes, not just extension or MIME header
- [ ] Session IDs are UUID v4 — no sequential IDs that could be enumerated
- [ ] No session data is returned to the client beyond what's needed for the current phase
- [ ] Basecamp tokens stored in DB, not in environment variables (they rotate)
- [ ] Admin login rate-limited (Supabase Auth handles this by default)

### Error handling checklist
- [ ] Claude API failure → show "something went wrong, try again" message; do not lose message history
- [ ] WHOIS failure → advance phase anyway, leave technical fields empty (they become Phase 4 gaps)
- [ ] File upload failure → show error in UI, allow retry; do not advance chat state
- [ ] Basecamp API failure → do not mark session as approved; show error to admin with retry button
- [ ] PDF generation failure → same as Basecamp: block approval until resolved; log the error

### Performance
- [ ] Conversation history trimmed to last 40 messages before sending to Claude
- [ ] Session list in admin dashboard paginated (don't load all sessions at once)
- [ ] Supabase queries use indexed columns for filters

---

## Build Order Summary

| Phase | What you have after | Roughly |
|---|---|---|
| 1 — Foundation | Deployed Next.js on Vercel, domain working | Day 1 |
| 2 — Schema | All DB tables, types, RLS | Day 1–2 |
| 3 — Admin Auth | Admin can log in | Day 2 |
| 4 — MFP Parser | Admin can upload MFP, session created, URL generated | Day 3–4 |
| 5 — Chat Interface | Client can have a streaming conversation, state saved | Day 5–7 |
| 6 — Phase Logic | Full 8-phase agent flow working correctly | Day 8–11 |
| 7 — File Uploads | Client can upload logos/photos in chat | Day 12 |
| 8 — Admin Dashboard | Admin can review, edit, and approve sessions | Day 13–15 |
| 9 — Email / Cron | Inactivity reminders firing automatically | Day 16 |
| 10 — Basecamp | Approval creates Basecamp project with all data | Day 17–18 |
| 11 — PDF | Intake summary PDF generated and attached | Day 19–20 |
| 12 — Testing | Full flow tested, edge cases handled | Day 21–22 |

---

## Appendix: First-Time Setup Checklist

Before deploying to production, verify each of the following:

- [ ] All env vars set in Vercel (not just `.env.local`)
- [ ] Supabase RLS enabled on all tables
- [ ] Supabase Auth signups disabled
- [ ] Storage bucket `session-assets` created with correct size/type limits
- [ ] DNS CNAME record propagated and SSL active on Vercel
- [ ] Basecamp OAuth app registered with correct redirect URI
- [ ] Basecamp connected in admin dashboard (OAuth flow completed once)
- [ ] Resend domain verified and from-address matches verified domain
- [ ] Vercel Cron configured in `vercel.json`
- [ ] `CRON_SECRET` set in Vercel env vars
- [ ] First admin user created in Supabase Auth + `admins` table
- [ ] MFP parser unit-tested against at least one real MFP file
