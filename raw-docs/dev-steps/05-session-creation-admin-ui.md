# Step 05 — Session Creation & Admin Upload UI

**Depends on:** Steps 02, 03, 04
**Unlocks:** Steps 06, 08
**Estimated time:** Day 3–4

---

## What This Step Accomplishes

Admin can upload an MFP `.md` file through the dashboard. The system parses it, previews the extracted data, creates a session in Supabase, and displays a unique client URL that can be shared with the client. This is the starting point for every client onboarding.

---

## Implementation Tasks

### 1. Build the new session page

`app/(admin)/dashboard/new-session/page.tsx`:

This is a multi-step form:
1. URL input field (pre-fills from parsed MFP, editable)
2. MFP file input (`.md` files only)
3. "Parse" button — parses and shows a preview
4. Preview panel — shows extracted business name, team count, services count, gap count
5. "Create Session" button — creates the session and shows the client URL

```typescript
'use client'
import { useState } from 'react'

type ParseResult = {
  websiteUrl: string
  businessName: string
  teamCount: number
  servicesCount: number
  gapCount: number
  schemaData: object
  gapList: object[]
  rawContent: string
}

export default function NewSessionPage() {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [clientUrl, setClientUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleParse() {
    if (!file) return
    const text = await file.text()
    const res = await fetch('/api/sessions/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfpContent: text }),
    })
    const data = await res.json()
    setParsed(data)
  }

  async function handleCreate() {
    if (!parsed) return
    setLoading(true)
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteUrl: parsed.websiteUrl,
        mfpContent: parsed.rawContent,
        schemaData: parsed.schemaData,
        gapList: parsed.gapList,
      }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }
    setClientUrl(`${process.env.NEXT_PUBLIC_APP_URL}/session/${data.sessionId}`)
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">New Client Session</h1>

      {!clientUrl ? (
        <>
          <input type="file" accept=".md" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {file && <button onClick={handleParse} className="mt-2 px-4 py-2 bg-black text-white rounded">Parse MFP</button>}

          {parsed && (
            <div className="mt-6 p-4 border rounded space-y-2">
              <p><strong>Firm:</strong> {parsed.businessName}</p>
              <p><strong>URL:</strong> {parsed.websiteUrl}</p>
              <p><strong>Team members:</strong> {parsed.teamCount}</p>
              <p><strong>Services:</strong> {parsed.servicesCount}</p>
              <p><strong>Gap items:</strong> {parsed.gapCount}</p>
              {error && <p className="text-red-600">{error}</p>}
              <button onClick={handleCreate} disabled={loading} className="px-4 py-2 bg-green-600 text-white rounded">
                {loading ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 p-4 border rounded bg-green-50">
          <p className="font-medium">Session created! Share this link with the client:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="text-sm bg-white border rounded px-2 py-1 flex-1">{clientUrl}</code>
            <button onClick={() => navigator.clipboard.writeText(clientUrl)} className="px-3 py-1 bg-black text-white rounded text-sm">Copy</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

### 2. Build the parse API route

`app/api/sessions/parse/route.ts`:
```typescript
import { parseMFP } from '@/lib/mfp-parser'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { mfpContent } = await req.json()
  if (!mfpContent) return NextResponse.json({ error: 'No content' }, { status: 400 })

  const { schema, gaps } = parseMFP(mfpContent)

  return NextResponse.json({
    websiteUrl: schema.websiteUrl ?? '',
    businessName: schema.business?.name ?? 'Unknown',
    teamCount: schema.team?.length ?? 0,
    servicesCount: schema.services?.length ?? 0,
    gapCount: gaps.length,
    schemaData: schema,
    gapList: gaps,
    rawContent: mfpContent,
  })
}
```

### 3. Build the session creation API route

`app/api/sessions/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { websiteUrl, mfpContent, schemaData, gapList } = await req.json()

  if (!websiteUrl) return NextResponse.json({ error: 'websiteUrl required' }, { status: 400 })

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      website_url: websiteUrl,
      mfp_content: mfpContent,
      schema_data: schemaData,
      gap_list: gapList,
      status: 'pending',
      current_phase: 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[POST /api/sessions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sessionId: data.id })
}
```

### 4. Add "New Session" link to dashboard

In `app/(admin)/dashboard/page.tsx`, add a link to `/admin/dashboard/new-session`.

---

## Test Process

### T1 — Parse route returns correct data from the Korbey Lague MFP
```bash
curl -X POST http://localhost:3000/api/sessions/parse \
  -H "Content-Type: application/json" \
  -d "{\"mfpContent\": \"$(cat raw-docs/mfp-korbeylague-com-2026-04-24.md | sed 's/"/\\"/g' | tr -d '\n')\"}"
```
Expected: JSON with non-empty `businessName`, `websiteUrl`, `teamCount > 0`, `gapCount > 0`.

### T2 — Session creation inserts a row in Supabase
After clicking "Create Session" in the UI, run in Supabase SQL Editor:
```sql
SELECT id, website_url, status, current_phase, created_at
FROM sessions
ORDER BY created_at DESC
LIMIT 1;
```
Expected: Row exists with `status = 'pending'`, `current_phase = 0`.

### T3 — schema_data is correctly populated in the new session
```sql
SELECT schema_data->>'websiteUrl' as url,
       jsonb_array_length(schema_data->'team') as team_count
FROM sessions
ORDER BY created_at DESC
LIMIT 1;
```
Expected: URL is correct, team_count matches what the parser returned.

### T4 — gap_list is stored as a JSONB array
```sql
SELECT jsonb_array_length(gap_list) as gap_count
FROM sessions
ORDER BY created_at DESC
LIMIT 1;
```
Expected: Count matches what the parse preview showed.

### T5 — Client URL format is correct
After session creation, verify the displayed URL matches:
`https://onboard.countingfive.com/session/{uuid}`
Open the URL — it will 404 until Step 06 is complete, but it should not crash with a server error.

### T6 — Parse route rejects empty content
```bash
curl -X POST http://localhost:3000/api/sessions/parse \
  -H "Content-Type: application/json" \
  -d '{"mfpContent": ""}'
```
Expected: 400 response with `{ "error": "No content" }`.

### T7 — Session creation route rejects missing websiteUrl
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"mfpContent": "test"}'
```
Expected: 400 with `{ "error": "websiteUrl required" }`.

---

## Common Failure Points

- **MFP format changes** — the parser is the most brittle component. Edge cases (extra whitespace, slightly different heading text) will break it. Always test with the real Korbey Lague MFP file.
- **Large MFP files** — store `mfp_content` in the DB. If the parser produces wrong output in production, you can debug by re-running against the stored content.
- **UUID collision** — `gen_random_uuid()` is cryptographically random UUID v4. Collisions are negligible. Do not add a retry loop.
- **Admin auth on API routes** — the parse and create routes should verify the caller is an authenticated admin (check Supabase session). Without this, anyone can create sessions via direct API calls.
