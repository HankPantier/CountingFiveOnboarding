# Step 02 — Database Schema for Content Generation

Add the tables and columns needed to track content generation jobs, phase state, palette data, outlines, and generated pages.

---

## What We're Building

Four new tables and one new column on `sessions`. All new tables use `gen_random_uuid()` primary keys per the existing security rules. Row Level Security enabled on all new tables.

---

## New Column on `sessions`

```sql
ALTER TABLE sessions
  ADD COLUMN content_generation_phase integer DEFAULT NULL,
  ADD COLUMN content_generation_started_at timestamptz DEFAULT NULL;
```

`content_generation_phase` values:
- `NULL` — not started
- `1` — Palette (in progress or complete)
- `2` — Sitemap Confirm
- `3` — Research
- `4` — Outline Review
- `5` — Generating
- `6` — Complete

---

## New Tables

### `content_jobs`
Tracks the overall content generation job for a session.

```sql
CREATE TABLE content_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  phase integer NOT NULL DEFAULT 1,
  palette jsonb DEFAULT NULL,           -- locked palette object
  confirmed_sitemap jsonb DEFAULT NULL, -- admin-confirmed page list
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete', 'error')),
  error_message text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX content_jobs_session_id_idx ON content_jobs(session_id);
```

### `research_results`
Stores per-page research output from Phase 3.

```sql
CREATE TABLE research_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  page_url text NOT NULL,               -- e.g. /services/virtual-cfo-advisory
  page_title text NOT NULL,
  target_keyword text DEFAULT NULL,
  secondary_keywords jsonb DEFAULT '[]',
  competitor_references jsonb DEFAULT '[]',  -- array of {url, title, excerpt}
  existing_content text DEFAULT NULL,   -- fetched from current site
  research_status text NOT NULL DEFAULT 'pending'
    CHECK (research_status IN ('pending', 'running', 'complete', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `page_outlines`
Stores Claude-generated outlines pending admin approval.

```sql
CREATE TABLE page_outlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  page_url text NOT NULL,
  page_title text NOT NULL,
  h1 text DEFAULT NULL,
  sections jsonb DEFAULT '[]',   -- array of {h2, description, word_count}
  target_keyword text DEFAULT NULL,
  admin_approved boolean NOT NULL DEFAULT false,
  admin_notes text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `generated_pages`
Stores final generated copy and metadata per page.

```sql
CREATE TABLE generated_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  page_url text NOT NULL,
  page_title text NOT NULL,
  content_markdown text DEFAULT NULL,         -- full page copy
  meta_title text DEFAULT NULL,
  meta_description text DEFAULT NULL,
  target_keyword text DEFAULT NULL,
  secondary_keywords jsonb DEFAULT '[]',
  answer_block text DEFAULT NULL,             -- AI Overview optimized answer
  schema_markup_type text DEFAULT NULL,       -- e.g. LocalBusiness, Service
  eeat_signals jsonb DEFAULT '[]',            -- array of signal strings
  internal_links jsonb DEFAULT '[]',          -- array of {url, anchor_text, reason}
  faq_block jsonb DEFAULT '[]',               -- array of {question, answer}
  llm_citation_note text DEFAULT NULL,
  url_slug text DEFAULT NULL,
  canonical_url text DEFAULT NULL,
  generation_status text NOT NULL DEFAULT 'pending'
    CHECK (generation_status IN ('pending', 'running', 'complete', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## Migration File

Create `supabase/002_content_generation.sql` with all of the above.

Apply via Supabase SQL Editor or CLI:
```bash
npx supabase db push
```

Regenerate types after applying:
```bash
npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts
```

---

## Test Process

1. Apply migration in Supabase SQL Editor
2. Confirm all four new tables appear in the Table Editor
3. Regenerate `types/database.ts` and run `npx tsc --noEmit` — zero errors expected
4. Insert a test `content_jobs` row for an existing approved session, verify cascade delete works by deleting the row
