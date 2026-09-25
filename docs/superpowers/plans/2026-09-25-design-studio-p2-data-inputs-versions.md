# Design Studio P2 — Data Model, Inputs, Baseline Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Design Studio memory. P2 makes these things possible:
- **Persist Design Studio state** in five new admin-only tables (`design_inputs`, `design_runs`, `design_concepts`, `design_versions`, `design_chat_messages`). Runs, concepts and chat are created now so P3–P5 need no migration.
- **Collect design inputs:** inspiration / competitor / current-site URLs (captured to screenshots through ScrapingBee) and uploaded inspiration images, all stored privately under `design/{sessionId}/inputs/`.
- **Track theme versions:** on first Studio load the current draft theme is imported as **v0 (baseline)**. The Studio then flags **drift** (the draft's theme files changed outside the Studio since the latest version) and a **stale `theme.css`**.
- **A "Studio | Controls" tab pair** in Theme Studio. Controls is today's UI, untouched. Studio shows the inputs and versions panels.

**Architecture:**
- **Pure, client-safe units** (`studio-types.ts`, `input-validation.ts`, `studio-dto.ts`, `drift.ts`) hold the constants, validation, DTO mapping and drift maths. They are unit-tested without I/O.
- **Server-only units:** `store.ts` (typed Supabase access, every input/version query scoped by `session_id`), `theme-snapshot.ts` (current draft theme blob shas + texts from ONE cached `listTree`), `sweep.ts` (stale-row sweep called by the existing cron).
- **Routes** under `app/api/edit/[id]/design/**` all start with `requireDesignAdmin(id)`, return typed 4xx, and send 5xx through `internalError`.
- **UI** in `components/design-studio/*` (client components). They talk only to the routes; they never touch Supabase or storage directly.

**Tech Stack:** Next.js 16.3.5 (App Router, Node runtime), TypeScript strict, vitest 4, Supabase (Postgres + private Storage), sharp 0.35, file-type 22, ScrapingBee (via the P1 `captureExternalScreenshot`), Tailwind v4 tokens.

**Spec:** `docs/superpowers/specs/2026-09-24-design-studio-design.md`. Read §Data model, §Versioning semantics, §Storage, §Safety and validation (Inputs), and §Phased delivery → P2.

## Global Constraints

- **Access:**
  - Admin-only. Every new `app/api/edit/[id]/design/**` route calls `requireDesignAdmin(id)` (`app/api/edit/[id]/design/_design.ts`) as its FIRST step and returns its `NextResponse` unchanged (403 for non-admins).
  - Every route that takes an `inputId` validates it as a UUID (400), then loads/updates/deletes it **scoped to `ctx.sessionId` as well as `id`**. An id from another session is "not found" (404). Never trust a client id or a client-sent session id.
  - RLS on all five tables is admin-tier only (`admins.role = 'admin'`). The app gate is the real gate; routes use the service-role client.
- **Storage:**
  - The `session-assets` bucket is private. Design images go under `design/{sessionId}/inputs/…`, WebP only, built with `designStoragePath()`.
  - Signed URLs only (`signDesignPaths`, TTL 3600). Never call `.getPublicUrl()`. Never write to the `assets` table from design code.
  - Uploads are stored without upsert. A re-capture writes a NEW object (`{inputId}-{uuid}.webp`) and then deletes the previous one.
- **Uploads (CLAUDE.md rule 3):** ≤ 8 MB, magic bytes via `file-type` (PNG / JPEG / WebP only), re-encoded with sharp (`toWebp`, strips metadata) BEFORE anything is written. Nothing is stored if validation fails; if the DB insert fails after the object was stored, the object is deleted.
- **URLs:** http(s) only, ≤ 300 chars, no credentials. The inputs route never fetches the URL. The capture route calls `captureExternalScreenshot`, which runs `isUrlPubliclyFetchable` before spending a ScrapingBee credit. Stored `capture_error` text is our own reason string, never provider text.
- **Data:**
  - Supabase JS client only, typed via `types/database.ts`. JSONB is written with `asJson()`. No raw SQL in app code.
  - `types/database.ts` is **hand-patched** in Task 1 for the five tables. The user regenerates it later (`npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts`); the result should match up to ordering.
  - `design_versions.applied_blobs` is ALWAYS the full blob-sha map of the four theme files after the version was applied (not just the changed paths). Drift compares against it.
- **Errors and logging:**
  - 5xx responses use `internalError(context, err, publicMessage)` from `lib/api/errors.ts`. Deliberate 4xx responses keep their messages.
  - No `console.log` in `app/` or `lib/`: use `console.warn` / `console.error`.
- **Types and client/server boundary:**
  - No `as any`. API request bodies have explicit `interface`s.
  - `store.ts`, `theme-snapshot.ts`, `sweep.ts`, `storage.ts` and `capture/**` are server-only: never import them from a `'use client'` file or from `studio-types.ts` / `studio-dto.ts` / `input-validation.ts` / `drift.ts`.
- **UI:** `raw-docs/design.md` rules: Tailwind token classes only (no hex, no raw semantic colours; use `error` / `warning` / `success` tokens), pill buttons (`rounded-pill`), Inter headings (`font-heading`) / Open Sans body (`font-body`), navy-tinted shadows (`shadow-subtle`), visible focus states, no inline style overrides. No `localStorage` / `sessionStorage`. No `window.confirm` (use `InlineConfirm`, Task 10).
- **Checks:**
  - After each task: `npx tsc --noEmit` is clean and `npm run lint` reports no errors.
  - Before each commit, these three greps return zero matches:
    ```bash
    grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app
    grep -r "GITHUB_APP_PRIVATE_KEY" ./app
    grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx"
    ```
- **Commits:**
  - Stage explicit paths only. Never `git add -A` / `git add .`. **Do not touch `CLAUDE.md`** (it has the user's uncommitted edits).
  - End every commit message with a `Co-Authored-By:` line naming the model that wrote it.
- **Branch:** the controller creates `feat/design-studio-p2` from `master` (c5980f3) BEFORE Task 1. Implementers do not create or switch branches.
- **Migrations:** the USER applies `supabase/078_design_studio.sql` in the Supabase SQL editor. Implementers never run migrations.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/078_design_studio.sql` | create | Five tables, CHECKs, indexes, one-active-run partial unique index, admin-tier RLS, verification queries |
| `types/database.ts` | modify | Hand-patched Row/Insert/Update/Relationships for the five tables |
| `lib/design/studio-types.ts` | create | Client-safe status/kind constants (mirror the SQL CHECKs), limits, DTO + state types |
| `lib/design/migration-078.test.ts` | create | Parity: SQL CHECK lists ⇔ TS constants; RLS on every table |
| `lib/design/__fixtures__/fake-supabase.ts` | create | Chainable Supabase test double (records ops, pops queued results) |
| `lib/design/__fixtures__/rows.ts` | create | `makeInputRow`, `makeVersionRow`, test ids |
| `lib/design/storage.ts` | modify | + `removeDesignPaths()` |
| `lib/design/storage.test.ts` | modify | + `removeDesignPaths` tests |
| `lib/design/store.ts` | create | Typed inputs/versions access, `claimCapture`, `insertVersion` (23505 retry), `getBaselineOrCreate`, `readSessionSchema` |
| `lib/design/store.test.ts` | create | |
| `lib/design/drift.ts` | create | Pure: `THEME_FILE_PATHS`, `computeDrift`, `toBlobMap`, `isThemeCssStale` |
| `lib/design/drift.test.ts` | create | |
| `lib/design/theme-snapshot.ts` | create | Server-only: `readDraftThemeSnapshot()` (listTree + sha-keyed text cache) |
| `lib/design/theme-snapshot.test.ts` | create | |
| `lib/design/input-validation.ts` | create | Pure: `isUuid`, `isPlainObject`, `parseUrlInputKind`, `normalizeInputUrl`, `parseOptionalText`, `displayHost` |
| `lib/design/input-validation.test.ts` | create | |
| `lib/design/studio-dto.ts` | create | Pure: `toInputDto`, `toVersionDto`, `versionScreenshotPaths`, `buildInputSuggestions` |
| `lib/design/studio-dto.test.ts` | create | |
| `app/api/edit/[id]/design/route.ts` | create | GET studio state (lazy baseline v0, drift, stale theme.css, inputs, suggestions) |
| `app/api/edit/[id]/design/route.test.ts` | create | |
| `app/api/edit/[id]/design/inputs/route.ts` | create | GET list, POST create URL input |
| `app/api/edit/[id]/design/inputs/route.test.ts` | create | |
| `app/api/edit/[id]/design/inputs/[inputId]/route.ts` | create | PATCH label/notes/archived, DELETE (+ storage object) |
| `app/api/edit/[id]/design/inputs/[inputId]/route.test.ts` | create | |
| `app/api/edit/[id]/design/inputs/[inputId]/capture/route.ts` | create | POST capture/re-capture via ScrapingBee |
| `app/api/edit/[id]/design/inputs/[inputId]/capture/route.test.ts` | create | |
| `app/api/edit/[id]/design/inputs/upload/route.ts` | create | POST multipart inspiration image |
| `app/api/edit/[id]/design/inputs/upload/route.test.ts` | create | |
| `lib/design/sweep.ts` | create | `sweepStuckDesignRows()` (inputs 10 min, runs/concepts 15 min) |
| `lib/design/sweep.test.ts` | create | |
| `app/api/cron/sweep-stuck-jobs/route.ts` | modify | Call `sweepStuckDesignRows`, report counts |
| `components/design-studio/api.ts` | create | Client fetch helper |
| `components/design-studio/styles.ts` | create | Shared token class strings |
| `components/design-studio/InlineConfirm.tsx` | create | Two-step inline confirm (no browser dialog) |
| `components/design-studio/InputCard.tsx` | create | One input: thumbnail, capture, edit, archive, delete |
| `components/design-studio/InputsPanel.tsx` | create | Suggestions, add URL, upload, list |
| `components/design-studio/VersionsPanel.tsx` | create | Versions list, baseline error, drift banner, stale theme.css notice |
| `components/design-studio/DesignStudio.tsx` | create | Fetches GET /design, lays out the two panels |
| `components/editor/ThemeStudio.tsx` | modify | "Studio \| Controls" tabs |

---

### Task 1: Migration 078, hand-patched types, and the shared constants

**Files:**
- Create: `supabase/078_design_studio.sql`, `lib/design/studio-types.ts`, `lib/design/migration-078.test.ts`
- Modify: `types/database.ts`

**Interfaces:**
- Consumes: `BUNDLE_SOURCES`, `DesignBundle` from `lib/design/bundle.ts`.
- Produces (all from `lib/design/studio-types.ts`):
  - `DESIGN_INPUT_KINDS`, `DesignInputKind`, `URL_INPUT_KINDS`, `UrlInputKind`, `CAPTURE_STATUSES`, `CaptureStatus`, `RUN_STATUSES`, `RunStatus`, `RUN_ACTIVE_STATUSES`, `CONCEPT_STATUSES`, `ConceptStatus`, `CONCEPT_ACTIVE_STATUSES`, `PALETTE_FREEDOMS`, `CHAT_ROLES`, `VERSION_SOURCES`, `VersionSource`
  - `MAX_INPUT_URL_LENGTH = 300`, `INPUT_LABEL_MAX = 120`, `INPUT_NOTES_MAX = 2000`, `INPUT_KIND_LABELS`
  - `type ThemeBlobShas = Record<string, string>`
  - `DesignInputDto`, `DesignVersionDto`, `DriftStatus`, `DriftResult`, `BaselineStatus`, `InputSuggestions`, `DesignStudioState`
  - Tables `design_inputs`, `design_runs`, `design_concepts`, `design_versions`, `design_chat_messages` in `Database['public']['Tables']`.

- [ ] **Step 1: Confirm the branch.** The controller already created it. Run `git branch --show-current`.
Expected: `feat/design-studio-p2`. If it prints anything else, STOP and report. Do not create or switch branches.

- [ ] **Step 2: Create `lib/design/studio-types.ts`.**

```ts
// Client-safe constants + DTO types for the Design Studio. The CHECK lists in
// supabase/078_design_studio.sql must match these arrays exactly — enforced by
// lib/design/migration-078.test.ts. Import freely from client components.
import { BUNDLE_SOURCES } from './bundle'

export const DESIGN_INPUT_KINDS = ['inspiration_url', 'inspiration_image', 'competitor_url', 'current_site'] as const
export type DesignInputKind = (typeof DESIGN_INPUT_KINDS)[number]

// The kinds an admin adds by URL (inspiration_image arrives by upload only).
export const URL_INPUT_KINDS = ['inspiration_url', 'competitor_url', 'current_site'] as const satisfies readonly DesignInputKind[]
export type UrlInputKind = (typeof URL_INPUT_KINDS)[number]

export const CAPTURE_STATUSES = ['none', 'pending', 'ok', 'error'] as const
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number]

export const RUN_STATUSES = ['queued', 'capturing', 'generating', 'refining', 'ready', 'applied', 'cancelled', 'error'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
// A run in one of these holds the session's single "active run" slot (partial
// unique index) and is swept to 'error' after 15 minutes without an update.
export const RUN_ACTIVE_STATUSES = ['queued', 'capturing', 'generating', 'refining'] as const satisfies readonly RunStatus[]

export const CONCEPT_STATUSES = ['pending', 'generating', 'refining', 'ready', 'rejected', 'error'] as const
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number]
export const CONCEPT_ACTIVE_STATUSES = ['generating', 'refining'] as const satisfies readonly ConceptStatus[]

export const PALETTE_FREEDOMS = ['keep', 'evolve', 'free'] as const
export const CHAT_ROLES = ['user', 'assistant'] as const

export const VERSION_SOURCES = BUNDLE_SOURCES
export type VersionSource = (typeof VERSION_SOURCES)[number]

export const MAX_INPUT_URL_LENGTH = 300
export const INPUT_LABEL_MAX = 120
export const INPUT_NOTES_MAX = 2000

export const INPUT_KIND_LABELS: Record<DesignInputKind, string> = {
  inspiration_url: 'Inspiration site',
  inspiration_image: 'Inspiration image',
  competitor_url: 'Competitor',
  current_site: 'Client’s current site',
}

// Repo path → git blob sha for the theme files that exist on a branch. A path
// that is absent from the map is absent from the branch.
export type ThemeBlobShas = Record<string, string>

export type DesignInputDto = {
  id: string
  kind: DesignInputKind
  url: string | null
  label: string | null
  notes: string | null
  captureStatus: CaptureStatus
  captureError: string | null
  capturedAt: string | null
  archived: boolean
  // Short-lived signed URL of the stored screenshot/image, or null.
  thumbnailUrl: string | null
  createdAt: string
}

export type DesignVersionDto = {
  id: string
  versionNo: number
  source: VersionSource
  name: string
  summary: string | null
  appliedCommitSha: string | null
  createdAt: string
  screenshotUrls: string[]
}

export type DriftStatus = 'in-sync' | 'drifted' | 'no-baseline'
export type DriftResult = { status: DriftStatus; changedPaths: string[]; sinceVersion: number | null }

export type BaselineStatus = { status: 'ok'; created: boolean } | { status: 'error'; error: string }

export type InputSuggestions = { currentSite: string | null; competitors: { name: string }[] }

export type DesignStudioState = {
  versions: DesignVersionDto[] // newest first
  latest: DesignVersionDto | null
  drift: DriftResult
  baseline: BaselineStatus
  // true = committed theme.css ≠ generateThemeCss(brand, design); null = can't tell.
  themeCssStale: boolean | null
  inputs: DesignInputDto[]
  suggestions: InputSuggestions
}
```

- [ ] **Step 3: Write the failing parity test** `lib/design/migration-078.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CAPTURE_STATUSES,
  CHAT_ROLES,
  CONCEPT_STATUSES,
  DESIGN_INPUT_KINDS,
  PALETTE_FREEDOMS,
  RUN_ACTIVE_STATUSES,
  RUN_STATUSES,
  VERSION_SOURCES,
} from './studio-types'

const SQL = readFileSync(path.join(process.cwd(), 'supabase', '078_design_studio.sql'), 'utf-8')
const TABLES = ['design_inputs', 'design_runs', 'design_concepts', 'design_versions', 'design_chat_messages']

function tableBlock(table: string): string {
  const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
  if (start === -1) throw new Error(`table ${table} not found`)
  return SQL.slice(start, SQL.indexOf('\n);', start))
}

function quoted(list: string): string[] {
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function checkList(table: string, column: string): string[] {
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(tableBlock(table))
  if (!m) throw new Error(`no CHECK list for ${table}.${column}`)
  return quoted(m[1])
}

describe('migration 078 ⇔ studio-types parity', () => {
  it.each([
    ['design_inputs', 'kind', DESIGN_INPUT_KINDS],
    ['design_inputs', 'capture_status', CAPTURE_STATUSES],
    ['design_runs', 'status', RUN_STATUSES],
    ['design_runs', 'palette_freedom', PALETTE_FREEDOMS],
    ['design_concepts', 'status', CONCEPT_STATUSES],
    ['design_versions', 'source', VERSION_SOURCES],
    ['design_chat_messages', 'role', CHAT_ROLES],
  ] as const)('%s.%s matches', (table, column, values) => {
    expect(checkList(table, column)).toEqual([...values])
  })

  it('the one-active-run index covers exactly RUN_ACTIVE_STATUSES', () => {
    const m = /design_runs_one_active_per_session\s+ON design_runs \(session_id\)\s+WHERE status IN \(([^)]*)\)/.exec(SQL)
    expect(m).not.toBeNull()
    expect(quoted(m?.[1] ?? '')).toEqual([...RUN_ACTIVE_STATUSES])
  })

  it('versions are unique per session', () => {
    expect(tableBlock('design_versions')).toContain('UNIQUE (session_id, version_no)')
  })

  it.each(TABLES)('%s has RLS and an admin-tier policy', (table) => {
    expect(SQL).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    expect(SQL).toMatch(new RegExp(`CREATE POLICY "Admin tier manages ${table}"[\\s\\S]*?admins\\.role = 'admin'`))
  })

  it.each(TABLES)('%s cascades from sessions', (table) => {
    expect(tableBlock(table)).toContain('REFERENCES sessions(id) ON DELETE CASCADE')
  })
})
```

- [ ] **Step 4: Run it and confirm it fails.**
Run: `npx vitest run lib/design/migration-078.test.ts`
Expected: FAIL (ENOENT: `supabase/078_design_studio.sql` not found).

- [ ] **Step 5: Create `supabase/078_design_studio.sql`.**

```sql
-- ============================================================
-- 078: Design Studio — inputs, runs, concepts, versions, chat
-- Run this entire file in Supabase → SQL Editor.
-- IDEMPOTENT: every CREATE uses IF NOT EXISTS and every policy is dropped and
-- recreated, so re-running the file is safe. It never alters or drops an
-- existing table or its data.
-- ============================================================
-- Admin-only feature (docs/superpowers/specs/2026-09-24-design-studio-design.md).
-- App routes gate with requireDesignAdmin() and use the service-role client
-- (bypasses RLS). The admin-TIER policies below (admins.role = 'admin') block
-- every stray anon/authenticated path, including member/manager/editor/owner
-- accounts that pass the older admins-membership policies.
--
-- design_inputs is deliberately separate from `assets`: nothing here may leak
-- into deliverables. Images live in the PRIVATE session-assets bucket under
-- design/{session_id}/…; only the storage path is stored (signed URLs only).
--
-- updated_at is stamped by the app on every write (no trigger — matches the
-- rest of the schema); the sweep cron keys on it. design_versions and
-- design_chat_messages are append-only, so they carry created_at only.
--
-- design_runs / design_concepts / design_chat_messages are created now (unused
-- until P3–P5) so later phases need no migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS design_inputs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind            text        NOT NULL
                    CHECK (kind IN ('inspiration_url', 'inspiration_image', 'competitor_url', 'current_site')),
  url             text        DEFAULT NULL CHECK (url IS NULL OR char_length(url) <= 300),
  label           text        DEFAULT NULL CHECK (label IS NULL OR char_length(label) <= 120),
  notes           text        DEFAULT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  storage_path    text        DEFAULT NULL CHECK (storage_path IS NULL OR storage_path LIKE 'design/%'),
  capture_status  text        NOT NULL DEFAULT 'none'
                    CHECK (capture_status IN ('none', 'pending', 'ok', 'error')),
  capture_error   text        DEFAULT NULL CHECK (capture_error IS NULL OR char_length(capture_error) <= 500),
  captured_at     timestamptz DEFAULT NULL,
  archived        boolean     NOT NULL DEFAULT false,
  created_by      uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- URL kinds need a url; uploaded images never have one.
  CONSTRAINT design_inputs_url_matches_kind CHECK ((kind = 'inspiration_image') = (url IS NULL))
);

CREATE TABLE IF NOT EXISTS design_runs (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status           text          NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'capturing', 'generating', 'refining', 'ready', 'applied', 'cancelled', 'error')),
  stage            text          DEFAULT NULL,
  admin_brief      text          DEFAULT NULL CHECK (admin_brief IS NULL OR char_length(admin_brief) <= 4000),
  palette_freedom  text          NOT NULL DEFAULT 'evolve'
                     CHECK (palette_freedom IN ('keep', 'evolve', 'free')),
  concept_count    integer       NOT NULL DEFAULT 3 CHECK (concept_count BETWEEN 1 AND 3),
  -- The design_inputs the admin picked for this run (RunLauncher, P3).
  input_ids        uuid[]        NOT NULL DEFAULT '{}',
  capabilities     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  base_snapshot    jsonb         DEFAULT NULL,
  cost_usd         numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cost_cap_usd     numeric(10,4) NOT NULL DEFAULT 4 CHECK (cost_cap_usd > 0),
  max_revisions    integer       NOT NULL DEFAULT 2 CHECK (max_revisions BETWEEN 0 AND 5),
  error            text          DEFAULT NULL,
  created_by       uuid          DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- One active run per session. Terminal statuses (ready/applied/cancelled/error)
-- release the slot; the sweep cron errors a stalled active run after 15 min.
CREATE UNIQUE INDEX IF NOT EXISTS design_runs_one_active_per_session
  ON design_runs (session_id)
  WHERE status IN ('queued', 'capturing', 'generating', 'refining');

CREATE TABLE IF NOT EXISTS design_concepts (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid          NOT NULL REFERENCES design_runs(id) ON DELETE CASCADE,
  session_id      uuid          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position        integer       NOT NULL CHECK (position BETWEEN 0 AND 2),
  status          text          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'generating', 'refining', 'ready', 'rejected', 'error')),
  bundle          jsonb         DEFAULT NULL,
  initial_bundle  jsonb         DEFAULT NULL,
  critique        jsonb         DEFAULT NULL,
  iterations      integer       NOT NULL DEFAULT 0 CHECK (iterations >= 0),
  screenshots     jsonb         NOT NULL DEFAULT '[]'::jsonb,
  cost_usd        numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  error           text          DEFAULT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT design_concepts_run_position_key UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS design_versions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version_no          integer     NOT NULL CHECK (version_no >= 0),
  source              text        NOT NULL
                        CHECK (source IN ('baseline', 'concept', 'chat', 'revert', 'import')),
  bundle              jsonb       NOT NULL,
  summary             text        DEFAULT NULL CHECK (summary IS NULL OR char_length(summary) <= 500),
  concept_id          uuid        DEFAULT NULL REFERENCES design_concepts(id) ON DELETE SET NULL,
  applied_commit_sha  text        DEFAULT NULL,
  -- FULL post-apply blob shas of the four theme files (drift compares to this).
  applied_blobs       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  screenshots         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by          uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_versions_session_version_key UNIQUE (session_id, version_no)
);

CREATE TABLE IF NOT EXISTS design_chat_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL DEFAULT '',
  parts           jsonb       DEFAULT NULL,
  -- Attachments are referenced by id only (spec); images live in storage.
  attachment_ids  uuid[]      NOT NULL DEFAULT '{}',
  version_id      uuid        DEFAULT NULL REFERENCES design_versions(id) ON DELETE SET NULL,
  created_by      uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_inputs_session   ON design_inputs (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_design_inputs_pending   ON design_inputs (updated_at) WHERE capture_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_design_runs_session     ON design_runs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_concepts_run     ON design_concepts (run_id);
CREATE INDEX IF NOT EXISTS idx_design_concepts_session ON design_concepts (session_id);
CREATE INDEX IF NOT EXISTS idx_design_chat_session     ON design_chat_messages (session_id, created_at);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — admin tier only. Mirrors migration 048's shape, but
-- narrowed to admins.role = 'admin' (members never reach the Design Studio).
-- ------------------------------------------------------------

ALTER TABLE design_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin tier manages design_inputs" ON design_inputs;
CREATE POLICY "Admin tier manages design_inputs"
  ON design_inputs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_runs" ON design_runs;
CREATE POLICY "Admin tier manages design_runs"
  ON design_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_concepts" ON design_concepts;
CREATE POLICY "Admin tier manages design_concepts"
  ON design_concepts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_versions" ON design_versions;
CREATE POLICY "Admin tier manages design_versions"
  ON design_versions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_chat_messages" ON design_chat_messages;
CREATE POLICY "Admin tier manages design_chat_messages"
  ON design_chat_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

-- ------------------------------------------------------------
-- Verify (read-only; run after applying):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'design\_%' ORDER BY 1;          -- 5 rows
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'design\_%';      -- all true
--   SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'design\_%';     -- 5 rows
--   SELECT indexname FROM pg_indexes WHERE indexname = 'design_runs_one_active_per_session'; -- 1 row
-- ------------------------------------------------------------
```

- [ ] **Step 6: Run the parity test.**
Run: `npx vitest run lib/design/migration-078.test.ts`
Expected: PASS (7 + 1 + 1 + 5 + 5 = 19 tests).

- [ ] **Step 7: Hand-patch `types/database.ts`.** Insert the block below immediately BEFORE the line `      generated_pages: {` (inside `public.Tables`, right after the `content_jobs` table's closing `      }`). Add a one-line comment above it: `// Hand-patched for migration 078 (Design Studio) — replaced on the next \`supabase gen types\`.`

```ts
      design_chat_messages: {
        Row: {
          attachment_ids: string[]
          content: string
          created_at: string
          created_by: string | null
          id: string
          parts: Json | null
          role: string
          session_id: string
          version_id: string | null
        }
        Insert: {
          attachment_ids?: string[]
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parts?: Json | null
          role: string
          session_id: string
          version_id?: string | null
        }
        Update: {
          attachment_ids?: string[]
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parts?: Json | null
          role?: string
          session_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_chat_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_chat_messages_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "design_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      design_concepts: {
        Row: {
          bundle: Json | null
          cost_usd: number
          created_at: string
          critique: Json | null
          error: string | null
          id: string
          initial_bundle: Json | null
          iterations: number
          position: number
          run_id: string
          screenshots: Json
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          bundle?: Json | null
          cost_usd?: number
          created_at?: string
          critique?: Json | null
          error?: string | null
          id?: string
          initial_bundle?: Json | null
          iterations?: number
          position: number
          run_id: string
          screenshots?: Json
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          bundle?: Json | null
          cost_usd?: number
          created_at?: string
          critique?: Json | null
          error?: string | null
          id?: string
          initial_bundle?: Json | null
          iterations?: number
          position?: number
          run_id?: string
          screenshots?: Json
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_concepts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "design_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_concepts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      design_inputs: {
        Row: {
          archived: boolean
          capture_error: string | null
          capture_status: string
          captured_at: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          label: string | null
          notes: string | null
          session_id: string
          storage_path: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          archived?: boolean
          capture_error?: string | null
          capture_status?: string
          captured_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          label?: string | null
          notes?: string | null
          session_id: string
          storage_path?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          archived?: boolean
          capture_error?: string | null
          capture_status?: string
          captured_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label?: string | null
          notes?: string | null
          session_id?: string
          storage_path?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_inputs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_inputs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      design_runs: {
        Row: {
          admin_brief: string | null
          base_snapshot: Json | null
          capabilities: Json
          concept_count: number
          cost_cap_usd: number
          cost_usd: number
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          input_ids: string[]
          max_revisions: number
          palette_freedom: string
          session_id: string
          stage: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_brief?: string | null
          base_snapshot?: Json | null
          capabilities?: Json
          concept_count?: number
          cost_cap_usd?: number
          cost_usd?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          input_ids?: string[]
          max_revisions?: number
          palette_freedom?: string
          session_id: string
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_brief?: string | null
          base_snapshot?: Json | null
          capabilities?: Json
          concept_count?: number
          cost_cap_usd?: number
          cost_usd?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          input_ids?: string[]
          max_revisions?: number
          palette_freedom?: string
          session_id?: string
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      design_versions: {
        Row: {
          applied_blobs: Json
          applied_commit_sha: string | null
          bundle: Json
          concept_id: string | null
          created_at: string
          created_by: string | null
          id: string
          screenshots: Json
          session_id: string
          source: string
          summary: string | null
          version_no: number
        }
        Insert: {
          applied_blobs?: Json
          applied_commit_sha?: string | null
          bundle: Json
          concept_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          screenshots?: Json
          session_id: string
          source: string
          summary?: string | null
          version_no: number
        }
        Update: {
          applied_blobs?: Json
          applied_commit_sha?: string | null
          bundle?: Json
          concept_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          screenshots?: Json
          session_id?: string
          source?: string
          summary?: string | null
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "design_versions_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "design_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_versions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 8: Run the checks.**
Run: `npx tsc --noEmit && npm run lint && npx vitest run lib/design`
Expected: clean, and all `lib/design` tests PASS.

- [ ] **Step 9: Commit.**

```bash
git add supabase/078_design_studio.sql types/database.ts lib/design/studio-types.ts lib/design/migration-078.test.ts
git commit -m "feat(design-studio): migration 078 (inputs/runs/concepts/versions/chat, admin-tier RLS) + hand-patched types + shared constants"
```

- [ ] **Step 10 (CONTROLLER — STOP): ask the user to apply the migration.** Tell the user: "Please run `supabase/078_design_studio.sql` in the Supabase SQL Editor (it is idempotent), then run the four verification queries at the bottom of the file." Wait for them to confirm. Then verify read-only from the repo root:

```bash
node --env-file=.env.local -e "
const { createClient } = require('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async () => {
  for (const t of ['design_inputs', 'design_runs', 'design_concepts', 'design_versions', 'design_chat_messages']) {
    const { count, error } = await s.from(t).select('id', { count: 'exact', head: true })
    console.log(t, error ? 'MISSING: ' + error.message : 'ok (rows=' + count + ')')
  }
})()"
```

Expected: five lines, each `ok (rows=0)`. If any says `MISSING`, ask the user to re-run the file. Tasks 2–10 use mocked databases and may continue meanwhile; only the Task 11 manual check needs the live tables.

---

### Task 2: Typed store (`store.ts`) with a chainable Supabase test double

**Files:**
- Create: `lib/design/__fixtures__/fake-supabase.ts`, `lib/design/__fixtures__/rows.ts`, `lib/design/store.ts`, `lib/design/store.test.ts`
- Modify: `lib/design/storage.ts`, `lib/design/storage.test.ts`

**Interfaces:**
- Consumes: `Database`, `Tables`, `TablesInsert`, `TablesUpdate` (`types/database.ts`); `asJson`; `DesignBundle`; `ThemeBlobShas`, `CaptureStatus`, `DesignInputKind`, `VersionSource` (Task 1).
- Produces:
  - `storage.ts`: `removeDesignPaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<void>`
  - `store.ts`:
    - `type DesignInputRow = Tables<'design_inputs'>`, `type DesignVersionRow = Tables<'design_versions'>`
    - `listInputs(db, sessionId): Promise<DesignInputRow[]>` (oldest first)
    - `getInput(db, sessionId, inputId): Promise<DesignInputRow | null>`
    - `type NewDesignInput`, `createInput(db, input: NewDesignInput): Promise<DesignInputRow>`
    - `type DesignInputPatch`, `updateInput(db, sessionId, inputId, patch): Promise<DesignInputRow | null>`
    - `claimCapture(db, sessionId, inputId): Promise<DesignInputRow | null>`
    - `deleteInput(db, sessionId, inputId): Promise<boolean>`
    - `listVersions(db, sessionId): Promise<DesignVersionRow[]>` (newest first), `latestVersion(db, sessionId): Promise<DesignVersionRow | null>`
    - `type NewDesignVersion`, `insertVersion(db, v: NewDesignVersion): Promise<DesignVersionRow>`, `INSERT_VERSION_ATTEMPTS = 3`, `class VersionConflictError`
    - `type BaselineSource`, `type BaselineOutcome`, `BASELINE_SUMMARY`, `getBaselineOrCreate(db, args): Promise<BaselineOutcome>`
    - `readSessionSchema(db, sessionId): Promise<unknown>`
  - Fixtures: `fakeSupabase(results)`, `makeInputRow(overrides)`, `makeVersionRow(overrides)`, `SID`, `OTHER_SID`, `IID`.

- [ ] **Step 1: Create the test double** `lib/design/__fixtures__/fake-supabase.ts`:

```ts
// Test double for SupabaseClient<Database>: every chain method records its
// arguments; the terminal await/.single()/.maybeSingle() pops the next queued
// result for that table (FIFO). Storage .remove() pops 'storage.remove'
// (default: success). Throws loudly when a query has no queued result.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type FakeError = { code?: string; message: string }
export type FakeResult = { data?: unknown; error?: FakeError | null }
export type FakeOp = [method: string, ...args: unknown[]]
export type FakeQuery = { table: string; ops: FakeOp[] }

const CHAIN_METHODS = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'lt', 'gt', 'in', 'is', 'or', 'order', 'limit'] as const

export function fakeSupabase(results: Record<string, FakeResult[]> = {}) {
  const queries: FakeQuery[] = []
  const storageRemovals: string[][] = []

  const take = (key: string): { data: unknown; error: FakeError | null } => {
    const next = results[key]?.shift()
    if (!next) throw new Error(`fakeSupabase: no queued result for "${key}"`)
    return { data: next.data ?? null, error: next.error ?? null }
  }

  const from = (table: string) => {
    const query: FakeQuery = { table, ops: [] }
    queries.push(query)
    const builder: Record<string, unknown> = {}
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        query.ops.push([method, ...args])
        return builder
      }
    }
    builder.single = async () => {
      query.ops.push(['single'])
      return take(table)
    }
    builder.maybeSingle = async () => {
      query.ops.push(['maybeSingle'])
      return take(table)
    }
    builder.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      new Promise((resolve) => resolve(take(table))).then(onFulfilled, onRejected)
    return builder
  }

  const storage = {
    from: (_bucket: string) => ({
      remove: async (paths: string[]) => {
        storageRemovals.push(paths)
        const r = results['storage.remove']?.shift()
        return { data: r?.data ?? [], error: r?.error ?? null }
      },
    }),
  }

  const client: SupabaseClient<Database> = { from, storage } as never
  const opsFor = (table: string, index = 0): FakeOp[] => queries.filter((q) => q.table === table)[index]?.ops ?? []
  return { client, queries, storageRemovals, opsFor }
}
```

- [ ] **Step 2: Create the row fixtures** `lib/design/__fixtures__/rows.ts`:

```ts
import type { Tables } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import { VALID } from './valid-bundle'

export const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
export const OTHER_SID = '11111111-2222-4333-8444-555555555555'
export const IID = '0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e'

export function makeInputRow(overrides: Partial<Tables<'design_inputs'>> = {}): Tables<'design_inputs'> {
  return {
    id: IID,
    session_id: SID,
    kind: 'competitor_url',
    url: 'https://acme.example.com/',
    label: 'Acme CPA',
    notes: null,
    storage_path: null,
    capture_status: 'none',
    capture_error: null,
    captured_at: null,
    archived: false,
    created_by: 'admin-1',
    created_at: '2026-09-25T10:00:00.000Z',
    updated_at: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

export function makeVersionRow(overrides: Partial<Tables<'design_versions'>> = {}): Tables<'design_versions'> {
  return {
    id: 'ver-0',
    session_id: SID,
    version_no: 0,
    source: 'baseline',
    bundle: asJson({ ...VALID, name: 'Baseline', meta: { source: 'baseline' } }),
    summary: 'Baseline — imported from the current draft',
    concept_id: null,
    applied_commit_sha: null,
    applied_blobs: asJson({}),
    screenshots: asJson([]),
    created_by: 'admin-1',
    created_at: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}
```

- [ ] **Step 3: Add `removeDesignPaths` tests** to the end of `lib/design/storage.test.ts`. First add `removeDesignPaths` to the existing `import { … } from './storage'` line, then append:

```ts
describe('removeDesignPaths', () => {
  it('removes only design/ paths from the private bucket', async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }))
    const from = vi.fn(() => ({ remove }))
    const supabase = { storage: { from } } as never
    await removeDesignPaths(supabase, [`design/${SID}/inputs/a.webp`, 'sessions/x/secret.pdf', `design/${SID}/../x`])
    expect(from).toHaveBeenCalledWith('session-assets')
    expect(remove).toHaveBeenCalledWith([`design/${SID}/inputs/a.webp`])
  })

  it('is a no-op when nothing is removable', async () => {
    const from = vi.fn()
    await removeDesignPaths({ storage: { from } } as never, ['sessions/x.pdf'])
    expect(from).not.toHaveBeenCalled()
  })

  it('throws when storage reports an error', async () => {
    const supabase = { storage: { from: () => ({ remove: async () => ({ data: null, error: { message: 'boom' } }) }) } } as never
    await expect(removeDesignPaths(supabase, [`design/${SID}/inputs/a.webp`])).rejects.toThrow('removeDesignPaths failed')
  })
})
```

- [ ] **Step 4: Run them and confirm they fail.**
Run: `npx vitest run lib/design/storage.test.ts`
Expected: FAIL (`removeDesignPaths` is not exported).

- [ ] **Step 5: Add `removeDesignPaths`** to the end of `lib/design/storage.ts`:

```ts
// Delete Design Studio objects. Only design/… paths are ever removed (defence
// against a bad stored path deleting a client upload or PDF). Throws on a
// storage error; callers treat cleanup as best-effort and log.
export async function removeDesignPaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<void> {
  const safe = paths.filter((p) => p.startsWith('design/') && !p.includes('..'))
  if (safe.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(safe)
  if (error) throw new Error(`removeDesignPaths failed: ${error.message}`)
}
```

- [ ] **Step 6: Run the storage tests.**
Run: `npx vitest run lib/design/storage.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing store tests** `lib/design/store.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { IID, SID, makeInputRow, makeVersionRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import {
  BASELINE_SUMMARY,
  INSERT_VERSION_ATTEMPTS,
  VersionConflictError,
  claimCapture,
  createInput,
  deleteInput,
  getBaselineOrCreate,
  getInput,
  insertVersion,
  latestVersion,
  listInputs,
  listVersions,
  readSessionSchema,
  updateInput,
} from './store'

const BLOBS = { 'content/brand.json': 'a'.repeat(40) }

afterEach(() => vi.restoreAllMocks())

describe('inputs', () => {
  it('listInputs scopes by session, oldest first', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: [makeInputRow()] }] })
    expect(await listInputs(f.client, SID)).toHaveLength(1)
    expect(f.opsFor('design_inputs')).toEqual([
      ['select', '*'],
      ['eq', 'session_id', SID],
      ['order', 'created_at', { ascending: true }],
    ])
  })

  it('getInput is scoped by id AND session; null when absent', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: null }] })
    expect(await getInput(f.client, SID, IID)).toBeNull()
    const ops = f.opsFor('design_inputs')
    expect(ops).toContainEqual(['eq', 'id', IID])
    expect(ops).toContainEqual(['eq', 'session_id', SID])
  })

  it('createInput maps fields and defaults capture_status to none', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow() }] })
    await createInput(f.client, { sessionId: SID, kind: 'competitor_url', url: 'https://acme.example.com/', label: 'Acme CPA', createdBy: 'admin-1' })
    expect(f.opsFor('design_inputs')[0]).toEqual([
      'insert',
      {
        session_id: SID,
        kind: 'competitor_url',
        url: 'https://acme.example.com/',
        label: 'Acme CPA',
        notes: null,
        storage_path: null,
        capture_status: 'none',
        captured_at: null,
        created_by: 'admin-1',
      },
    ])
  })

  it('createInput passes a caller-chosen id through', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow() }] })
    await createInput(f.client, { id: IID, sessionId: SID, kind: 'inspiration_image', url: null, createdBy: null })
    expect(f.opsFor('design_inputs')[0][1]).toMatchObject({ id: IID, url: null })
  })

  it('createInput throws on a DB error', async () => {
    const f = fakeSupabase({ design_inputs: [{ error: { message: 'boom' } }] })
    await expect(createInput(f.client, { sessionId: SID, kind: 'current_site', url: 'https://a.com/', createdBy: null })).rejects.toThrow('createInput')
  })

  it('updateInput writes only the given fields plus updated_at, scoped', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow({ archived: true }) }] })
    const row = await updateInput(f.client, SID, IID, { archived: true, notes: null })
    expect(row?.archived).toBe(true)
    const [op, payload] = f.opsFor('design_inputs')[0] as [string, Record<string, unknown>]
    expect(op).toBe('update')
    expect(Object.keys(payload).sort()).toEqual(['archived', 'notes', 'updated_at'])
    expect(f.opsFor('design_inputs')).toContainEqual(['eq', 'session_id', SID])
  })

  it('updateInput returns null for an input in another session', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: null }] })
    expect(await updateInput(f.client, SID, IID, { label: 'x' })).toBeNull()
  })

  it('claimCapture only claims a non-pending URL input', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: makeInputRow({ capture_status: 'pending' }) }] })
    const row = await claimCapture(f.client, SID, IID)
    expect(row?.capture_status).toBe('pending')
    const ops = f.opsFor('design_inputs')
    expect(ops[0][0]).toBe('update')
    expect(ops[0][1]).toMatchObject({ capture_status: 'pending', capture_error: null })
    expect(ops).toContainEqual(['neq', 'capture_status', 'pending'])
    expect(ops).toContainEqual(['neq', 'kind', 'inspiration_image'])
    expect(ops).toContainEqual(['eq', 'session_id', SID])
  })

  it('deleteInput deletes the row then its storage object', async () => {
    const path = `design/${SID}/inputs/${IID}.webp`
    const f = fakeSupabase({ design_inputs: [{ data: { id: IID, storage_path: path } }] })
    expect(await deleteInput(f.client, SID, IID)).toBe(true)
    expect(f.opsFor('design_inputs')).toContainEqual(['eq', 'session_id', SID])
    expect(f.storageRemovals).toEqual([[path]])
  })

  it('deleteInput returns false (and touches no storage) when not found', async () => {
    const f = fakeSupabase({ design_inputs: [{ data: null }] })
    expect(await deleteInput(f.client, SID, IID)).toBe(false)
    expect(f.storageRemovals).toEqual([])
  })

  it('deleteInput survives a storage cleanup failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fakeSupabase({
      design_inputs: [{ data: { id: IID, storage_path: `design/${SID}/inputs/x.webp` } }],
      'storage.remove': [{ error: { message: 'nope' } }],
    })
    expect(await deleteInput(f.client, SID, IID)).toBe(true)
    expect(warn).toHaveBeenCalled()
  })
})

describe('versions', () => {
  it('listVersions is newest first and scoped', async () => {
    const f = fakeSupabase({ design_versions: [{ data: [makeVersionRow()] }] })
    await listVersions(f.client, SID)
    expect(f.opsFor('design_versions')).toContainEqual(['order', 'version_no', { ascending: false }])
    expect(f.opsFor('design_versions')).toContainEqual(['eq', 'session_id', SID])
  })

  it('latestVersion returns null when there are none', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }] })
    expect(await latestVersion(f.client, SID)).toBeNull()
  })

  const NEW = { sessionId: SID, source: 'chat' as const, bundle: VALID, summary: 'Calmer cards', appliedCommitSha: 'c'.repeat(40), appliedBlobs: BLOBS, createdBy: 'admin-1' }

  it('insertVersion allocates version 0 on an empty history', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }, { data: makeVersionRow({ version_no: 0, source: 'chat' }) }] })
    await insertVersion(f.client, NEW)
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({ version_no: 0, source: 'chat', session_id: SID, applied_blobs: BLOBS, concept_id: null })
  })

  it('insertVersion retries max+1 on a 23505 unique violation', async () => {
    const f = fakeSupabase({
      design_versions: [
        { data: makeVersionRow({ version_no: 2 }) },
        { error: { code: '23505', message: 'duplicate key' } },
        { data: makeVersionRow({ version_no: 3 }) },
        { data: makeVersionRow({ id: 'ver-4', version_no: 4 }) },
      ],
    })
    const row = await insertVersion(f.client, NEW)
    expect(row.version_no).toBe(4)
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({ version_no: 3 })
    expect(f.opsFor('design_versions', 3)[0][1]).toMatchObject({ version_no: 4 })
  })

  it(`insertVersion gives up after ${INSERT_VERSION_ATTEMPTS} conflicts`, async () => {
    const results = []
    for (let i = 0; i < INSERT_VERSION_ATTEMPTS; i++) {
      results.push({ data: makeVersionRow({ version_no: i }) }, { error: { code: '23505', message: 'dup' } })
    }
    const f = fakeSupabase({ design_versions: results })
    await expect(insertVersion(f.client, NEW)).rejects.toBeInstanceOf(VersionConflictError)
  })

  it('insertVersion rethrows a non-conflict error immediately', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }, { error: { code: '42501', message: 'denied' } }] })
    await expect(insertVersion(f.client, NEW)).rejects.toThrow('insertVersion')
  })
})

describe('getBaselineOrCreate', () => {
  const ok = { ok: true as const, bundle: { ...VALID, name: 'Baseline', meta: { source: 'baseline' as const } } }

  it('returns the existing latest version without inserting', async () => {
    const f = fakeSupabase({ design_versions: [{ data: makeVersionRow({ version_no: 3 }) }] })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: 'admin-1', source: ok, appliedBlobs: BLOBS })
    expect(r).toMatchObject({ status: 'existing' })
    expect(f.queries).toHaveLength(1)
  })

  it('creates v0 from the draft bundle', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }, { data: makeVersionRow() }] })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: 'admin-1', source: ok, appliedBlobs: BLOBS })
    expect(r.status).toBe('created')
    expect(f.opsFor('design_versions', 1)[0][1]).toMatchObject({
      version_no: 0,
      source: 'baseline',
      summary: BASELINE_SUMMARY,
      applied_blobs: BLOBS,
      applied_commit_sha: null,
      created_by: 'admin-1',
    })
  })

  it('reports an import error without inserting', async () => {
    const f = fakeSupabase({ design_versions: [{ data: null }] })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: null, source: { ok: false, errors: ['bad font', 'bad css'] }, appliedBlobs: {} })
    expect(r).toEqual({ status: 'error', error: 'bad font bad css' })
    expect(f.queries).toHaveLength(1)
  })

  it('treats a concurrent v0 insert (23505) as existing', async () => {
    const f = fakeSupabase({
      design_versions: [{ data: null }, { error: { code: '23505', message: 'dup' } }, { data: makeVersionRow() }],
    })
    const r = await getBaselineOrCreate(f.client, { sessionId: SID, createdBy: null, source: ok, appliedBlobs: BLOBS })
    expect(r).toMatchObject({ status: 'existing' })
  })
})

describe('readSessionSchema', () => {
  it('returns schema_data', async () => {
    const f = fakeSupabase({ sessions: [{ data: { schema_data: { websiteUrl: 'x.com' } } }] })
    expect(await readSessionSchema(f.client, SID)).toEqual({ websiteUrl: 'x.com' })
    expect(f.opsFor('sessions')).toContainEqual(['eq', 'id', SID])
  })
})
```

- [ ] **Step 8: Run them and confirm they fail.**
Run: `npx vitest run lib/design/store.test.ts`
Expected: FAIL (module `./store` not found).

- [ ] **Step 9: Implement `lib/design/store.ts`.**

```ts
// Server-only. Typed data access for the Design Studio tables (migration 078).
// Every input/version read or write is scoped by session_id as well as id, so a
// client-supplied id from another session is simply "not found". Throws on DB
// errors (routes map them to internalError); never returns raw error text to
// the client itself.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import type { DesignBundle } from './bundle'
import { removeDesignPaths } from './storage'
import type { CaptureStatus, DesignInputKind, ThemeBlobShas, VersionSource } from './studio-types'

type Db = SupabaseClient<Database>
export type DesignInputRow = Tables<'design_inputs'>
export type DesignVersionRow = Tables<'design_versions'>

const UNIQUE_VIOLATION = '23505'
export const INSERT_VERSION_ATTEMPTS = 3
export const BASELINE_SUMMARY = 'Baseline — imported from the current draft'

export class VersionConflictError extends Error {
  constructor(sessionId: string) {
    super(`Could not allocate a design version number for session ${sessionId}`)
    this.name = 'VersionConflictError'
  }
}

function storeError(context: string, error: { message: string } | null): Error {
  return new Error(`[design-store] ${context}: ${error?.message ?? 'no data returned'}`)
}

// ---------------------------------------------------------------- inputs

export async function listInputs(db: Db, sessionId: string): Promise<DesignInputRow[]> {
  const { data, error } = await db
    .from('design_inputs')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw storeError('listInputs', error)
  return data ?? []
}

export async function getInput(db: Db, sessionId: string, inputId: string): Promise<DesignInputRow | null> {
  const { data, error } = await db
    .from('design_inputs')
    .select('*')
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw storeError('getInput', error)
  return data
}

export type NewDesignInput = {
  id?: string
  sessionId: string
  kind: DesignInputKind
  url: string | null
  label?: string | null
  notes?: string | null
  storagePath?: string | null
  captureStatus?: CaptureStatus
  capturedAt?: string | null
  createdBy: string | null
}

export async function createInput(db: Db, input: NewDesignInput): Promise<DesignInputRow> {
  const row: TablesInsert<'design_inputs'> = {
    session_id: input.sessionId,
    kind: input.kind,
    url: input.url,
    label: input.label ?? null,
    notes: input.notes ?? null,
    storage_path: input.storagePath ?? null,
    capture_status: input.captureStatus ?? 'none',
    captured_at: input.capturedAt ?? null,
    created_by: input.createdBy,
  }
  if (input.id) row.id = input.id
  const { data, error } = await db.from('design_inputs').insert(row).select('*').single()
  if (error || !data) throw storeError('createInput', error)
  return data
}

export type DesignInputPatch = {
  label?: string | null
  notes?: string | null
  archived?: boolean
  captureStatus?: CaptureStatus
  captureError?: string | null
  storagePath?: string | null
  capturedAt?: string | null
}

export async function updateInput(
  db: Db,
  sessionId: string,
  inputId: string,
  patch: DesignInputPatch
): Promise<DesignInputRow | null> {
  const update: TablesUpdate<'design_inputs'> = { updated_at: new Date().toISOString() }
  if (patch.label !== undefined) update.label = patch.label
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.archived !== undefined) update.archived = patch.archived
  if (patch.captureStatus !== undefined) update.capture_status = patch.captureStatus
  if (patch.captureError !== undefined) update.capture_error = patch.captureError
  if (patch.storagePath !== undefined) update.storage_path = patch.storagePath
  if (patch.capturedAt !== undefined) update.captured_at = patch.capturedAt
  const { data, error } = await db
    .from('design_inputs')
    .update(update)
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .select('*')
    .maybeSingle()
  if (error) throw storeError('updateInput', error)
  return data
}

// Atomic claim (mirrors generateSinglePage's .neq guard): flips a URL input to
// 'pending' only if it is not already pending. null = not found in this
// session, an uploaded image, or a capture already in flight.
export async function claimCapture(db: Db, sessionId: string, inputId: string): Promise<DesignInputRow | null> {
  const { data, error } = await db
    .from('design_inputs')
    .update({ capture_status: 'pending', capture_error: null, updated_at: new Date().toISOString() })
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .neq('capture_status', 'pending')
    .neq('kind', 'inspiration_image')
    .select('*')
    .maybeSingle()
  if (error) throw storeError('claimCapture', error)
  return data
}

// Row first, then the object (best-effort): an orphaned private object is
// harmless; a row pointing at a deleted object would show a broken thumbnail.
export async function deleteInput(db: Db, sessionId: string, inputId: string): Promise<boolean> {
  const { data, error } = await db
    .from('design_inputs')
    .delete()
    .eq('id', inputId)
    .eq('session_id', sessionId)
    .select('id, storage_path')
    .maybeSingle()
  if (error) throw storeError('deleteInput', error)
  if (!data) return false
  if (data.storage_path) {
    try {
      await removeDesignPaths(db, [data.storage_path])
    } catch (err) {
      console.warn('[design-store] input image cleanup failed (row deleted):', err)
    }
  }
  return true
}

// ---------------------------------------------------------------- versions

export async function listVersions(db: Db, sessionId: string): Promise<DesignVersionRow[]> {
  const { data, error } = await db
    .from('design_versions')
    .select('*')
    .eq('session_id', sessionId)
    .order('version_no', { ascending: false })
    .limit(200)
  if (error) throw storeError('listVersions', error)
  return data ?? []
}

export async function latestVersion(db: Db, sessionId: string): Promise<DesignVersionRow | null> {
  const { data, error } = await db
    .from('design_versions')
    .select('*')
    .eq('session_id', sessionId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw storeError('latestVersion', error)
  return data
}

export type NewDesignVersion = {
  sessionId: string
  source: VersionSource
  bundle: DesignBundle
  summary: string | null
  appliedCommitSha: string | null
  // The FULL post-apply blob shas of all four theme files (drift compares
  // against this) — not just the paths the commit changed.
  appliedBlobs: ThemeBlobShas
  conceptId?: string | null
  createdBy: string | null
}

function versionInsert(v: NewDesignVersion, versionNo: number): TablesInsert<'design_versions'> {
  return {
    session_id: v.sessionId,
    version_no: versionNo,
    source: v.source,
    bundle: asJson(v.bundle),
    summary: v.summary,
    applied_commit_sha: v.appliedCommitSha,
    applied_blobs: asJson(v.appliedBlobs),
    concept_id: v.conceptId ?? null,
    created_by: v.createdBy,
  }
}

// version_no = max + 1, retried on a unique violation (a concurrent insert
// took the number) up to INSERT_VERSION_ATTEMPTS times.
export async function insertVersion(db: Db, v: NewDesignVersion): Promise<DesignVersionRow> {
  for (let attempt = 1; attempt <= INSERT_VERSION_ATTEMPTS; attempt++) {
    const latest = await latestVersion(db, v.sessionId)
    const versionNo = latest ? latest.version_no + 1 : 0
    const { data, error } = await db.from('design_versions').insert(versionInsert(v, versionNo)).select('*').single()
    if (!error && data) return data
    if (error?.code !== UNIQUE_VIOLATION) throw storeError('insertVersion', error)
  }
  throw new VersionConflictError(v.sessionId)
}

export type BaselineSource = { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] }
export type BaselineOutcome =
  | { status: 'existing'; latest: DesignVersionRow }
  | { status: 'created'; latest: DesignVersionRow }
  | { status: 'error'; error: string }

// v0 = the current draft imported as a bundle, created lazily on the first
// Studio load. Inserted with an EXPLICIT version_no 0 (not max+1) so two
// concurrent first loads can't create two baselines: the loser's 23505 just
// re-reads the winner.
export async function getBaselineOrCreate(
  db: Db,
  args: { sessionId: string; createdBy: string | null; source: BaselineSource; appliedBlobs: ThemeBlobShas }
): Promise<BaselineOutcome> {
  const latest = await latestVersion(db, args.sessionId)
  if (latest) return { status: 'existing', latest }
  if (!args.source.ok) return { status: 'error', error: args.source.errors.join(' ') }

  const { data, error } = await db
    .from('design_versions')
    .insert(
      versionInsert(
        {
          sessionId: args.sessionId,
          source: 'baseline',
          bundle: args.source.bundle,
          summary: BASELINE_SUMMARY,
          appliedCommitSha: null,
          appliedBlobs: args.appliedBlobs,
          createdBy: args.createdBy,
        },
        0
      )
    )
    .select('*')
    .single()
  if (!error && data) return { status: 'created', latest: data }
  if (error?.code === UNIQUE_VIOLATION) {
    const winner = await latestVersion(db, args.sessionId)
    if (winner) return { status: 'existing', latest: winner }
  }
  throw storeError('getBaselineOrCreate', error)
}

// ---------------------------------------------------------------- session

export async function readSessionSchema(db: Db, sessionId: string): Promise<unknown> {
  const { data, error } = await db.from('sessions').select('schema_data').eq('id', sessionId).maybeSingle()
  if (error) throw storeError('readSessionSchema', error)
  return data?.schema_data ?? null
}
```

- [ ] **Step 10: Run the tests.**
Run: `npx vitest run lib/design/store.test.ts lib/design/storage.test.ts`
Expected: PASS.

- [ ] **Step 11: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add lib/design/__fixtures__/fake-supabase.ts lib/design/__fixtures__/rows.ts lib/design/storage.ts lib/design/storage.test.ts lib/design/store.ts lib/design/store.test.ts
git commit -m "feat(design-studio): typed store for inputs/versions (session-scoped, 23505 version retry, lazy baseline v0)"
```

---

### Task 3: Drift detection (pure) and the draft theme snapshot

**Files:**
- Create: `lib/design/drift.ts`, `lib/design/drift.test.ts`, `lib/design/theme-snapshot.ts`, `lib/design/theme-snapshot.test.ts`

**Interfaces:**
- Consumes: `BRAND_PATH`, `DESIGN_PATH`, `OVERRIDES_PATH`, `THEME_CSS_PATH` (`app/api/edit/[id]/theme/_theme.ts`); `generateThemeCss`; `DRAFT_BRANCH`, `ensureDraftBranch`, `listTree`, `readTextBlobs` (`lib/github/repo-files.ts`); `DriftResult`, `ThemeBlobShas`.
- Produces:
  - `THEME_FILE_PATHS` (brand, design, theme.css, overrides), `type ThemeFilePath`
  - `computeDrift(current: ThemeBlobShas, latest: { versionNo: number; appliedBlobs: ThemeBlobShas } | null): DriftResult`
  - `toBlobMap(value: unknown): ThemeBlobShas`
  - `isThemeCssStale(texts: Partial<Record<ThemeFilePath, string>>): boolean | null`
  - `type DraftThemeSnapshot = { shas: ThemeBlobShas; texts: Partial<Record<ThemeFilePath, string>> }`
  - `readDraftThemeSnapshot(githubRepo: string): Promise<DraftThemeSnapshot>`, `__resetThemeBlobCacheForTests(): void`

**Ruling — how draft shas are read:** one `listTree(repo, DRAFT_BRANCH)`. It is the cheapest existing helper: a conditional `getRef` (a 304 is free against the rate limit) plus an in-process tree cache keyed by the branch tip. Four `readFile` calls would cost four uncached `getContent` calls on every Studio load. Texts are then read by blob sha (`readTextBlobs`) through a small sha-keyed in-process cache, since blobs are immutable.

- [ ] **Step 1: Write the failing tests** `lib/design/drift.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { THEME_FILE_PATHS, computeDrift, isThemeCssStale, toBlobMap } from './drift'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const SNAP = { 'content/brand.json': A, 'content/design.json': B, 'src/styles/theme.css': C }

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
const brand = readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')
const design = readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')
const themeCss = readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8')

describe('THEME_FILE_PATHS', () => {
  it('lists the four theme files in a stable order', () => {
    expect(THEME_FILE_PATHS).toEqual(['content/brand.json', 'content/design.json', 'src/styles/theme.css', 'content/design-overrides.css'])
  })
})

describe('computeDrift', () => {
  it('is no-baseline without a version', () => {
    expect(computeDrift(SNAP, null)).toEqual({ status: 'no-baseline', changedPaths: [], sinceVersion: null })
  })

  it('is in-sync when every theme blob matches', () => {
    expect(computeDrift(SNAP, { versionNo: 2, appliedBlobs: { ...SNAP } })).toEqual({ status: 'in-sync', changedPaths: [], sinceVersion: 2 })
  })

  it('reports changed paths in THEME_FILE_PATHS order', () => {
    const r = computeDrift({ ...SNAP, 'src/styles/theme.css': D, 'content/brand.json': D }, { versionNo: 1, appliedBlobs: SNAP })
    expect(r).toEqual({ status: 'drifted', changedPaths: ['content/brand.json', 'src/styles/theme.css'], sinceVersion: 1 })
  })

  it('counts a file added or removed on draft as drift', () => {
    expect(computeDrift({ ...SNAP, 'content/design-overrides.css': D }, { versionNo: 0, appliedBlobs: SNAP }).changedPaths).toEqual([
      'content/design-overrides.css',
    ])
    const { 'content/brand.json': _gone, ...rest } = SNAP
    expect(computeDrift(rest, { versionNo: 0, appliedBlobs: SNAP }).changedPaths).toEqual(['content/brand.json'])
  })

  it('ignores non-theme paths', () => {
    expect(computeDrift(SNAP, { versionNo: 0, appliedBlobs: { ...SNAP, 'content/pages/home.md': D } }).status).toBe('in-sync')
  })
})

describe('toBlobMap', () => {
  it('keeps only string sha values', () => {
    expect(toBlobMap({ a: A, b: 12, c: 'not-a-sha', d: null })).toEqual({ a: A })
  })
  it.each([[null], [[A]], ['x'], [undefined]])('returns {} for %j', (v) => {
    expect(toBlobMap(v)).toEqual({})
  })
})

describe('isThemeCssStale', () => {
  const base = { 'content/brand.json': brand, 'content/design.json': design }
  it('is false when theme.css matches the generator', () => {
    expect(isThemeCssStale({ ...base, 'src/styles/theme.css': themeCss })).toBe(false)
  })
  it('is true when theme.css differs or is missing', () => {
    expect(isThemeCssStale({ ...base, 'src/styles/theme.css': ':root{}' })).toBe(true)
    expect(isThemeCssStale(base)).toBe(true)
  })
  it('is null when it cannot tell', () => {
    expect(isThemeCssStale({ 'content/design.json': design })).toBeNull()
    expect(isThemeCssStale({ 'content/brand.json': '{nope', 'content/design.json': design })).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/drift.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/design/drift.ts`.**

```ts
// Pure + client-safe. Has the draft's theme drifted from the latest Design
// Studio version? Compares git blob shas of the four theme files (content-
// addressed: equal bytes ⇔ equal sha) with the version's applied_blobs. Also
// flags a committed theme.css that no longer matches brand.json + design.json.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '@/app/api/edit/[id]/theme/_theme'
import type { DriftResult, ThemeBlobShas } from './studio-types'

export const THEME_FILE_PATHS = [BRAND_PATH, DESIGN_PATH, THEME_CSS_PATH, OVERRIDES_PATH] as const
export type ThemeFilePath = (typeof THEME_FILE_PATHS)[number]

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i

export function toBlobMap(value: unknown): ThemeBlobShas {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ThemeBlobShas = {}
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string' && SHA_RE.test(v)) out[k] = v
  return out
}

export function computeDrift(
  current: ThemeBlobShas,
  latest: { versionNo: number; appliedBlobs: ThemeBlobShas } | null
): DriftResult {
  if (!latest) return { status: 'no-baseline', changedPaths: [], sinceVersion: null }
  const changedPaths = THEME_FILE_PATHS.filter((p) => (current[p] ?? null) !== (latest.appliedBlobs[p] ?? null))
  return { status: changedPaths.length ? 'drifted' : 'in-sync', changedPaths, sinceVersion: latest.versionNo }
}

// true = theme.css is missing or differs from what brand.json + design.json
// generate (e.g. a platform-seeded site that never had theme.css written);
// null = brand/design missing or unparseable, so we can't tell.
export function isThemeCssStale(texts: Partial<Record<ThemeFilePath, string>>): boolean | null {
  const brandText = texts[BRAND_PATH]
  const designText = texts[DESIGN_PATH]
  if (!brandText || !designText) return null
  try {
    const brand = JSON.parse(brandText) as BrandJson
    const design = JSON.parse(designText) as DesignJson
    return generateThemeCss(brand, design) !== (texts[THEME_CSS_PATH] ?? '')
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the drift tests.**
Run: `npx vitest run lib/design/drift.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing snapshot tests** `lib/design/theme-snapshot.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ ensure: vi.fn(), listTree: vi.fn(), readTextBlobs: vi.fn() }))

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  ensureDraftBranch: (slug: string) => m.ensure(slug),
  listTree: (...a: unknown[]) => m.listTree(...a),
  readTextBlobs: (...a: unknown[]) => m.readTextBlobs(...a),
}))

import { readDraftThemeSnapshot, __resetThemeBlobCacheForTests } from './theme-snapshot'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const TREE = [
  { path: 'content/brand.json', sha: A, type: 'blob' },
  { path: 'content/design.json', sha: B, type: 'blob' },
  { path: 'src/styles/theme.css', sha: C, type: 'blob' },
  { path: 'content/pages/home.md', sha: 'd'.repeat(40), type: 'blob' },
  { path: 'content', sha: 'e'.repeat(40), type: 'tree' },
]

beforeEach(() => {
  __resetThemeBlobCacheForTests()
  m.ensure.mockReset().mockResolvedValue(undefined)
  m.listTree.mockReset().mockResolvedValue(TREE)
  m.readTextBlobs.mockReset().mockImplementation(async (_repo: string, entries: { path: string }[]) =>
    entries.map((e) => ({ path: e.path, content: `text:${e.path}` }))
  )
})

describe('readDraftThemeSnapshot', () => {
  it('returns blob shas + texts for the theme files only', async () => {
    const snap = await readDraftThemeSnapshot('o/r')
    expect(m.ensure).toHaveBeenCalledWith('o/r')
    expect(m.listTree).toHaveBeenCalledWith('o/r', 'draft')
    expect(snap.shas).toEqual({ 'content/brand.json': A, 'content/design.json': B, 'src/styles/theme.css': C })
    expect(snap.texts).toEqual({
      'content/brand.json': 'text:content/brand.json',
      'content/design.json': 'text:content/design.json',
      'src/styles/theme.css': 'text:src/styles/theme.css',
    })
  })

  it('serves unchanged blobs from the sha cache', async () => {
    await readDraftThemeSnapshot('o/r')
    await readDraftThemeSnapshot('o/r')
    expect(m.readTextBlobs).toHaveBeenCalledTimes(1)
  })

  it('re-reads only the blob whose sha changed', async () => {
    await readDraftThemeSnapshot('o/r')
    const D = 'f'.repeat(40)
    m.listTree.mockResolvedValue(TREE.map((e) => (e.path === 'src/styles/theme.css' ? { ...e, sha: D } : e)))
    await readDraftThemeSnapshot('o/r')
    expect(m.readTextBlobs).toHaveBeenLastCalledWith('o/r', [{ path: 'src/styles/theme.css', sha: D, type: 'blob' }])
  })
})
```

- [ ] **Step 6: Run them and confirm they fail.**
Run: `npx vitest run lib/design/theme-snapshot.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `lib/design/theme-snapshot.ts`.**

```ts
// Server-only. The draft branch's four theme files as { path → blob sha } plus
// their texts, for drift detection, the v0 baseline import and the stale
// theme.css check. One listTree (conditional getRef + cached tree — cheap and
// rate-limit friendly) gives the shas; texts are read by sha and cached in
// process, since blobs are immutable.
import { DRAFT_BRANCH, ensureDraftBranch, listTree, readTextBlobs } from '@/lib/github/repo-files'
import { THEME_FILE_PATHS, type ThemeFilePath } from './drift'
import type { ThemeBlobShas } from './studio-types'

export type DraftThemeSnapshot = { shas: ThemeBlobShas; texts: Partial<Record<ThemeFilePath, string>> }

const CACHE_MAX = 64
const blobTextCache = new Map<string, string>()

export function __resetThemeBlobCacheForTests(): void {
  blobTextCache.clear()
}

function remember(sha: string, text: string): void {
  if (blobTextCache.size >= CACHE_MAX) {
    const oldest = blobTextCache.keys().next().value
    if (oldest !== undefined) blobTextCache.delete(oldest)
  }
  blobTextCache.set(sha, text)
}

export async function readDraftThemeSnapshot(githubRepo: string): Promise<DraftThemeSnapshot> {
  await ensureDraftBranch(githubRepo)
  const wanted = new Set<string>(THEME_FILE_PATHS)
  const entries = (await listTree(githubRepo, DRAFT_BRANCH)).filter((e) => e.type === 'blob' && wanted.has(e.path))

  const shas: ThemeBlobShas = {}
  for (const e of entries) shas[e.path] = e.sha

  const missing = entries.filter((e) => !blobTextCache.has(e.sha))
  if (missing.length > 0) {
    for (const r of await readTextBlobs(githubRepo, missing)) {
      const sha = shas[r.path]
      if (sha) remember(sha, r.content)
    }
  }

  const texts: Partial<Record<ThemeFilePath, string>> = {}
  for (const p of THEME_FILE_PATHS) {
    const sha = shas[p]
    const text = sha ? blobTextCache.get(sha) : undefined
    if (text !== undefined) texts[p] = text
  }
  return { shas, texts }
}
```

- [ ] **Step 8: Run the tests.**
Run: `npx vitest run lib/design/drift.test.ts lib/design/theme-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add lib/design/drift.ts lib/design/drift.test.ts lib/design/theme-snapshot.ts lib/design/theme-snapshot.test.ts
git commit -m "feat(design-studio): theme drift detection + stale theme.css check + cached draft theme snapshot"
```

---

### Task 4: Input validation and DTO helpers (pure)

**Files:**
- Create: `lib/design/input-validation.ts`, `lib/design/input-validation.test.ts`, `lib/design/studio-dto.ts`, `lib/design/studio-dto.test.ts`

**Interfaces:**
- Consumes: Task 1 constants/types; `Tables` type; `SessionSchema` type.
- Produces:
  - `isUuid(v: string): boolean`, `isPlainObject(v: unknown): v is Record<string, unknown>`
  - `parseUrlInputKind(v: unknown): UrlInputKind | null`
  - `normalizeInputUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: string }`
  - `parseOptionalText(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; reason: string }`
  - `displayHost(url: string | null): string | null`
  - `toInputDto(row: Tables<'design_inputs'>, signed: Record<string, string>): DesignInputDto`
  - `versionScreenshotPaths(row: Tables<'design_versions'>): string[]`
  - `toVersionDto(row: Tables<'design_versions'>, signed: Record<string, string>): DesignVersionDto`
  - `buildInputSuggestions(schema: unknown): InputSuggestions`

- [ ] **Step 1: Write the failing tests** `lib/design/input-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { displayHost, isPlainObject, isUuid, normalizeInputUrl, parseOptionalText, parseUrlInputKind } from './input-validation'

describe('normalizeInputUrl', () => {
  it.each([
    ['acme.com', 'https://acme.com/'],
    ['  https://acme.com/about  ', 'https://acme.com/about'],
    ['http://acme.com/a?b=1', 'http://acme.com/a?b=1'],
    ['acme.com:8080/x', 'https://acme.com:8080/x'],
  ])('accepts %s', (raw, url) => {
    expect(normalizeInputUrl(raw)).toEqual({ ok: true, url })
  })

  it.each([
    ['non-string', 42],
    ['empty', '   '],
    ['ftp', 'ftp://acme.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['mailto', 'mailto:a@acme.com'],
    ['credentials', 'https://user:pw@acme.com/'],
    ['no dot in host', 'https://localhost/'],
    ['spaces', 'https://not a url'],
    ['too long', 'https://acme.com/' + 'a'.repeat(300)],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeInputUrl(raw).ok).toBe(false)
  })
})

describe('parseOptionalText', () => {
  it('trims, and maps empty/absent to null', () => {
    expect(parseOptionalText('  hi ', 10, 'Label')).toEqual({ ok: true, value: 'hi' })
    expect(parseOptionalText('   ', 10, 'Label')).toEqual({ ok: true, value: null })
    expect(parseOptionalText(undefined, 10, 'Label')).toEqual({ ok: true, value: null })
    expect(parseOptionalText(null, 10, 'Label')).toEqual({ ok: true, value: null })
  })
  it('rejects too long and non-text', () => {
    expect(parseOptionalText('x'.repeat(11), 10, 'Label')).toEqual({ ok: false, reason: 'Label must be 10 characters or fewer.' })
    expect(parseOptionalText(5, 10, 'Notes')).toEqual({ ok: false, reason: 'Notes must be text.' })
  })
})

describe('small guards', () => {
  it('isUuid', () => {
    expect(isUuid('0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e')).toBe(true)
    expect(isUuid('upload')).toBe(false)
  })
  it('isPlainObject', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
  })
  it('parseUrlInputKind', () => {
    expect(parseUrlInputKind('competitor_url')).toBe('competitor_url')
    expect(parseUrlInputKind('inspiration_image')).toBeNull()
    expect(parseUrlInputKind(3)).toBeNull()
  })
  it('displayHost', () => {
    expect(displayHost('https://www.acme.com/x')).toBe('acme.com')
    expect(displayHost(null)).toBeNull()
    expect(displayHost('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing tests** `lib/design/studio-dto.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeInputRow, makeVersionRow } from './__fixtures__/rows'
import { buildInputSuggestions, toInputDto, toVersionDto, versionScreenshotPaths } from './studio-dto'

describe('toInputDto', () => {
  it('maps fields and signs the thumbnail', () => {
    const path = `design/${SID}/inputs/a.webp`
    const dto = toInputDto(makeInputRow({ storage_path: path, capture_status: 'ok' }), { [path]: 'https://signed/a' })
    expect(dto).toMatchObject({ kind: 'competitor_url', captureStatus: 'ok', thumbnailUrl: 'https://signed/a', label: 'Acme CPA', archived: false })
  })
  it('has a null thumbnail without a stored or signed path', () => {
    expect(toInputDto(makeInputRow(), {}).thumbnailUrl).toBeNull()
    expect(toInputDto(makeInputRow({ storage_path: `design/${SID}/x.webp` }), {}).thumbnailUrl).toBeNull()
  })
})

describe('versions', () => {
  it('takes the name from the bundle and signs screenshots', () => {
    const p = `design/${SID}/versions/v1.webp`
    const row = makeVersionRow({ version_no: 1, source: 'concept', screenshots: asJson([{ path: p }, { path: 'sessions/x.png' }, 'junk']) })
    expect(versionScreenshotPaths(row)).toEqual([p])
    expect(toVersionDto(row, { [p]: 'https://signed/v1' })).toMatchObject({
      versionNo: 1,
      source: 'concept',
      name: 'Baseline',
      screenshotUrls: ['https://signed/v1'],
    })
  })
  it('falls back for a nameless bundle and an unknown source', () => {
    const dto = toVersionDto(makeVersionRow({ bundle: asJson({}), source: 'weird' }), {})
    expect(dto.name).toBe('Untitled design')
    expect(dto.source).toBe('import')
  })
})

describe('buildInputSuggestions', () => {
  it('normalizes the site URL and dedupes competitor names', () => {
    const s = buildInputSuggestions({
      websiteUrl: 'bblcpa.com',
      business: { competitors: [{ name: ' Acme CPA ' }, { name: 'acme cpa' }, { name: '' }, 'Beta LLP', null, { name: 5 }] },
    })
    expect(s).toEqual({ currentSite: 'https://bblcpa.com/', competitors: [{ name: 'Acme CPA' }, { name: 'Beta LLP' }] })
  })
  it('is empty for missing or malformed data', () => {
    expect(buildInputSuggestions(null)).toEqual({ currentSite: null, competitors: [] })
    expect(buildInputSuggestions({ websiteUrl: 'not a url', business: { competitors: 'Acme' } })).toEqual({ currentSite: null, competitors: [] })
  })
  it('caps the competitor list at 12', () => {
    const competitors = Array.from({ length: 20 }, (_, i) => ({ name: `Firm ${i}` }))
    expect(buildInputSuggestions({ business: { competitors } }).competitors).toHaveLength(12)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail.**
Run: `npx vitest run lib/design/input-validation.test.ts lib/design/studio-dto.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `lib/design/input-validation.ts`.**

```ts
// Pure + client-safe validation for Design Studio inputs. URLs are only
// VALIDATED here — nothing fetches them until the capture route, which runs
// isUrlPubliclyFetchable (SSRF) first.
import { MAX_INPUT_URL_LENGTH, URL_INPUT_KINDS, type UrlInputKind } from './studio-types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A scheme followed by something other than a port digit ("acme.com:8080" has
// no scheme; "javascript:alert" does).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:(?!\d)/i

export function isUuid(v: string): boolean {
  return UUID_RE.test(v)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseUrlInputKind(v: unknown): UrlInputKind | null {
  return typeof v === 'string' && (URL_INPUT_KINDS as readonly string[]).includes(v) ? (v as UrlInputKind) : null
}

export function normalizeInputUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'A URL is required.' }
  const trimmed = raw.trim()
  if (trimmed.length > MAX_INPUT_URL_LENGTH) return { ok: false, reason: 'That URL is too long.' }
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http(s) URLs are allowed.' }
  if (u.username || u.password) return { ok: false, reason: 'URLs with credentials are not allowed.' }
  if (!u.hostname.includes('.')) return { ok: false, reason: 'Enter a full site address, like https://example.com.' }
  const url = u.toString()
  if (url.length > MAX_INPUT_URL_LENGTH) return { ok: false, reason: 'That URL is too long.' }
  return { ok: true, url }
}

export function parseOptionalText(
  value: unknown,
  max: number,
  field: string
): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, reason: `${field} must be text.` }
  const trimmed = value.trim()
  if (trimmed.length > max) return { ok: false, reason: `${field} must be ${max} characters or fewer.` }
  return { ok: true, value: trimmed || null }
}

export function displayHost(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Implement `lib/design/studio-dto.ts`.**

```ts
// Pure + client-safe: DB rows → the DTOs the Design Studio UI renders, and the
// MBP-derived input suggestions (names only — the MBP is never written).
import type { Tables } from '@/types/database'
import { normalizeInputUrl } from './input-validation'
import {
  CAPTURE_STATUSES,
  DESIGN_INPUT_KINDS,
  VERSION_SOURCES,
  type CaptureStatus,
  type DesignInputDto,
  type DesignInputKind,
  type DesignVersionDto,
  type InputSuggestions,
  type VersionSource,
} from './studio-types'

const MAX_COMPETITOR_SUGGESTIONS = 12
const MAX_NAME_LENGTH = 120

function oneOf<T extends string>(list: readonly T[], value: string, fallback: T): T {
  return (list as readonly string[]).includes(value) ? (value as T) : fallback
}

export function toInputDto(row: Tables<'design_inputs'>, signed: Record<string, string>): DesignInputDto {
  return {
    id: row.id,
    kind: oneOf<DesignInputKind>(DESIGN_INPUT_KINDS, row.kind, 'inspiration_url'),
    url: row.url,
    label: row.label,
    notes: row.notes,
    captureStatus: oneOf<CaptureStatus>(CAPTURE_STATUSES, row.capture_status, 'none'),
    captureError: row.capture_error,
    capturedAt: row.captured_at,
    archived: row.archived,
    thumbnailUrl: row.storage_path ? (signed[row.storage_path] ?? null) : null,
    createdAt: row.created_at,
  }
}

export function versionScreenshotPaths(row: Tables<'design_versions'>): string[] {
  const shots = row.screenshots
  if (!Array.isArray(shots)) return []
  const out: string[] = []
  for (const s of shots) {
    if (s && typeof s === 'object' && !Array.isArray(s) && typeof s.path === 'string' && s.path.startsWith('design/')) out.push(s.path)
  }
  return out
}

function bundleName(bundle: Tables<'design_versions'>['bundle']): string {
  if (bundle && typeof bundle === 'object' && !Array.isArray(bundle) && typeof bundle.name === 'string' && bundle.name.trim()) {
    return bundle.name
  }
  return 'Untitled design'
}

export function toVersionDto(row: Tables<'design_versions'>, signed: Record<string, string>): DesignVersionDto {
  return {
    id: row.id,
    versionNo: row.version_no,
    source: oneOf<VersionSource>(VERSION_SOURCES, row.source, 'import'),
    name: bundleName(row.bundle),
    summary: row.summary,
    appliedCommitSha: row.applied_commit_sha,
    createdAt: row.created_at,
    screenshotUrls: versionScreenshotPaths(row).flatMap((p) => (signed[p] ? [signed[p]] : [])),
  }
}

// schema_data is loosely shaped in practice (fields stored as strings, arrays
// as strings, etc.), so every read is defensive.
export function buildInputSuggestions(schema: unknown): InputSuggestions {
  const s = schema && typeof schema === 'object' && !Array.isArray(schema) ? (schema as Record<string, unknown>) : {}
  const site = normalizeInputUrl(s.websiteUrl)
  const business = s.business && typeof s.business === 'object' ? (s.business as Record<string, unknown>) : {}
  const raw = Array.isArray(business.competitors) ? business.competitors : []

  const seen = new Set<string>()
  const competitors: { name: string }[] = []
  for (const c of raw) {
    const name =
      typeof c === 'string' ? c : c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' ? (c as { name: string }).name : ''
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    competitors.push({ name: trimmed })
    if (competitors.length >= MAX_COMPETITOR_SUGGESTIONS) break
  }
  return { currentSite: site.ok ? site.url : null, competitors }
}
```

- [ ] **Step 6: Run the tests.**
Run: `npx vitest run lib/design/input-validation.test.ts lib/design/studio-dto.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add lib/design/input-validation.ts lib/design/input-validation.test.ts lib/design/studio-dto.ts lib/design/studio-dto.test.ts
git commit -m "feat(design-studio): input URL/text validation + studio DTO mappers + MBP competitor suggestions"
```

---

### Task 5: `GET /api/edit/[id]/design` — studio state with lazy baseline v0

**Files:**
- Create: `app/api/edit/[id]/design/route.ts`, `app/api/edit/[id]/design/route.test.ts`

**Interfaces:**
- Consumes: `requireDesignAdmin`; `readDraftThemeSnapshot` (Task 3); `bundleFromRepoFiles`, `MALFORMED_REGION_ERROR` (`lib/design/bundle-files.ts`); `computeDrift`, `isThemeCssStale`, `toBlobMap` (Task 3); `getBaselineOrCreate`, `listInputs`, `listVersions`, `readSessionSchema`, `BaselineSource` (Task 2); `signDesignPaths`; DTO helpers (Task 4).
- Produces: `GET` → `200 DesignStudioState`. On baseline import failure the route still returns 200 with `baseline: { status: 'error', error }` (never fails the whole load). `500 { error: 'Failed to load the Design Studio' }` on unexpected errors.

- [ ] **Step 1: Write the failing tests** `app/api/edit/[id]/design/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { SID, makeInputRow, makeVersionRow } from '@/lib/design/__fixtures__/rows'
import { MALFORMED_REGION_ERROR } from '@/lib/design/bundle-files'
import { asJson } from '@/lib/supabase/json-typed'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  snapshot: vi.fn(),
  readSessionSchema: vi.fn(),
  listInputs: vi.fn(),
  listVersions: vi.fn(),
  getBaselineOrCreate: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('./_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/theme-snapshot', () => ({ readDraftThemeSnapshot: (repo: string) => m.snapshot(repo) }))
vi.mock('@/lib/design/store', () => ({
  readSessionSchema: (...a: unknown[]) => m.readSessionSchema(...a),
  listInputs: (...a: unknown[]) => m.listInputs(...a),
  listVersions: (...a: unknown[]) => m.listVersions(...a),
  getBaselineOrCreate: (...a: unknown[]) => m.getBaselineOrCreate(...a),
}))
vi.mock('@/lib/design/storage', () => ({ signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p) }))

import { GET } from './route'

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
const TEXTS = {
  'content/brand.json': readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8'),
  'content/design.json': readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8'),
  'src/styles/theme.css': readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8'),
}
const SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40), 'src/styles/theme.css': 'c'.repeat(40) }
const THUMB = `design/${SID}/inputs/a.webp`

const call = () => GET(new Request('http://x/api'), { params: Promise.resolve({ id: SID }) })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.snapshot.mockReset().mockResolvedValue({ shas: SHAS, texts: TEXTS })
  m.readSessionSchema.mockReset().mockResolvedValue({ websiteUrl: 'bblcpa.com', business: { competitors: [{ name: 'Acme CPA' }] } })
  m.listInputs.mockReset().mockResolvedValue([makeInputRow({ storage_path: THUMB, capture_status: 'ok' })])
  m.listVersions.mockReset().mockResolvedValue([makeVersionRow({ applied_blobs: asJson(SHAS) })])
  m.getBaselineOrCreate.mockReset().mockResolvedValue({ status: 'created', latest: makeVersionRow({ applied_blobs: asJson(SHAS) }) })
})

describe('GET /design', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.snapshot).not.toHaveBeenCalled()
  })

  it('imports the draft as baseline v0 and returns the full state', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    const args = m.getBaselineOrCreate.mock.calls[0][1] as { sessionId: string; createdBy: string; appliedBlobs: unknown; source: { ok: boolean; bundle?: { meta: { source: string } } } }
    expect(args.sessionId).toBe(SID)
    expect(args.createdBy).toBe('admin-1')
    expect(args.appliedBlobs).toEqual(SHAS)
    expect(args.source.ok).toBe(true)
    expect(args.source.bundle?.meta.source).toBe('baseline')
    expect(body.baseline).toEqual({ status: 'ok', created: true })
    expect(body.drift).toEqual({ status: 'in-sync', changedPaths: [], sinceVersion: 0 })
    expect(body.themeCssStale).toBe(false)
    expect(body.versions).toHaveLength(1)
    expect(body.latest.versionNo).toBe(0)
    expect(body.inputs[0].thumbnailUrl).toBe(`https://signed/${THUMB}`)
    expect(body.suggestions).toEqual({ currentSite: 'https://bblcpa.com/', competitors: [{ name: 'Acme CPA' }] })
  })

  it('reports a baseline import failure without failing the load', async () => {
    m.snapshot.mockResolvedValue({ shas: SHAS, texts: { ...TEXTS, 'content/design-overrides.css': '/* design-studio:begin */\n' } })
    m.getBaselineOrCreate.mockResolvedValue({ status: 'error', error: MALFORMED_REGION_ERROR })
    m.listVersions.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(m.getBaselineOrCreate.mock.calls[0][1].source).toEqual({ ok: false, errors: [MALFORMED_REGION_ERROR] })
    expect(body.baseline).toEqual({ status: 'error', error: MALFORMED_REGION_ERROR })
    expect(body.drift.status).toBe('no-baseline')
    expect(body.latest).toBeNull()
  })

  it('reports missing brand/design files as a baseline error source', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: {} })
    m.getBaselineOrCreate.mockResolvedValue({ status: 'error', error: 'x' })
    m.listVersions.mockResolvedValue([])
    await call()
    const source = m.getBaselineOrCreate.mock.calls[0][1].source as { ok: false; errors: string[] }
    expect(source.ok).toBe(false)
    expect(source.errors[0]).toContain('no brand.json')
  })

  it('flags drift since the latest version', async () => {
    m.getBaselineOrCreate.mockResolvedValue({ status: 'existing', latest: makeVersionRow() })
    m.listVersions.mockResolvedValue([makeVersionRow({ version_no: 1, applied_blobs: asJson({ ...SHAS, 'src/styles/theme.css': 'f'.repeat(40) }) })])
    const body = await (await call()).json()
    expect(body.baseline).toEqual({ status: 'ok', created: false })
    expect(body.drift).toEqual({ status: 'drifted', changedPaths: ['src/styles/theme.css'], sinceVersion: 1 })
  })

  it('flags a stale theme.css', async () => {
    m.snapshot.mockResolvedValue({ shas: SHAS, texts: { ...TEXTS, 'src/styles/theme.css': ':root{}' } })
    expect((await (await call()).json()).themeCssStale).toBe(true)
  })

  it('hides raw errors behind a generic 500', async () => {
    m.listInputs.mockRejectedValue(new Error('relation "design_inputs" does not exist'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load the Design Studio' })
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run "app/api/edit/[id]/design/route.test.ts"`
Expected: FAIL (module `./route` not found).

- [ ] **Step 3: Implement** `app/api/edit/[id]/design/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { bundleFromRepoFiles } from '@/lib/design/bundle-files'
import { computeDrift, isThemeCssStale, toBlobMap } from '@/lib/design/drift'
import { readDraftThemeSnapshot } from '@/lib/design/theme-snapshot'
import { getBaselineOrCreate, listInputs, listVersions, readSessionSchema, type BaselineSource } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { buildInputSuggestions, toInputDto, toVersionDto, versionScreenshotPaths } from '@/lib/design/studio-dto'
import type { BaselineStatus, DesignStudioState } from '@/lib/design/studio-types'
import { requireDesignAdmin } from './_design'

export const runtime = 'nodejs'

const NO_THEME_FILES = 'This site has no brand.json / design.json yet — there is no design to import as v0.'

// GET — the Design Studio's full state for one client: versions (newest
// first), drift of the draft theme vs the latest version, whether theme.css is
// stale, the design inputs (with signed thumbnails) and MBP-derived input
// suggestions. On the first load it imports the current draft as v0; if that
// import fails (malformed override markers, an uncurated font, …) the state
// still loads with baseline.status = 'error'. Admin-only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    const supabase = createServerClient()
    const [snapshot, schema, inputs] = await Promise.all([
      readDraftThemeSnapshot(ctx.githubRepo),
      readSessionSchema(supabase, ctx.sessionId),
      listInputs(supabase, ctx.sessionId),
    ])

    const brandText = snapshot.texts[BRAND_PATH]
    const designText = snapshot.texts[DESIGN_PATH]
    const source: BaselineSource =
      brandText && designText
        ? bundleFromRepoFiles(
            { brandText, designText, overridesCss: snapshot.texts[OVERRIDES_PATH] ?? '' },
            { name: 'Baseline', source: 'baseline' }
          )
        : { ok: false, errors: [NO_THEME_FILES] }

    const outcome = await getBaselineOrCreate(supabase, {
      sessionId: ctx.sessionId,
      createdBy: ctx.adminId,
      source,
      appliedBlobs: snapshot.shas,
    })
    const baseline: BaselineStatus =
      outcome.status === 'error' ? { status: 'error', error: outcome.error } : { status: 'ok', created: outcome.status === 'created' }

    const versionRows = await listVersions(supabase, ctx.sessionId)
    const latestRow = versionRows[0] ?? null
    const drift = computeDrift(
      snapshot.shas,
      latestRow ? { versionNo: latestRow.version_no, appliedBlobs: toBlobMap(latestRow.applied_blobs) } : null
    )

    const paths = [
      ...inputs.flatMap((i) => (i.storage_path ? [i.storage_path] : [])),
      ...versionRows.flatMap(versionScreenshotPaths),
    ]
    const signed = await signDesignPaths(supabase, paths)
    const versions = versionRows.map((v) => toVersionDto(v, signed))

    const state: DesignStudioState = {
      versions,
      latest: versions[0] ?? null,
      drift,
      baseline,
      themeCssStale: isThemeCssStale(snapshot.texts),
      inputs: inputs.map((i) => toInputDto(i, signed)),
      suggestions: buildInputSuggestions(schema),
    }
    return NextResponse.json(state)
  } catch (err) {
    return internalError('design:state', err, 'Failed to load the Design Studio')
  }
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run "app/api/edit/[id]/design/route.test.ts"`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add "app/api/edit/[id]/design/route.ts" "app/api/edit/[id]/design/route.test.ts"
git commit -m "feat(design-studio): GET studio state — lazy baseline v0, drift, stale theme.css, inputs, suggestions"
```

---

### Task 6: URL inputs CRUD routes

**Files:**
- Create: `app/api/edit/[id]/design/inputs/route.ts`, `app/api/edit/[id]/design/inputs/route.test.ts`, `app/api/edit/[id]/design/inputs/[inputId]/route.ts`, `app/api/edit/[id]/design/inputs/[inputId]/route.test.ts`

**Interfaces:**
- Consumes: `requireDesignAdmin`; `readJsonBody` (`app/api/_json.ts`); store `listInputs`, `createInput`, `updateInput`, `deleteInput`, `DesignInputPatch`; `signDesignPaths`; Task 4 validators + `toInputDto`; `INPUT_LABEL_MAX`, `INPUT_NOTES_MAX`.
- Produces:
  - `GET /design/inputs` → `200 { inputs: DesignInputDto[] }`
  - `POST /design/inputs` body `{ kind: 'inspiration_url' | 'competitor_url' | 'current_site'; url: string; label?: string; notes?: string }` → `201 { input: DesignInputDto }`; 400 on bad JSON / kind / url / text. The URL is NOT fetched.
  - `PATCH /design/inputs/[inputId]` body `{ label?: string | null; notes?: string | null; archived?: boolean }` → `200 { input }`; 400 invalid id/body/empty; 404 not in this session.
  - `DELETE /design/inputs/[inputId]` → `200 { ok: true }`; 404 not in this session. The storage object is removed by `deleteInput`.

- [ ] **Step 1: Write the failing tests** `app/api/edit/[id]/design/inputs/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { OTHER_SID, SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  listInputs: vi.fn(),
  createInput: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({
  listInputs: (...a: unknown[]) => m.listInputs(...a),
  createInput: (...a: unknown[]) => m.createInput(...a),
}))
vi.mock('@/lib/design/storage', () => ({ signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p) }))

import { GET, POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const post = (body: string) => POST(new Request('http://x/api', { method: 'POST', body }), params)
const postJson = (body: unknown) => post(JSON.stringify(body))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.listInputs.mockReset().mockResolvedValue([makeInputRow({ storage_path: `design/${SID}/inputs/a.webp` })])
  m.createInput.mockReset().mockImplementation(async (_db: unknown, input: { kind: string; url: string; label: string | null }) =>
    makeInputRow({ kind: input.kind, url: input.url, label: input.label })
  )
})

describe('GET /design/inputs', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(new Request('http://x/api'), params)).status).toBe(403)
    expect(m.listInputs).not.toHaveBeenCalled()
  })

  it('lists inputs with signed thumbnails', async () => {
    const res = await GET(new Request('http://x/api'), params)
    expect(res.status).toBe(200)
    expect((await res.json()).inputs[0].thumbnailUrl).toBe(`https://signed/design/${SID}/inputs/a.webp`)
    expect(m.listInputs).toHaveBeenCalledWith({}, SID)
  })
})

describe('POST /design/inputs', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await postJson({ kind: 'competitor_url', url: 'acme.com' })).status).toBe(403)
    expect(m.createInput).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', 'not json'],
    ['an array body', '[]'],
    ['an upload-only kind', JSON.stringify({ kind: 'inspiration_image', url: 'https://acme.com' })],
    ['an unknown kind', JSON.stringify({ kind: 'blog', url: 'https://acme.com' })],
    ['an ftp url', JSON.stringify({ kind: 'competitor_url', url: 'ftp://acme.com/' })],
    ['credentials', JSON.stringify({ kind: 'competitor_url', url: 'https://u:p@acme.com/' })],
    ['an over-long url', JSON.stringify({ kind: 'competitor_url', url: 'https://acme.com/' + 'a'.repeat(300) })],
    ['an over-long label', JSON.stringify({ kind: 'competitor_url', url: 'acme.com', label: 'x'.repeat(121) })],
    ['non-text notes', JSON.stringify({ kind: 'competitor_url', url: 'acme.com', notes: 5 })],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(m.createInput).not.toHaveBeenCalled()
  })

  it('creates a normalized URL input in the gated session (ignores a client session id)', async () => {
    const res = await postJson({ kind: 'competitor_url', url: 'acme.example.com', label: ' Acme CPA ', session_id: OTHER_SID })
    expect(res.status).toBe(201)
    expect(m.createInput).toHaveBeenCalledWith(
      {},
      { sessionId: SID, kind: 'competitor_url', url: 'https://acme.example.com/', label: 'Acme CPA', notes: null, createdBy: 'admin-1' }
    )
    expect((await res.json()).input.url).toBe('https://acme.example.com/')
  })

  it('hides raw errors behind a generic 500', async () => {
    m.createInput.mockRejectedValue(new Error('duplicate key value violates constraint'))
    const res = await postJson({ kind: 'current_site', url: 'bblcpa.com' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to add the input' })
  })
})
```

- [ ] **Step 2: Write the failing tests** `app/api/edit/[id]/design/inputs/[inputId]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { IID, SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  updateInput: vi.fn(),
  deleteInput: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({
  updateInput: (...a: unknown[]) => m.updateInput(...a),
  deleteInput: (...a: unknown[]) => m.deleteInput(...a),
}))
vi.mock('@/lib/design/storage', () => ({ signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p) }))

import { DELETE, PATCH } from './route'

const ctxFor = (inputId: string) => ({ params: Promise.resolve({ id: SID, inputId }) })
const patch = (body: unknown, inputId = IID) =>
  PATCH(new Request('http://x/api', { method: 'PATCH', body: JSON.stringify(body) }), ctxFor(inputId))
const del = (inputId = IID) => DELETE(new Request('http://x/api', { method: 'DELETE' }), ctxFor(inputId))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.updateInput.mockReset().mockResolvedValue(makeInputRow({ label: 'New', archived: true }))
  m.deleteInput.mockReset().mockResolvedValue(true)
})

describe('PATCH /design/inputs/[inputId]', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await patch({ label: 'x' })).status).toBe(403)
    expect(m.updateInput).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-uuid id', { label: 'x' }, 'upload'],
    ['an empty body', {}, IID],
    ['archived not boolean', { archived: 'yes' }, IID],
    ['over-long notes', { notes: 'x'.repeat(2001) }, IID],
    ['non-text label', { label: 42 }, IID],
  ])('rejects %s with 400', async (_l, body, inputId) => {
    expect((await patch(body, inputId)).status).toBe(400)
    expect(m.updateInput).not.toHaveBeenCalled()
  })

  it('404s for an input outside this session', async () => {
    m.updateInput.mockResolvedValue(null)
    const res = await patch({ label: 'x' })
    expect(res.status).toBe(404)
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { label: 'x' })
  })

  it('updates label, notes and archived', async () => {
    const res = await patch({ label: ' New ', notes: '', archived: true })
    expect(res.status).toBe(200)
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { label: 'New', notes: null, archived: true })
    expect((await res.json()).input).toMatchObject({ label: 'New', archived: true })
  })

  it('hides raw errors behind a generic 500', async () => {
    m.updateInput.mockRejectedValue(new Error('boom'))
    const res = await patch({ archived: false })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update the input' })
  })
})

describe('DELETE /design/inputs/[inputId]', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await del()).status).toBe(403)
    expect(m.deleteInput).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id with 400', async () => {
    expect((await del('nope')).status).toBe(400)
  })

  it('404s for an input outside this session', async () => {
    m.deleteInput.mockResolvedValue(false)
    expect((await del()).status).toBe(404)
    expect(m.deleteInput).toHaveBeenCalledWith({}, SID, IID)
  })

  it('deletes', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: Run them and confirm they fail.**
Run: `npx vitest run "app/api/edit/[id]/design/inputs"`
Expected: FAIL (route modules not found).

- [ ] **Step 4: Implement** `app/api/edit/[id]/design/inputs/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { createInput, listInputs } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { isPlainObject, normalizeInputUrl, parseOptionalText, parseUrlInputKind } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'

interface CreateUrlInputBody {
  kind?: unknown
  url?: unknown
  label?: unknown
  notes?: unknown
}

type Params = { params: Promise<{ id: string }> }

// GET — the session's design inputs (oldest first) with signed thumbnails.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const supabase = createServerClient()
    const rows = await listInputs(supabase, ctx.sessionId)
    const signed = await signDesignPaths(supabase, rows.flatMap((r) => (r.storage_path ? [r.storage_path] : [])))
    return NextResponse.json({ inputs: rows.map((r) => toInputDto(r, signed)) })
  } catch (err) {
    return internalError('design:inputs:list', err, 'Failed to load the inputs')
  }
}

// POST — add an inspiration / competitor / current-site URL. Validated only;
// nothing is fetched until the admin presses Capture.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const raw = await readJsonBody<unknown>(req)
  if (raw instanceof NextResponse) return raw
  if (!isPlainObject(raw)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const body: CreateUrlInputBody = raw

  const kind = parseUrlInputKind(body.kind)
  if (!kind) {
    return NextResponse.json({ error: 'kind must be inspiration_url, competitor_url or current_site.' }, { status: 400 })
  }
  const url = normalizeInputUrl(body.url)
  if (!url.ok) return NextResponse.json({ error: url.reason }, { status: 400 })
  const label = parseOptionalText(body.label, INPUT_LABEL_MAX, 'Label')
  if (!label.ok) return NextResponse.json({ error: label.reason }, { status: 400 })
  const notes = parseOptionalText(body.notes, INPUT_NOTES_MAX, 'Notes')
  if (!notes.ok) return NextResponse.json({ error: notes.reason }, { status: 400 })

  try {
    const row = await createInput(createServerClient(), {
      sessionId: ctx.sessionId,
      kind,
      url: url.url,
      label: label.value,
      notes: notes.value,
      createdBy: ctx.adminId,
    })
    return NextResponse.json({ input: toInputDto(row, {}) }, { status: 201 })
  } catch (err) {
    return internalError('design:inputs:create', err, 'Failed to add the input')
  }
}
```

- [ ] **Step 5: Implement** `app/api/edit/[id]/design/inputs/[inputId]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { deleteInput, updateInput, type DesignInputPatch } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { isPlainObject, isUuid, parseOptionalText } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'

interface PatchInputBody {
  label?: unknown
  notes?: unknown
  archived?: unknown
}

type Params = { params: Promise<{ id: string; inputId: string }> }

function invalidId() {
  return NextResponse.json({ error: 'Invalid input id.' }, { status: 400 })
}

// PATCH — edit an input's label / notes, or archive / unarchive it. Scoped to
// the gated session: an id from another session is 404.
export async function PATCH(req: Request, { params }: Params) {
  const { id, inputId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(inputId)) return invalidId()

  const raw = await readJsonBody<unknown>(req)
  if (raw instanceof NextResponse) return raw
  if (!isPlainObject(raw)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const body: PatchInputBody = raw

  const patch: DesignInputPatch = {}
  if ('label' in body) {
    const r = parseOptionalText(body.label, INPUT_LABEL_MAX, 'Label')
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 })
    patch.label = r.value
  }
  if ('notes' in body) {
    const r = parseOptionalText(body.notes, INPUT_NOTES_MAX, 'Notes')
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 })
    patch.notes = r.value
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') return NextResponse.json({ error: 'archived must be true or false.' }, { status: 400 })
    patch.archived = body.archived
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  try {
    const supabase = createServerClient()
    const row = await updateInput(supabase, ctx.sessionId, inputId, patch)
    if (!row) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    const signed = row.storage_path ? await signDesignPaths(supabase, [row.storage_path]) : {}
    return NextResponse.json({ input: toInputDto(row, signed) })
  } catch (err) {
    return internalError('design:inputs:update', err, 'Failed to update the input')
  }
}

// DELETE — remove an input and its stored screenshot/image.
export async function DELETE(_req: Request, { params }: Params) {
  const { id, inputId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(inputId)) return invalidId()
  try {
    const deleted = await deleteInput(createServerClient(), ctx.sessionId, inputId)
    if (!deleted) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return internalError('design:inputs:delete', err, 'Failed to delete the input')
  }
}
```

- [ ] **Step 6: Run the tests.**
Run: `npx vitest run "app/api/edit/[id]/design/inputs"`
Expected: PASS.

- [ ] **Step 7: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add "app/api/edit/[id]/design/inputs/route.ts" "app/api/edit/[id]/design/inputs/route.test.ts" "app/api/edit/[id]/design/inputs/[inputId]/route.ts" "app/api/edit/[id]/design/inputs/[inputId]/route.test.ts"
git commit -m "feat(design-studio): URL input CRUD routes (session-scoped, validated, never fetched)"
```

---

### Task 7: Capture route (ScrapingBee screenshot of a URL input)

**Files:**
- Create: `app/api/edit/[id]/design/inputs/[inputId]/capture/route.ts`, `app/api/edit/[id]/design/inputs/[inputId]/capture/route.test.ts`

**Interfaces:**
- Consumes: `requireDesignAdmin`; `captureExternalScreenshot` (`lib/design/capture/external.ts`, returns WebP already); store `getInput`, `claimCapture`, `updateInput`; `designStoragePath`, `storeDesignImage`, `removeDesignPaths`, `signDesignPaths`; `isUuid`, `toInputDto`.
- Produces: `POST /design/inputs/[inputId]/capture` (no body) →
  - `200 { input }` when the capture succeeded (`captureStatus: 'ok'`, new thumbnail) or failed cleanly (`captureStatus: 'error'`, our own reason in `captureError`, any previous thumbnail kept);
  - 400 invalid id or an uploaded image; 404 not in this session (or deleted mid-capture); 409 a capture is already running; 500 unexpected (row reset to `error`).

**Ruling — re-capture storage:** each capture writes a NEW object `design/{sid}/inputs/{inputId}-{uuid}.webp` (no upsert). It then points the row at it and deletes the previous object (best-effort). A failed re-capture keeps the old image and path.

- [ ] **Step 1: Write the failing tests** `app/api/edit/[id]/design/inputs/[inputId]/capture/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { IID, SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  capture: vi.fn(),
  getInput: vi.fn(),
  claimCapture: vi.fn(),
  updateInput: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/capture/external', () => ({ captureExternalScreenshot: (url: string) => m.capture(url) }))
vi.mock('@/lib/design/store', () => ({
  getInput: (...a: unknown[]) => m.getInput(...a),
  claimCapture: (...a: unknown[]) => m.claimCapture(...a),
  updateInput: (...a: unknown[]) => m.updateInput(...a),
}))
vi.mock('@/lib/design/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/design/storage')>()
  return {
    ...actual,
    storeDesignImage: (s: unknown, p: string, w: Buffer) => m.store(s, p, w),
    removeDesignPaths: (s: unknown, p: string[]) => m.remove(s, p),
    signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p),
  }
})

import { POST } from './route'

const OLD = `design/${SID}/inputs/${IID}-old.webp`
const call = (inputId = IID) => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID, inputId }) })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.getInput.mockReset().mockResolvedValue(makeInputRow({ storage_path: OLD, capture_status: 'ok' }))
  m.claimCapture.mockReset().mockResolvedValue(makeInputRow({ storage_path: OLD, capture_status: 'pending' }))
  m.updateInput.mockReset().mockImplementation(async (_db: unknown, _sid: string, _iid: string, patch: { captureStatus?: string; storagePath?: string; captureError?: string }) =>
    makeInputRow({ capture_status: patch.captureStatus ?? 'ok', storage_path: patch.storagePath ?? OLD, capture_error: patch.captureError ?? null })
  )
  m.store.mockReset().mockResolvedValue(undefined)
  m.remove.mockReset().mockResolvedValue(undefined)
  m.capture.mockReset().mockResolvedValue({ ok: true, webp: Buffer.from('w'), width: 1440, height: 900 })
})

describe('POST /design/inputs/[inputId]/capture', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.capture).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id with 400', async () => {
    expect((await call('nope')).status).toBe(400)
    expect(m.getInput).not.toHaveBeenCalled()
  })

  it('404s for an input outside this session', async () => {
    m.getInput.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.getInput).toHaveBeenCalledWith({}, SID, IID)
    expect(m.claimCapture).not.toHaveBeenCalled()
  })

  it('refuses to capture an uploaded image (400)', async () => {
    m.getInput.mockResolvedValue(makeInputRow({ kind: 'inspiration_image', url: null }))
    expect((await call()).status).toBe(400)
    expect(m.claimCapture).not.toHaveBeenCalled()
  })

  it('409s when a capture is already running', async () => {
    m.claimCapture.mockResolvedValue(null)
    expect((await call()).status).toBe(409)
    expect(m.capture).not.toHaveBeenCalled()
  })

  it('stores a new WebP, points the row at it and deletes the previous object', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.capture).toHaveBeenCalledWith('https://acme.example.com/')
    const storedPath = m.store.mock.calls[0][1] as string
    expect(storedPath).toMatch(new RegExp(`^design/${SID}/inputs/${IID}-[0-9a-f-]{36}\\.webp$`))
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, expect.objectContaining({ captureStatus: 'ok', captureError: null, storagePath: storedPath }))
    expect(m.remove).toHaveBeenCalledWith({}, [OLD])
    const body = await res.json()
    expect(body.input.captureStatus).toBe('ok')
    expect(body.input.thumbnailUrl).toBe(`https://signed/${storedPath}`)
  })

  it('records a clean capture failure with our own reason and keeps the old image', async () => {
    m.capture.mockResolvedValue({ ok: false, reason: 'That URL is not publicly reachable.' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.store).not.toHaveBeenCalled()
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { captureStatus: 'error', captureError: 'That URL is not publicly reachable.' })
    const body = await res.json()
    expect(body.input.captureStatus).toBe('error')
    expect(body.input.thumbnailUrl).toBe(`https://signed/${OLD}`)
  })

  it('resets the row to error and cleans up on an unexpected failure', async () => {
    m.updateInput.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to capture the screenshot' })
    const storedPath = m.store.mock.calls[0][1] as string
    expect(m.remove).toHaveBeenCalledWith({}, [storedPath])
    expect(m.updateInput).toHaveBeenLastCalledWith({}, SID, IID, { captureStatus: 'error', captureError: 'Capture failed. Try again.' })
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run "app/api/edit/[id]/design/inputs/[inputId]/capture/route.test.ts"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `app/api/edit/[id]/design/inputs/[inputId]/capture/route.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { captureExternalScreenshot } from '@/lib/design/capture/external'
import { claimCapture, getInput, updateInput, type DesignInputRow } from '@/lib/design/store'
import { designStoragePath, removeDesignPaths, signDesignPaths, storeDesignImage } from '@/lib/design/storage'
import { isUuid } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { requireDesignAdmin } from '../../../_design'

export const runtime = 'nodejs'
// ScrapingBee: up to two 45 s attempts, plus sharp + storage.
export const maxDuration = 120

const GENERIC_CAPTURE_ERROR = 'Capture failed. Try again.'

async function signedFor(supabase: ReturnType<typeof createServerClient>, row: DesignInputRow): Promise<Record<string, string>> {
  return row.storage_path ? signDesignPaths(supabase, [row.storage_path]) : {}
}

// POST — (re-)capture a URL input's screenshot through ScrapingBee (never our
// own browser; SSRF-checked inside captureExternalScreenshot). The row is
// claimed atomically ('pending'); every exit leaves it 'ok' or 'error' — the
// sweep cron errors anything still pending after 10 minutes.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; inputId: string }> }) {
  const { id, inputId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(inputId)) return NextResponse.json({ error: 'Invalid input id.' }, { status: 400 })

  const supabase = createServerClient()
  let claimed: DesignInputRow
  try {
    const input = await getInput(supabase, ctx.sessionId, inputId)
    if (!input) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    if (input.kind === 'inspiration_image' || !input.url) {
      return NextResponse.json({ error: 'Uploaded images don’t need capturing.' }, { status: 400 })
    }
    const row = await claimCapture(supabase, ctx.sessionId, inputId)
    if (!row) return NextResponse.json({ error: 'A capture is already running for this input.' }, { status: 409 })
    claimed = row
  } catch (err) {
    return internalError('design:inputs:capture', err, 'Failed to start the capture')
  }

  let storedPath: string | null = null
  try {
    const shot = await captureExternalScreenshot(claimed.url ?? '')
    if (!shot.ok) {
      // shot.reason is our own message from capture/external.ts — never provider text.
      const row = await updateInput(supabase, ctx.sessionId, inputId, { captureStatus: 'error', captureError: shot.reason })
      if (!row) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
      return NextResponse.json({ input: toInputDto(row, await signedFor(supabase, row)) })
    }

    const path = designStoragePath(ctx.sessionId, 'inputs', `${inputId}-${randomUUID()}.webp`)
    await storeDesignImage(supabase, path, shot.webp)
    storedPath = path

    const row = await updateInput(supabase, ctx.sessionId, inputId, {
      captureStatus: 'ok',
      captureError: null,
      storagePath: path,
      capturedAt: new Date().toISOString(),
    })
    if (!row) {
      // Deleted while we were capturing — drop the orphaned object.
      await removeDesignPaths(supabase, [path]).catch((e) => console.warn('[design-capture] orphan cleanup failed:', e))
      return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    }

    const previous = claimed.storage_path
    if (previous && previous !== path) {
      await removeDesignPaths(supabase, [previous]).catch((e) => console.warn('[design-capture] old capture cleanup failed:', e))
    }
    return NextResponse.json({ input: toInputDto(row, await signedFor(supabase, row)) })
  } catch (err) {
    if (storedPath) {
      await removeDesignPaths(supabase, [storedPath]).catch((e) => console.warn('[design-capture] cleanup failed:', e))
    }
    await updateInput(supabase, ctx.sessionId, inputId, { captureStatus: 'error', captureError: GENERIC_CAPTURE_ERROR }).catch(() => null)
    return internalError('design:inputs:capture', err, 'Failed to capture the screenshot')
  }
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run "app/api/edit/[id]/design/inputs/[inputId]/capture/route.test.ts"`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add "app/api/edit/[id]/design/inputs/[inputId]/capture/route.ts" "app/api/edit/[id]/design/inputs/[inputId]/capture/route.test.ts"
git commit -m "feat(design-studio): capture route — atomic claim, new object per capture, old one deleted, error always recorded"
```

---

### Task 8: Upload route (inspiration images)

**Files:**
- Create: `app/api/edit/[id]/design/inputs/upload/route.ts`, `app/api/edit/[id]/design/inputs/upload/route.test.ts`

**Interfaces:**
- Consumes: `requireDesignAdmin`; `fileTypeFromBuffer` (`file-type`); `toWebp`, `designStoragePath`, `storeDesignImage`, `removeDesignPaths`, `signDesignPaths`; store `createInput`; `parseOptionalText`; `toInputDto`.
- Produces: `POST /design/inputs/upload` multipart `{ file: File; label?: string; notes?: string }` → `201 { input }` (kind `inspiration_image`, `captureStatus: 'ok'`); 400 not multipart / missing or empty file / bad text; 413 over 8 MB; 415 not PNG/JPEG/WebP by magic bytes, or undecodable. Cross-session ids do not apply (no id in the path; the session comes from the gate).

**Note:** Vercel Functions accept request bodies up to 100 MB, so the spec's 8 MB cap is the effective limit. The route enforces it, and the UI pre-checks the same 8 MB with a clear message (Task 10).

- [ ] **Step 1: Write the failing tests** `app/api/edit/[id]/design/inputs/upload/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  createInput: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({ createInput: (...a: unknown[]) => m.createInput(...a) }))
vi.mock('@/lib/design/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/design/storage')>()
  return {
    ...actual,
    storeDesignImage: (s: unknown, p: string, w: Buffer) => m.store(s, p, w),
    removeDesignPaths: (s: unknown, p: string[]) => m.remove(s, p),
    signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p),
  }
})

import { POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const send = (body: FormData | string) => POST(new Request('http://x/api', { method: 'POST', body }), params)

async function pngFile(): Promise<File> {
  const buf = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#003b71' } }).png().toBuffer()
  return new File([new Uint8Array(buf)], 'shot.png', { type: 'image/png' })
}

function form(file: File | null, extra: Record<string, string> = {}): FormData {
  const f = new FormData()
  if (file) f.set('file', file)
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.store.mockReset().mockResolvedValue(undefined)
  m.remove.mockReset().mockResolvedValue(undefined)
  m.createInput.mockReset().mockImplementation(async (_db: unknown, input: { storagePath: string }) =>
    makeInputRow({ kind: 'inspiration_image', url: null, label: null, storage_path: input.storagePath, capture_status: 'ok' })
  )
})

describe('POST /design/inputs/upload', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await send(form(await pngFile()))).status).toBe(403)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('rejects a non-multipart body with 400', async () => {
    expect((await send('{"x":1}')).status).toBe(400)
  })

  it('rejects a missing or empty file with 400', async () => {
    expect((await send(form(null))).status).toBe(400)
    expect((await send(form(new File([], 'e.png', { type: 'image/png' })))).status).toBe(400)
  })

  it('rejects an over-long label with 400', async () => {
    expect((await send(form(await pngFile(), { label: 'x'.repeat(121) }))).status).toBe(400)
  })

  it('rejects a file over 8 MB with 413 before storing anything', async () => {
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    expect((await send(form(big))).status).toBe(413)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('rejects a file whose magic bytes are not PNG/JPEG/WebP with 415', async () => {
    const svg = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')], 'x.png', { type: 'image/png' })
    expect((await send(form(svg))).status).toBe(415)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('re-encodes to WebP, stores privately and creates the input', async () => {
    const res = await send(form(await pngFile(), { label: 'Moodboard' }))
    expect(res.status).toBe(201)
    const [, storedPath, webp] = m.store.mock.calls[0] as [unknown, string, Buffer]
    expect(storedPath).toMatch(new RegExp(`^design/${SID}/inputs/[0-9a-f-]{36}\\.webp$`))
    expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(m.createInput).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ sessionId: SID, kind: 'inspiration_image', url: null, label: 'Moodboard', storagePath: storedPath, captureStatus: 'ok', createdBy: 'admin-1' })
    )
    expect((await res.json()).input.thumbnailUrl).toBe(`https://signed/${storedPath}`)
  })

  it('deletes the stored object when the insert fails', async () => {
    m.createInput.mockRejectedValue(new Error('insert failed'))
    const res = await send(form(await pngFile()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to save the image' })
    expect(m.remove).toHaveBeenCalledWith({}, [m.store.mock.calls[0][1]])
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run "app/api/edit/[id]/design/inputs/upload/route.test.ts"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `app/api/edit/[id]/design/inputs/upload/route.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { createInput } from '@/lib/design/store'
import { designStoragePath, removeDesignPaths, signDesignPaths, storeDesignImage, toWebp } from '@/lib/design/storage'
import { parseOptionalText } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
// Magic-byte-verifiable rasters only. SVG has no magic bytes and can carry script.
const UPLOAD_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

// POST multipart { file, label?, notes? } — an inspiration image. Validated
// (size, magic bytes) and re-encoded to WebP (strips metadata, caps the long
// edge) BEFORE anything is written; stored privately under
// design/{sid}/inputs/{uuid}.webp. If the row insert fails the object is
// deleted, so nothing is left behind.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'An image file is required.' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Images must be 8 MB or smaller.' }, { status: 413 })

  const label = parseOptionalText(form.get('label'), INPUT_LABEL_MAX, 'Label')
  if (!label.ok) return NextResponse.json({ error: label.reason }, { status: 400 })
  const notes = parseOptionalText(form.get('notes'), INPUT_NOTES_MAX, 'Notes')
  if (!notes.ok) return NextResponse.json({ error: notes.reason }, { status: 400 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const type = await fileTypeFromBuffer(bytes)
  if (!type || !UPLOAD_MIMES.has(type.mime)) {
    return NextResponse.json({ error: 'Upload a PNG, JPEG or WebP image.' }, { status: 415 })
  }
  let webp: Buffer
  try {
    webp = (await toWebp(bytes)).webp
  } catch {
    return NextResponse.json({ error: 'That image could not be read.' }, { status: 415 })
  }

  const inputId = randomUUID()
  const path = designStoragePath(ctx.sessionId, 'inputs', `${inputId}.webp`)
  const supabase = createServerClient()
  let stored = false
  try {
    await storeDesignImage(supabase, path, webp)
    stored = true
    const row = await createInput(supabase, {
      id: inputId,
      sessionId: ctx.sessionId,
      kind: 'inspiration_image',
      url: null,
      label: label.value,
      notes: notes.value,
      storagePath: path,
      captureStatus: 'ok',
      capturedAt: new Date().toISOString(),
      createdBy: ctx.adminId,
    })
    const signed = await signDesignPaths(supabase, [path])
    return NextResponse.json({ input: toInputDto(row, signed) }, { status: 201 })
  } catch (err) {
    if (stored) {
      await removeDesignPaths(supabase, [path]).catch((e) => console.warn('[design-upload] cleanup failed:', e))
    }
    return internalError('design:inputs:upload', err, 'Failed to save the image')
  }
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run "app/api/edit/[id]/design/inputs/upload/route.test.ts"`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add "app/api/edit/[id]/design/inputs/upload/route.ts" "app/api/edit/[id]/design/inputs/upload/route.test.ts"
git commit -m "feat(design-studio): inspiration image upload — 8 MB cap, magic bytes, WebP re-encode before any write"
```

---

### Task 9: Sweep stale design rows from the cron

**Files:**
- Create: `lib/design/sweep.ts`, `lib/design/sweep.test.ts`
- Modify: `app/api/cron/sweep-stuck-jobs/route.ts`

**Interfaces:**
- Consumes: `RUN_ACTIVE_STATUSES`, `CONCEPT_ACTIVE_STATUSES` (Task 1); `fakeSupabase` (Task 2).
- Produces: `DESIGN_INPUT_STUCK_MS` (10 min), `DESIGN_RUN_STUCK_MS` (15 min), `type DesignSweepResult = { inputs: number; runs: number; concepts: number }`, `sweepStuckDesignRows(supabase: SupabaseClient<Database>, now?: number): Promise<DesignSweepResult>` (never throws). The cron JSON gains `designInputsSwept`, `designRunsSwept`, `designConceptsSwept`.

The existing cron has no tests, so the logic lives in `sweep.ts` and is tested there. The cron change is a thin call. Design sweeps are logged but are not added to the admin alert email (they are admin-initiated and visible in the Studio).

- [ ] **Step 1: Write the failing tests** `lib/design/sweep.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { DESIGN_INPUT_STUCK_MS, DESIGN_RUN_STUCK_MS, sweepStuckDesignRows } from './sweep'

const NOW = Date.parse('2026-09-25T12:00:00.000Z')

afterEach(() => vi.restoreAllMocks())

describe('sweepStuckDesignRows', () => {
  it('errors stale pending captures, active runs and generating/refining concepts', async () => {
    const f = fakeSupabase({
      design_inputs: [{ data: [{ id: 'i1' }] }],
      design_runs: [{ data: [{ id: 'r1' }, { id: 'r2' }] }],
      design_concepts: [{ data: [] }],
    })
    expect(await sweepStuckDesignRows(f.client, NOW)).toEqual({ inputs: 1, runs: 2, concepts: 0 })

    const stamp = new Date(NOW).toISOString()
    expect(f.opsFor('design_inputs')).toEqual([
      ['update', { capture_status: 'error', capture_error: 'Capture timed out', updated_at: stamp }],
      ['eq', 'capture_status', 'pending'],
      ['lt', 'updated_at', new Date(NOW - DESIGN_INPUT_STUCK_MS).toISOString()],
      ['select', 'id'],
    ])
    expect(f.opsFor('design_runs')).toContainEqual(['in', 'status', ['queued', 'capturing', 'generating', 'refining']])
    expect(f.opsFor('design_runs')).toContainEqual(['lt', 'updated_at', new Date(NOW - DESIGN_RUN_STUCK_MS).toISOString()])
    expect(f.opsFor('design_concepts')).toContainEqual(['in', 'status', ['generating', 'refining']])
  })

  it('never throws: a failing query logs and counts 0', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = fakeSupabase({
      design_inputs: [{ error: { message: 'relation does not exist' } }],
      design_runs: [{ data: [{ id: 'r1' }] }],
      design_concepts: [],
    })
    expect(await sweepStuckDesignRows(f.client, NOW)).toEqual({ inputs: 0, runs: 1, concepts: 0 })
    expect(err).toHaveBeenCalledTimes(2)
  })
})
```

(In the second test, `design_concepts: []` makes the fake throw "no queued result". That exercises the thrown-error path, which is why `console.error` is called twice.)

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/sweep.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/design/sweep.ts`.**

```ts
// Server-only. Called by /api/cron/sweep-stuck-jobs. Resets Design Studio rows
// whose worker died mid-flight so the UI stops showing them as in progress
// (and, for runs, the "one active run per session" slot is released):
//   design_inputs  capture 'pending'           > 10 min → 'error' ("Capture timed out")
//   design_runs    queued/capturing/generating/refining > 15 min → 'error'
//   design_concepts generating/refining        > 15 min → 'error'
// Keyed on updated_at (stamped on claim / every step). Fail-soft: never throws.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { CONCEPT_ACTIVE_STATUSES, RUN_ACTIVE_STATUSES } from './studio-types'

export const DESIGN_INPUT_STUCK_MS = 10 * 60 * 1000
export const DESIGN_RUN_STUCK_MS = 15 * 60 * 1000

export type DesignSweepResult = { inputs: number; runs: number; concepts: number }

type SweepQuery = PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>

async function count(label: string, run: () => SweepQuery): Promise<number> {
  try {
    const { data, error } = await run()
    if (error) {
      console.error(`[sweep-stuck-jobs] design ${label} sweep failed:`, error.message)
      return 0
    }
    return data?.length ?? 0
  } catch (err) {
    console.error(`[sweep-stuck-jobs] design ${label} sweep failed:`, err)
    return 0
  }
}

export async function sweepStuckDesignRows(supabase: SupabaseClient<Database>, now: number = Date.now()): Promise<DesignSweepResult> {
  const stamp = new Date(now).toISOString()
  const inputCutoff = new Date(now - DESIGN_INPUT_STUCK_MS).toISOString()
  const runCutoff = new Date(now - DESIGN_RUN_STUCK_MS).toISOString()

  const [inputs, runs, concepts] = await Promise.all([
    count('inputs', () =>
      supabase
        .from('design_inputs')
        .update({ capture_status: 'error', capture_error: 'Capture timed out', updated_at: stamp })
        .eq('capture_status', 'pending')
        .lt('updated_at', inputCutoff)
        .select('id')
    ),
    count('runs', () =>
      supabase
        .from('design_runs')
        .update({ status: 'error', error: 'Run timed out (swept by cron)', updated_at: stamp })
        .in('status', [...RUN_ACTIVE_STATUSES])
        .lt('updated_at', runCutoff)
        .select('id')
    ),
    count('concepts', () =>
      supabase
        .from('design_concepts')
        .update({ status: 'error', error: 'Concept timed out (swept by cron)', updated_at: stamp })
        .in('status', [...CONCEPT_ACTIVE_STATUSES])
        .lt('updated_at', runCutoff)
        .select('id')
    ),
  ])
  return { inputs, runs, concepts }
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run lib/design/sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the cron.** Make three edits in `app/api/cron/sweep-stuck-jobs/route.ts`:
1. After `import { MAX_IMPORT_ATTEMPTS } from '@/lib/content/article-import-inclusion'` add:
   ```ts
   import { sweepStuckDesignRows } from '@/lib/design/sweep'
   ```
2. Immediately after these two lines:
   ```ts
     const [research, pages, ideas, socials, oneoffs, audits, newPages] =
       sweep ?? [null, null, null, null, null, null, null]
   ```
   insert:
   ```ts

     // Design Studio (migration 078): captures, runs and concepts whose worker
     // died mid-flight. Fail-soft — the helper logs and counts 0, never throws,
     // so the self-heal steps below always run.
     const designSwept = await sweepStuckDesignRows(supabase)
     if (designSwept.inputs || designSwept.runs || designSwept.concepts) {
       console.warn(
         `[sweep-stuck-jobs] design inputs=${designSwept.inputs} runs=${designSwept.runs} concepts=${designSwept.concepts}`
       )
     }
   ```
3. In the final `return NextResponse.json({ … })` line, replace `researchResumed, cutoff })` with:
   ```ts
   researchResumed, designInputsSwept: designSwept.inputs, designRunsSwept: designSwept.runs, designConceptsSwept: designSwept.concepts, cutoff })
   ```

The CRON_SECRET fail-closed check at the top of the route is unchanged. Do NOT curl the cron locally: `.env.local` points at the production database, and the route also auto-resumes real jobs.

- [ ] **Step 6: Run the checks and commit.**
Run: `npx vitest run lib/design && npx tsc --noEmit && npm run lint`, plus the three greps. Then:

```bash
git add lib/design/sweep.ts lib/design/sweep.test.ts app/api/cron/sweep-stuck-jobs/route.ts
git commit -m "feat(design-studio): sweep cron resets stale captures (10 min), runs and concepts (15 min)"
```

---

### Task 10: UI — Studio | Controls tabs, InputsPanel, VersionsPanel

**Files:**
- Create: `components/design-studio/api.ts`, `components/design-studio/styles.ts`, `components/design-studio/InlineConfirm.tsx`, `components/design-studio/InputCard.tsx`, `components/design-studio/InputsPanel.tsx`, `components/design-studio/VersionsPanel.tsx`, `components/design-studio/DesignStudio.tsx`
- Modify: `components/editor/ThemeStudio.tsx`

**Interfaces:**
- Consumes: the routes from Tasks 5–8; client-safe `studio-types.ts` and `input-validation.ts` only.
- Produces: `<DesignStudio sessionId />`; `ThemeStudio` renders a "Studio | Controls" tab bar (default **Controls**, so today's workflow is unchanged). Controls stays mounted while hidden (preview + ThemeChat keep their state). Studio mounts on open, so it refetches (and reflects drift) every time it's opened.

**Testing ruling:** the codebase has no component tests (vitest `include` is `lib/**` and `app/**` only, `environment: 'node'`). This task relies on the route/store tests plus the Task 11 manual check. Do not add a DOM test setup.

**Confirm ruling:** the codebase uses `window.confirm` (e.g. `ChangesPanel`, `UserRow`). Per the controller, P2 uses a non-browser, two-step inline confirm (`InlineConfirm`): click Delete → "Delete this input? [Delete] [Cancel]". Browser dialogs also block the Chrome automation used for the manual check.

- [ ] **Step 1: Create `components/design-studio/api.ts`.**

```ts
// Client-side fetch helper for the Design Studio routes: JSON or multipart in,
// typed JSON out. A non-2xx response throws with the route's own { error }.
type ApiInit = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; json?: unknown; form?: FormData }

export async function designApi<T = unknown>(url: string, init: ApiInit = {}): Promise<T> {
  const headers: HeadersInit | undefined = init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined
  const body: BodyInit | undefined = init.json !== undefined ? JSON.stringify(init.json) : init.form
  const res = await fetch(url, { method: init.method ?? 'GET', headers, body })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
```

- [ ] **Step 2: Create `components/design-studio/styles.ts`.**

```ts
// Shared Tailwind class strings for the Design Studio — design tokens only
// (raw-docs/design.md): pill buttons, brand colours, visible focus rings.
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan'

export const PRIMARY_BTN = `rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const SECONDARY_BTN = `rounded-pill border border-border-default px-3.5 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-colors hover:border-brand-cyan hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const PRIMARY_BTN_SM = `rounded-pill bg-brand-cyan px-3 py-1 font-heading text-[11px] font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const SECONDARY_BTN_SM = `rounded-pill border border-border-default px-3 py-1 font-heading text-[11px] font-semibold text-text-secondary transition-colors hover:border-brand-cyan hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const CHIP = `rounded-pill border border-border-default bg-surface-card px-2.5 py-1 font-body text-[11px] text-text-secondary transition-colors hover:border-brand-cyan hover:text-brand-navy ${FOCUS}`
export const LINK_BTN = `self-start rounded-pill px-2 py-1 font-heading text-[11px] font-semibold text-text-secondary hover:text-brand-navy ${FOCUS}`
export const FIELD = 'min-w-0 rounded-pill border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs text-text-primary focus:border-brand-cyan focus:outline-none'
export const TEXTAREA = 'min-w-0 resize-y rounded-2xl border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs text-text-primary focus:border-brand-cyan focus:outline-none'
export const PANEL = 'flex min-w-0 flex-col gap-4 rounded-xl border border-border-default bg-surface-card p-4 shadow-subtle'
```

- [ ] **Step 3: Create `components/design-studio/InlineConfirm.tsx`.**

```tsx
'use client'

import { useState } from 'react'
import { FOCUS, SECONDARY_BTN_SM } from './styles'

// Two-step inline confirm for destructive actions — no browser dialog. The
// first click arms it; the row then shows the prompt with Confirm / Cancel.
export default function InlineConfirm({
  label,
  prompt,
  confirmLabel,
  busy,
  onConfirm,
}: {
  label: string
  prompt: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => Promise<void>
}) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} disabled={busy} className={`${SECONDARY_BTN_SM} hover:border-error/40 hover:text-error`}>
        {label}
      </button>
    )
  }
  return (
    <span role="group" aria-label={prompt} className="inline-flex items-center gap-1.5 rounded-pill bg-error/10 py-0.5 pl-2.5 pr-1">
      <span className="font-body text-[11px] text-error">{prompt}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setArmed(false)
          void onConfirm()
        }}
        className={`rounded-pill bg-error px-2.5 py-0.5 font-heading text-[11px] font-semibold text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS}`}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className={`rounded-pill px-2 py-0.5 font-heading text-[11px] font-semibold text-text-secondary hover:text-brand-navy ${FOCUS}`}
      >
        Cancel
      </button>
    </span>
  )
}
```

- [ ] **Step 4: Create `components/design-studio/InputCard.tsx`.**

```tsx
'use client'

import { useState } from 'react'
import { INPUT_KIND_LABELS, INPUT_LABEL_MAX, INPUT_NOTES_MAX, type DesignInputDto } from '@/lib/design/studio-types'
import { displayHost } from '@/lib/design/input-validation'
import InlineConfirm from './InlineConfirm'
import { designApi, errorMessage } from './api'
import { FIELD, PRIMARY_BTN_SM, SECONDARY_BTN_SM, TEXTAREA } from './styles'

type Busy = 'capture' | 'save' | 'archive' | 'delete' | null

// One design input: thumbnail (signed URL), capture / re-capture for URL kinds,
// edit label + notes, archive, and a two-step delete.
export default function InputCard({
  sessionId,
  input,
  onChanged,
}: {
  sessionId: string
  input: DesignInputDto
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const base = `/api/edit/${sessionId}/design/inputs/${input.id}`
  const capturing = busy === 'capture' || input.captureStatus === 'pending'
  const title = input.label || displayHost(input.url) || 'Uploaded image'
  const canCapture = input.kind !== 'inspiration_image'

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<unknown>, fallback: string) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, fallback))
    } finally {
      setBusy(null)
    }
  }

  const startEdit = () => {
    setLabelDraft(input.label ?? '')
    setNotesDraft(input.notes ?? '')
    setEditing(true)
  }

  return (
    <article className="flex h-full flex-col gap-2 rounded-xl border border-border-default bg-surface-card p-3 shadow-subtle">
      <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border-default bg-surface-subtle">
        {input.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
          <img src={input.thumbnailUrl} alt={`Screenshot of ${title}`} className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center font-body text-[11px] text-text-muted">
            {capturing ? 'Capturing…' : input.captureStatus === 'error' ? 'Capture failed' : 'Not captured yet'}
          </div>
        )}
        {capturing && input.thumbnailUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-card/70 font-heading text-xs font-semibold text-brand-navy">
            Capturing…
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-pill bg-surface-subtle px-2 py-0.5 font-heading text-[10px] font-semibold text-text-secondary">
            {INPUT_KIND_LABELS[input.kind]}
          </span>
          {input.archived && (
            <span className="shrink-0 rounded-pill bg-warning/10 px-2 py-0.5 font-heading text-[10px] font-semibold text-warning-strong">Archived</span>
          )}
        </div>
        <h3 className="mt-1 truncate font-heading text-xs font-semibold text-text-primary" title={title}>
          {title}
        </h3>
        {input.url && (
          <a
            href={input.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-body text-[11px] text-text-muted hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
          >
            {input.url}
          </a>
        )}
        {input.captureStatus === 'error' && input.captureError && (
          <p className="mt-1 font-body text-[11px] text-error">{input.captureError}</p>
        )}
        {!editing && input.notes && <p className="mt-1 whitespace-pre-wrap font-body text-[11px] text-text-secondary">{input.notes}</p>}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(
              'save',
              async () => {
                await designApi(base, { method: 'PATCH', json: { label: labelDraft, notes: notesDraft } })
                setEditing(false)
              },
              'Could not save'
            )
          }}
          className="flex flex-col gap-1.5"
        >
          <label className="sr-only" htmlFor={`label-${input.id}`}>Label</label>
          <input id={`label-${input.id}`} value={labelDraft} maxLength={INPUT_LABEL_MAX} onChange={(e) => setLabelDraft(e.target.value)} placeholder="Label" className={FIELD} />
          <label className="sr-only" htmlFor={`notes-${input.id}`}>Notes</label>
          <textarea
            id={`notes-${input.id}`}
            value={notesDraft}
            maxLength={INPUT_NOTES_MAX}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="What to take from this (e.g. the calm type, not the colours)"
            className={TEXTAREA}
          />
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy !== null} className={PRIMARY_BTN_SM}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={SECONDARY_BTN_SM}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {canCapture && (
            <button
              type="button"
              onClick={() => void run('capture', () => designApi(`${base}/capture`, { method: 'POST' }), 'Capture failed')}
              disabled={busy !== null || capturing}
              className={PRIMARY_BTN_SM}
            >
              {capturing ? 'Capturing… (up to a minute)' : input.thumbnailUrl ? 'Re-capture' : 'Capture'}
            </button>
          )}
          <button type="button" onClick={startEdit} disabled={busy !== null} className={SECONDARY_BTN_SM}>
            Edit
          </button>
          <button
            type="button"
            onClick={() => void run('archive', () => designApi(base, { method: 'PATCH', json: { archived: !input.archived } }), 'Could not update')}
            disabled={busy !== null}
            className={SECONDARY_BTN_SM}
          >
            {input.archived ? 'Unarchive' : 'Archive'}
          </button>
          <InlineConfirm
            label="Delete"
            prompt="Delete this input?"
            confirmLabel="Delete"
            busy={busy !== null}
            onConfirm={() => run('delete', () => designApi(base, { method: 'DELETE' }), 'Could not delete')}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-error/10 px-2.5 py-1 font-body text-[11px] text-error">
          {error}
        </p>
      )}
    </article>
  )
}
```

- [ ] **Step 5: Create `components/design-studio/InputsPanel.tsx`.**

```tsx
'use client'

import { useRef, useState, type FormEvent } from 'react'
import {
  INPUT_KIND_LABELS,
  INPUT_LABEL_MAX,
  URL_INPUT_KINDS,
  type DesignInputDto,
  type InputSuggestions,
  type UrlInputKind,
} from '@/lib/design/studio-types'
import { displayHost, parseUrlInputKind } from '@/lib/design/input-validation'
import InputCard from './InputCard'
import { designApi, errorMessage } from './api'
import { CHIP, FIELD, LINK_BTN, PANEL, PRIMARY_BTN, SECONDARY_BTN } from './styles'

// Pre-check the spec's 8 MB cap in the browser for a clear message; the
// route itself enforces the same cap and magic bytes for any caller.
const CLIENT_UPLOAD_MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp'

export default function InputsPanel({
  sessionId,
  inputs,
  suggestions,
  onChanged,
}: {
  sessionId: string
  inputs: DesignInputDto[]
  suggestions: InputSuggestions
  onChanged: () => Promise<void>
}) {
  const [kind, setKind] = useState<UrlInputKind>('inspiration_url')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const archivedCount = inputs.filter((i) => i.archived).length
  const visible = inputs.filter((i) => showArchived || !i.archived)
  const hasCurrentSite = inputs.some((i) => i.kind === 'current_site' && !i.archived)
  const usedLabels = new Set(inputs.map((i) => (i.label ?? '').trim().toLowerCase()))
  const competitorChips = suggestions.competitors.filter((c) => !usedLabels.has(c.name.toLowerCase()))
  const currentSite = !hasCurrentSite ? suggestions.currentSite : null

  function prefill(nextKind: UrlInputKind, nextUrl: string, nextLabel: string) {
    setKind(nextKind)
    setUrl(nextUrl)
    setLabel(nextLabel)
    setError(null)
    urlRef.current?.focus()
  }

  async function addUrl(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAdding(true)
    setError(null)
    try {
      await designApi(`/api/edit/${sessionId}/design/inputs`, {
        method: 'POST',
        json: { kind, url, label: label.trim() || undefined },
      })
      setUrl('')
      setLabel('')
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, 'Could not add that URL'))
    } finally {
      setAdding(false)
    }
  }

  async function upload(file: File) {
    setError(null)
    if (file.size > CLIENT_UPLOAD_MAX_BYTES) {
      setError('Images must be 8 MB or smaller — export a smaller PNG, JPEG or WebP.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      await designApi(`/api/edit/${sessionId}/design/inputs/upload`, { method: 'POST', form })
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, 'Could not upload that image'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section aria-labelledby="design-inputs-heading" className={PANEL}>
      <div>
        <h2 id="design-inputs-heading" className="font-heading text-sm font-semibold text-text-primary">
          Inputs
        </h2>
        <p className="font-body text-xs text-text-muted">
          Sites and images the concepts should learn from. Competitor names come from the MBP — add their website address.
        </p>
      </div>

      {(currentSite || competitorChips.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-heading text-[11px] font-semibold text-text-secondary">Suggestions</span>
          {currentSite && (
            <button type="button" onClick={() => prefill('current_site', currentSite, 'Current site')} className={CHIP}>
              Current site · {displayHost(currentSite) ?? currentSite}
            </button>
          )}
          {competitorChips.map((c) => (
            <button key={c.name} type="button" onClick={() => prefill('competitor_url', '', c.name)} className={CHIP}>
              Competitor · {c.name}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={addUrl} className="grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)]">
        <label className="sr-only" htmlFor="design-input-kind">Kind</label>
        <select
          id="design-input-kind"
          value={kind}
          onChange={(e) => {
            const next = parseUrlInputKind(e.target.value)
            if (next) setKind(next)
          }}
          className={FIELD}
        >
          {URL_INPUT_KINDS.map((k) => (
            <option key={k} value={k}>
              {INPUT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="design-input-url">Website address</label>
        <input
          id="design-input-url"
          ref={urlRef}
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={kind === 'competitor_url' && label ? `${label} website, e.g. https://example.com` : 'https://example.com'}
          className={FIELD}
        />
        <label className="sr-only" htmlFor="design-input-label">Label</label>
        <input
          id="design-input-label"
          type="text"
          value={label}
          maxLength={INPUT_LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className={FIELD}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={adding || !url.trim()} className={PRIMARY_BTN}>
            {adding ? 'Adding…' : 'Add URL'}
          </button>
          <span className="font-body text-[11px] text-text-muted">or</span>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={SECONDARY_BTN}>
            {uploading ? 'Uploading…' : 'Upload image'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="hidden"
            aria-label="Upload an inspiration image"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-error/10 px-3 py-1.5 font-body text-xs text-error">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="font-body text-xs italic text-text-muted">No inputs yet. Add the client’s current site, a competitor or two, and anything they admire.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((input) => (
            <li key={input.id}>
              <InputCard sessionId={sessionId} input={input} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 && (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className={LINK_BTN}>
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Create `components/design-studio/VersionsPanel.tsx`.**

```tsx
import type { BaselineStatus, DesignVersionDto, DriftResult } from '@/lib/design/studio-types'
import { PANEL } from './styles'

const SOURCE_LABELS: Record<DesignVersionDto['source'], string> = {
  baseline: 'Baseline',
  concept: 'Concept',
  chat: 'Chat revision',
  revert: 'Restore',
  import: 'Captured',
}

const FILE_LABELS: Record<string, string> = {
  'content/brand.json': 'brand.json (palette)',
  'content/design.json': 'design.json (fonts, tokens, treatments)',
  'src/styles/theme.css': 'theme.css',
  'content/design-overrides.css': 'design-overrides.css',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Theme versions (v0 = baseline import of the draft), with the drift banner
// and the stale-theme.css notice. Read-only in P2; restore arrives in P5.
export default function VersionsPanel({
  versions,
  drift,
  baseline,
  themeCssStale,
}: {
  versions: DesignVersionDto[]
  drift: DriftResult
  baseline: BaselineStatus
  themeCssStale: boolean | null
}) {
  return (
    <section aria-labelledby="design-versions-heading" className={PANEL}>
      <div>
        <h2 id="design-versions-heading" className="font-heading text-sm font-semibold text-text-primary">
          Versions
        </h2>
        <p className="font-body text-xs text-text-muted">Every design applied from the Studio becomes a version. v0 is the draft as it was when the Studio first opened.</p>
      </div>

      {baseline.status === 'error' && (
        <div role="alert" className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body text-xs text-error">
          <p className="font-heading font-semibold">Couldn’t import the current design as v0</p>
          <p className="mt-0.5">{baseline.error}</p>
          <p className="mt-1 text-text-secondary">Fix the draft theme files (Controls tab or the file editor), then Refresh.</p>
        </div>
      )}

      {drift.status === 'drifted' && (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 font-body text-xs text-warning-strong">
          <p className="font-heading font-semibold">Changed outside the Studio since v{drift.sinceVersion}</p>
          <ul className="mt-1 list-disc pl-4">
            {drift.changedPaths.map((p) => (
              <li key={p}>{FILE_LABELS[p] ?? p}</li>
            ))}
          </ul>
          <p className="mt-1">The draft no longer matches the latest version — for example after a Controls change or a hand edit.</p>
        </div>
      )}

      {themeCssStale === true && (
        <div role="status" className="rounded-lg border border-border-default bg-surface-subtle px-3 py-2 font-body text-xs text-text-secondary">
          <p className="font-heading font-semibold text-text-primary">theme.css is out of date</p>
          <p className="mt-0.5">
            The committed theme.css doesn’t match brand.json + design.json, so the live site may not show the saved palette. Any Controls change or
            Studio apply regenerates it.
          </p>
        </div>
      )}

      {versions.length === 0 ? (
        <p className="font-body text-xs italic text-text-muted">No versions yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {versions.map((v, i) => (
            <li key={v.id} className="rounded-lg border border-border-default px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="rounded-pill bg-brand-navy px-2 py-0.5 font-heading text-[11px] font-semibold text-text-inverse">v{v.versionNo}</span>
                <span className="min-w-0 truncate font-heading text-xs font-semibold text-text-primary">{v.name}</span>
                {i === 0 && (
                  <span className="rounded-pill bg-brand-cyan/10 px-2 py-0.5 font-heading text-[10px] font-semibold text-brand-navy">Latest</span>
                )}
              </div>
              <p className="mt-1 font-body text-[11px] text-text-muted">
                {SOURCE_LABELS[v.source]} · {formatWhen(v.createdAt)}
                {v.appliedCommitSha ? ` · ${v.appliedCommitSha.slice(0, 7)}` : ''}
              </p>
              {v.summary && <p className="mt-1 font-body text-xs text-text-secondary">{v.summary}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Create `components/design-studio/DesignStudio.tsx`.**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DesignStudioState } from '@/lib/design/studio-types'
import InputsPanel from './InputsPanel'
import VersionsPanel from './VersionsPanel'
import { designApi, errorMessage } from './api'
import { SECONDARY_BTN } from './styles'

// Admin-only Design Studio (Theme Studio → Studio tab). P2: collect design
// inputs and track theme versions (v0 baseline, drift, stale theme.css).
// Concept generation arrives in P3. All state comes from GET /design.
export default function DesignStudio({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<DesignStudioState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await designApi<DesignStudioState>(`/api/edit/${sessionId}/design`))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the Design Studio'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-subtle">
      <div className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-default px-6 py-2.5">
        <div className="min-w-0">
          <h1 className="font-heading text-sm font-semibold text-brand-navy">Design Studio</h1>
          <p className="font-body text-xs text-text-muted">
            Collect inspiration, competitors and the client’s current site, and track every theme version. Concept generation is coming next.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          disabled={loading}
          className={`shrink-0 ${SECONDARY_BTN}`}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" className="border-b border-error/20 bg-error/10 px-6 py-2 font-body text-xs text-error">
          {error}
        </div>
      )}

      {!state && loading ? (
        <div className="flex flex-1 items-center justify-center font-body text-sm text-text-muted">Loading the Design Studio…</div>
      ) : state ? (
        <div className="grid flex-1 items-start gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <InputsPanel sessionId={sessionId} inputs={state.inputs} suggestions={state.suggestions} onChanged={load} />
          <VersionsPanel versions={state.versions} drift={state.drift} baseline={state.baseline} themeCssStale={state.themeCssStale} />
        </div>
      ) : null}
    </div>
  )
}
```

If `npm run lint` reports the `react-hooks/set-state-in-effect` disable comment as unused, delete that comment line. If instead it reports the rule firing on a different line, move the comment there, as `ThemeStudio.tsx` does.

- [ ] **Step 8: Add the tabs to `components/editor/ThemeStudio.tsx`.** Make four exact edits (Controls content itself is untouched):
1. After `import ThemeChat from './ThemeChat'` add:
   ```ts
   import DesignStudio from '@/components/design-studio/DesignStudio'
   ```
2. Directly above `// Admin-only Theme Studio: a live 1:1 preview …` (the component's doc comment) add:
   ```ts
   type StudioTab = 'studio' | 'controls'
   const STUDIO_TABS: { key: StudioTab; label: string }[] = [
     { key: 'studio', label: 'Studio' },
     { key: 'controls', label: 'Controls' },
   ]

   ```
3. After `  const [contrastWarnings, setContrastWarnings] = useState<string[]>([])` add:
   ```ts
     // Controls (today's UI) stays the default; Studio is the Design Studio.
     const [tab, setTab] = useState<StudioTab>('controls')
   ```
4. Replace the opening of the returned JSX:
   ```tsx
     return (
       <div className="flex min-h-0 flex-1">
         <div className="flex min-w-0 flex-1 flex-col">
   ```
   with:
   ```tsx
     return (
       <div className="flex min-h-0 flex-1 flex-col">
         <div role="tablist" aria-label="Theme Studio mode" className="flex items-center gap-1 border-b border-border-default bg-surface-default px-6 py-1.5">
           {STUDIO_TABS.map((t) => (
             <button
               key={t.key}
               type="button"
               role="tab"
               id={`theme-tab-${t.key}`}
               aria-selected={tab === t.key}
               aria-controls={`theme-panel-${t.key}`}
               onClick={() => setTab(t.key)}
               className={[
                 'rounded-pill px-3.5 py-1 font-heading text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan',
                 tab === t.key ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle hover:text-brand-navy',
               ].join(' ')}
             >
               {t.label}
             </button>
           ))}
         </div>
         {tab === 'studio' && (
           <div id="theme-panel-studio" role="tabpanel" aria-labelledby="theme-tab-studio" className="flex min-h-0 flex-1">
             <DesignStudio sessionId={sessionId} />
           </div>
         )}
         {/* Controls stays mounted while hidden so the preview and ThemeChat keep their state. */}
         <div
           id="theme-panel-controls"
           role="tabpanel"
           aria-labelledby="theme-tab-controls"
           hidden={tab !== 'controls'}
           className={tab === 'controls' ? 'flex min-h-0 flex-1' : 'hidden'}
         >
         <div className="flex min-w-0 flex-1 flex-col">
   ```
   and replace the end of the file:
   ```tsx
           />
         </div>
       </div>
     )
   }
   ```
   with:
   ```tsx
           />
         </div>
         </div>
       </div>
     )
   }
   ```
   (The wrapped Controls block keeps its old indentation. That is intentional, to keep the diff minimal.)

- [ ] **Step 9: Run the checks.**
Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: tsc clean; lint with no errors; build exits 0.

- [ ] **Step 10: Run the design Component Checklist** (`raw-docs/design.md`, bottom) against the seven new files and the tab bar, and fix anything that fails:
- no hex in JSX;
- only `font-heading` / `font-body`;
- every button `rounded-pill` and brand-coloured (grey = disabled only);
- `shadow-subtle` only;
- hover and focus states on every interactive element;
- left-aligned text;
- no inline `style`.
Then confirm with a grep:
Run: `grep -nE "#[0-9a-fA-F]{3,6}\b|style=\{|localStorage|sessionStorage|window\.confirm|text-(red|amber|green|blue|gray)-" components/design-studio/*.ts* || echo clean`
Expected: `clean`.

- [ ] **Step 11: Commit.** Run the three greps first. Then:

```bash
git add components/design-studio/api.ts components/design-studio/styles.ts components/design-studio/InlineConfirm.tsx components/design-studio/InputCard.tsx components/design-studio/InputsPanel.tsx components/design-studio/VersionsPanel.tsx components/design-studio/DesignStudio.tsx components/editor/ThemeStudio.tsx
git commit -m "feat(design-studio): Studio | Controls tabs with Inputs and Versions panels (drift + stale theme.css notices)"
```

---

### Task 11: Final verification (controller, with the user for the manual check)

- [ ] **Step 1: Full automated verification.**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app
grep -r "GITHUB_APP_PRIVATE_KEY" ./app
grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx"
```

Expected: all tests pass (previous count + the new P2 tests); tsc clean; lint with no errors; build exits 0; the three greps print nothing.

- [ ] **Step 2: Confirm migration 078 is applied** (Task 1 Step 10's read-only node check prints five `ok` lines). If not, stop and ask the user.

- [ ] **Step 3: Start the dev server.** Run `npm run dev` in the background. `.env.local` points at the production Supabase project, so the steps below create REAL rows for bblcpa: v0 (kept intentionally) plus the test inputs (deleted in step 10). Nothing is published.

- [ ] **Step 4: Pre-check drift safety.** Ask the user to sign in at `http://localhost:3000` in the shared Chrome tab. Open `http://localhost:3000/admin/content/7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184/edit` → **Review changes**. Note whether `content/brand.json` or `src/styles/theme.css` already have unpublished changes. This decides the revert route in step 9.

- [ ] **Step 5: Studio loads + baseline v0.** Open **Theme & styling** → the **Studio** tab. Expect:
  - the Versions panel shows **v0 "Baseline"**, with source "Baseline" and Latest;
  - no drift banner;
  - a "theme.css is out of date" notice only if bblcpa's theme.css really is stale;
  - Suggestions show "Current site · …" and any MBP competitor names.
  Refresh: still exactly one v0 (the lazy create is idempotent). If the panel instead shows "Couldn't import the current design as v0", record the message; it is a valid outcome (malformed markers or an uncurated font) and must not break the page.

- [ ] **Step 6: Competitor URL + capture.** Click a competitor chip (or choose "Competitor"), type a real competitor URL, and click **Add URL**. The card appears as "Not captured yet". Click **Capture** and wait up to about a minute (`SCRAPINGBEE_API_KEY` is set locally). Expect a thumbnail. Then **Re-capture**: the thumbnail refreshes, and only ONE object remains under `design/7ce3c00a-…/inputs/` for that input. Check in the Supabase Storage browser, or ask the user to.

- [ ] **Step 7: Upload an inspiration image.** Click **Upload image** with a PNG/JPEG under 8 MB. A card of kind "Inspiration image" appears with its thumbnail and no Capture button. Also try a `.txt` renamed to `.png`: expect "Upload a PNG, JPEG or WebP image."

- [ ] **Step 8: Drift banner.** Switch to **Controls** and note the current **Primary** hex (write it down). Pick a slightly different Primary and wait for the save. Switch back to **Studio** (it refetches). Expect the banner **"Changed outside the Studio since v0"**, listing brand.json (palette) and theme.css.

- [ ] **Step 9: Revert the drift test.**
  - **If step 4 showed no prior unpublished changes to those files:** open **Review changes** → **Undo** on `content/brand.json` and `src/styles/theme.css`. The browser confirm appears; ask the user to accept it. This restores the live versions.
  - **Otherwise:** in **Controls**, set Primary back to the hex from step 8.
  Then reopen **Studio**. The banner should clear, because the blob shas match v0 again. If it persists, the bytes differ only in serialization (for example key order or whitespace from the palette writer). Record this in the report; do NOT hand-edit files. Do NOT Publish.

- [ ] **Step 10: Clean up the inputs.** On each test input, click **Delete** → **Delete** (inline confirm, no browser dialog). The cards disappear, and their storage objects are removed. Archive/unarchive one before deleting it, to exercise PATCH.

- [ ] **Step 11: Report.** Summarise pass/fail for steps 1–10, the test count, and any residual drift from step 9. P2 is then ready for final review. The user decides when to merge.

---

## Out of scope for P2

- Brief, concept generation, runs/step/cancel/apply routes and their UI (P3). The runs/concepts tables and sweep exist now.
- Critique loop (P4).
- Revision chat, attachments, version **restore/import** and the drift banner's **"Capture as version"** action (P5). P2's banner is informational.
- Writing `applied_blobs` for non-baseline versions (P3's apply must store the FULL four-file sha map; see the Global Constraints).
- CLAUDE.md updates (Design Studio rules and the `design/` storage prefix are deferred to P7; the user has uncommitted CLAUDE.md edits).
- Regenerating `types/database.ts` (the user does it with a Supabase token).
