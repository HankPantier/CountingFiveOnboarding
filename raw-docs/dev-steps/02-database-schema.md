# Step 02 — Database Schema & Migrations

**Depends on:** Step 01 (Supabase project connected)
**Unlocks:** Steps 03–14
**Estimated time:** Day 1–2

---

## What This Step Accomplishes

All Supabase tables created with correct column types, indexes, and Row Level Security policies. TypeScript types generated from the live schema. This is the data layer that every other step depends on — get it right before building anything else.

---

## Implementation Tasks

### 1. Run table migrations in Supabase SQL Editor

Go to Supabase → SQL Editor and run each block below. Run them in order.

#### Admins table
```sql
CREATE TABLE admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Sessions table
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'approved')),
  current_phase INTEGER NOT NULL DEFAULT 0 CHECK (current_phase BETWEEN 0 AND 7),
  schema_data JSONB NOT NULL DEFAULT '{}',
  gap_list JSONB NOT NULL DEFAULT '[]',
  mfp_content TEXT,
  client_email TEXT,
  processing BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES admins(id),
  basecamp_project_id TEXT,
  pdf_url TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  content_generation_ready BOOLEAN NOT NULL DEFAULT FALSE
);
```

#### Messages table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Assets table
```sql
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  asset_category TEXT CHECK (asset_category IN ('logo', 'headshot', 'photo', 'other')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Reminders table
```sql
CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  days_inactive INTEGER NOT NULL
);
```

#### Basecamp tokens table (singleton row)
```sql
CREATE TABLE basecamp_tokens (
  id INTEGER PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);
```

---

### 2. Create indexes

```sql
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_assets_session_id ON assets(session_id);
CREATE INDEX idx_reminders_session_id ON reminders(session_id);
```

---

### 3. Enable Row Level Security

```sql
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE basecamp_tokens ENABLE ROW LEVEL SECURITY;
```

---

### 4. Create RLS policies

```sql
-- Admins can only manage their own record
CREATE POLICY "Admins manage own record"
  ON admins FOR ALL
  USING (auth.uid() = id);

-- Authenticated admins have full access to all other tables
CREATE POLICY "Admins full access to sessions"
  ON sessions FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to messages"
  ON messages FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to assets"
  ON assets FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to reminders"
  ON reminders FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to basecamp tokens"
  ON basecamp_tokens FOR ALL TO authenticated USING (true);
```

> **Note:** Client-facing reads (session and message data for the chat UI) go through server-side API routes using the service role key, which bypasses RLS entirely. No public/anon policies are needed for those tables.

---

### 5. Create Supabase Storage bucket

In Supabase → Storage → New Bucket:
- **Name:** `session-assets`
- **Public:** No (all access via signed URLs or server-side)
- **Max file size:** 300 MB
- **Allowed MIME types:** `image/jpeg, image/png, image/gif, image/tiff, application/pdf`

---

### 6. Generate TypeScript types

Install Supabase CLI if not already installed:
```bash
npm install -g supabase
```

Generate types:
```bash
# Get your project ID from Supabase → Settings → General
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.ts
```

Commit `types/database.ts`. Regenerate any time the schema changes. Never edit this file manually.

---

### 7. Create the session schema type

Create `types/session-schema.ts` — this is the TypeScript type for the `schema_data` JSONB column. It is the single source of truth for what the agent collects:

```typescript
export type SessionSchema = {
  _meta?: {
    phase3_completed_chunks: string[];
    phase4_resolved_tiers: { tier1_done: boolean; tier2_done: boolean };
    phase4_flagged_for_followup: string[];
    admin_overrides: Record<string, boolean>;
  };
  contact?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  websiteUrl?: string;
  technical?: {
    registrar: string;
    registrationDate: string;
    expiryDate: string;
    nameservers: string[];
    registrarUsername: string;
    registrarPin: string;
    registrarPasswordNote: string;
    adminContact: { name: string; phone: string; email: string };
    hostingProvider: string;
    hostingContact: string;
    hostingPhone: string;
    hostingEmail: string;
    redirectDomains: string[];
    googleBusinessProfileUrl: string;
  };
  locations?: Array<{
    name: string;
    street: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    fax: string;
    email: string;
    hours: Record<string, string>;
  }>;
  team?: Array<{
    name: string;
    title: string;
    certifications: string[];
    bio: string;
    specializations: string[];
  }>;
  services?: Array<{
    name: string;
    description: string;
    offerings: string[];
  }>;
  niches?: Array<{
    name: string;
    description: string;
    icp: string;
  }>;
  business?: {
    name: string;
    tagline: string;
    positioningOption: string;
    positioningStatement: string;
    foundingYear: string;
    firmHistory: string;
    idealClients: string[];
    geographicScope: string;
    clientAgeRanges: string[];
    customerNeeds: string;
    customerDescription: string;
    differentiators: string;
    affiliations: string[];
    clientSuccessStories: string[];
    clientMixBreakdown: string;
    howClientsFind: string;
  };
  culture?: {
    missionVisionValues: string;
    teamDescription: string;
    socialMediaChannels: string[];
  };
  assets?: {
    headshotsAvailable: string[];
    officePhotosAvailable: boolean;
    testimonialsAvailable: string[];
    logosUploaded: string[];
    photosUploaded: string[];
  };
  additional?: {
    otherDetails: string;
    uploadedFiles: string[];
  };
};
```

---

## Test Process

### T1 — All tables exist
In Supabase → Table Editor, verify all 6 tables appear: `admins`, `sessions`, `messages`, `assets`, `reminders`, `basecamp_tokens`.

### T2 — Column types are correct
Run in SQL Editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'sessions'
ORDER BY ordinal_position;
```
Verify `schema_data` is `jsonb`, `status` is `text`, `processing` is `boolean`, `current_phase` is `integer`.

### T3 — RLS is enabled
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```
All 6 tables should show `rowsecurity = true`.

### T4 — Status constraint works
```sql
-- Should succeed
INSERT INTO sessions (website_url, status) VALUES ('https://test.com', 'pending');

-- Should fail with constraint error
INSERT INTO sessions (website_url, status) VALUES ('https://test.com', 'invalid_status');
```

### T5 — Phase constraint works
```sql
-- Should fail (phase 8 out of range)
INSERT INTO sessions (website_url, current_phase) VALUES ('https://test.com', 8);
```

### T6 — Indexes exist
```sql
SELECT indexname FROM pg_indexes WHERE tablename IN ('sessions', 'messages', 'assets', 'reminders');
```
Expected: `idx_sessions_status`, `idx_sessions_last_activity`, `idx_messages_session_id`, `idx_assets_session_id`, `idx_reminders_session_id`.

### T7 — TypeScript types compile
```bash
npx tsc --noEmit
```
Expected: No errors related to `types/database.ts` or `types/session-schema.ts`.

### T8 — Storage bucket exists
In Supabase → Storage, confirm `session-assets` bucket exists and is set to private.

---

## Common Failure Points

- **Forgetting to regenerate types after schema changes** — make it a habit: any time you run a migration, immediately run `npx supabase gen types typescript` again.
- **JSONB vs TEXT for schema_data** — JSONB allows indexed querying and operator support. Do not change to TEXT.
- **Service role key bypasses RLS** — this is intentional for client-facing routes, but must only exist in server-side code. Run the grep from Step 01 after this step too.
- **Basecamp tokens singleton** — the `CONSTRAINT singleton CHECK (id = 1)` means only one row can ever exist. This is by design; OAuth tokens are rotated in-place on this single row.
