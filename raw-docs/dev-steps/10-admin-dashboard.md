# Step 10 — Admin Dashboard

**Depends on:** Steps 03, 05, 06, 09
**Unlocks:** Steps 12, 13 (Approve button triggers Basecamp and PDF)
**Estimated time:** Day 13–15

---

## What This Step Accomplishes

Admins can view all sessions, track phase progress, review the full collected schema, edit any field inline, and approve completed sessions. The Approve button triggers the downstream pipeline (PDF generation + Basecamp project creation) built in Steps 12 and 13.

---

## Implementation Tasks

### 1. Build the session list dashboard

`app/(admin)/dashboard/page.tsx`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, website_url, status, current_phase, last_activity_at, created_at, reminder_count')
    .order('last_activity_at', { ascending: true })  // Stale sessions at the top

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <Link href="/admin/dashboard/new-session" className="px-4 py-2 bg-black text-white rounded text-sm">
          + New Session
        </Link>
      </div>

      <div className="space-y-2">
        {/* Filter tabs */}
        {/* Session table — see below */}
      </div>
    </div>
  )
}
```

**Session table columns:**
- Client URL (first 20 chars of UUID, with copy button)
- Website URL
- Status badge (color-coded)
- Phase progress (e.g., "Phase 3 / 7")
- Last activity (relative time: "2 days ago")
- Days inactive
- Actions: View, Send Reminder

**Status badge colors:**
- `pending` → gray
- `in_progress` → blue
- `completed` → green
- `approved` → purple

### 2. Build the session detail page

`app/(admin)/sessions/[id]/page.tsx`:

Two-panel layout:
- **Left panel:** Chat transcript (read-only, full message history)
- **Right panel:** Schema data viewer with inline editing

```typescript
import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function SessionDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient()

  const [{ data: session }, { data: messages }, { data: assets }] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', params.id).single(),
    supabase.from('messages').select('*').eq('session_id', params.id).order('created_at'),
    supabase.from('assets').select('*').eq('session_id', params.id).order('uploaded_at'),
  ])

  if (!session) notFound()

  return (
    <div className="flex h-screen">
      {/* Left: Transcript */}
      <div className="w-1/2 border-r overflow-y-auto p-6">
        <h2 className="text-lg font-semibold mb-4">Chat Transcript</h2>
        {messages?.map(m => (
          <div key={m.id} className={`mb-3 ${m.role === 'user' ? 'text-right' : ''}`}>
            <span className={`inline-block px-3 py-2 rounded text-sm max-w-[80%] ${m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100'}`}>
              {m.content}
            </span>
          </div>
        ))}
      </div>

      {/* Right: Schema viewer + actions */}
      <div className="w-1/2 overflow-y-auto p-6">
        <StatusBanner session={session} />
        <SchemaViewer sessionId={params.id} schemaData={session.schema_data} />
        <AssetsViewer assets={assets ?? []} />
        {session.status === 'completed' && <ApproveButton sessionId={params.id} />}
      </div>
    </div>
  )
}
```

### 3. Build the SchemaViewer component

`components/admin/SchemaViewer.tsx` — shows all collected fields, organized by section. Each field is click-to-edit:

```typescript
'use client'
import { useState } from 'react'

type Props = { sessionId: string; schemaData: any }

export default function SchemaViewer({ sessionId, schemaData }: Props) {
  const sections = [
    { label: 'Contact', path: 'contact' },
    { label: 'Business', path: 'business' },
    { label: 'Locations', path: 'locations' },
    { label: 'Team', path: 'team' },
    { label: 'Services', path: 'services' },
    { label: 'Niches', path: 'niches' },
    { label: 'Technical', path: 'technical' },
    { label: 'Culture', path: 'culture' },
    { label: 'Assets', path: 'assets' },
    { label: 'Additional', path: 'additional' },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Collected Data</h2>
      {sections.map(s => (
        <SchemaSection
          key={s.path}
          label={s.label}
          data={schemaData?.[s.path]}
          sectionPath={s.path}
          sessionId={sessionId}
        />
      ))}
    </div>
  )
}
```

Each `SchemaSection` renders fields as `FieldRow` components with inline editing (click to edit, save on blur). On save, call:

### 4. Build the schema update API route

`app/api/sessions/[id]/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { fieldPath, value, isAdminOverride } = await req.json()
  const supabase = createServerClient()

  const { data: session } = await supabase.from('sessions').select('schema_data').eq('id', params.id).single()
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Deep merge the updated field
  const updatedSchema = deepSetPath(session.schema_data, fieldPath, value)

  // Track admin overrides
  if (isAdminOverride) {
    updatedSchema._meta = updatedSchema._meta ?? {}
    updatedSchema._meta.admin_overrides = updatedSchema._meta.admin_overrides ?? {}
    updatedSchema._meta.admin_overrides[fieldPath] = true
  }

  await supabase.from('sessions').update({ schema_data: updatedSchema }).eq('id', params.id)
  return NextResponse.json({ success: true })
}

function deepSetPath(obj: any, path: string, value: any): any {
  const keys = path.split('.')
  const result = { ...obj }
  let current = result
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = { ...(current[keys[i]] ?? {}) }
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
  return result
}
```

### 5. Build the Approve button

`components/admin/ApproveButton.tsx`:
```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ApproveButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleApprove() {
    if (!confirm('Approve this session? This will generate the PDF and create a Basecamp project.')) return
    setLoading(true)
    setError('')

    const res = await fetch(`/api/sessions/${sessionId}/approve`, { method: 'POST' })
    const data = await res.json()

    if (data.error) {
      setError(data.error)
      setLoading(false)
      return
    }

    router.refresh()
  }

  return (
    <div className="mt-6">
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <button
        onClick={handleApprove}
        disabled={loading}
        className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium disabled:opacity-50"
      >
        {loading ? 'Approving...' : '✓ Approve Session'}
      </button>
    </div>
  )
}
```

`app/api/sessions/[id]/approve/route.ts` — stub for now (full implementation in Steps 12–13):
```typescript
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // 1. Generate PDF (Step 13)
  // 2. Create Basecamp project (Step 12)
  // 3. Mark session as approved
  return Response.json({ success: true })
}
```

### 6. Build the manual Send Reminder button

Add to the session detail page, calling `POST /api/sessions/[id]/remind`. The endpoint sends a one-off email regardless of the inactivity timer and inserts a reminder row.

---

## Test Process

### T1 — Dashboard shows all sessions, sorted by last activity
Create 3 test sessions with different `last_activity_at` values.
Expected: Sessions listed with stale ones at the top.

### T2 — Status badges show correct colors
Create sessions with each status (pending, in_progress, completed, approved).
Expected: Correct color per status.

### T3 — Session detail shows full transcript
Open a session that has completed at least Phase 1.
Expected: All user and assistant messages visible in the left panel, in chronological order.

### T4 — Schema viewer shows collected data organized by section
Open a session that has completed Phase 3.
Expected: Business name, locations, team members, etc. shown in the right panel.

### T5 — Inline edit saves to database
In the schema viewer, click on a field (e.g., `business.foundingYear`), type a new value, and blur.
```sql
SELECT schema_data->'business'->>'foundingYear' FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: New value saved.

### T6 — Admin override is tracked in _meta
After editing a field as admin:
```sql
SELECT schema_data->'_meta'->'admin_overrides' FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: The edited field path appears with `true`.

### T7 — Approve button only visible for completed sessions
Open a session with `status = 'in_progress'`.
Expected: No Approve button.
Open one with `status = 'completed'`.
Expected: Approve button visible.

### T8 — Approve button disabled while processing
Click Approve, verify button is immediately disabled/spinner shown. After completion, page refreshes and shows approved status.

---

## Common Failure Points

- **Admin override tracking** — without `_meta.admin_overrides`, you lose the audit trail of what the admin changed vs. what the client said. Always track it.
- **Approve button double-tap** — add the `confirm()` dialog as a first gate, then disable immediately on click. Also check server-side that `basecamp_project_id` is null before creating a new project (prevents duplicates).
- **Large schema in the viewer** — for clients with many team members or services, the schema viewer can get unwieldy. Use collapsible section headers.
- **Transcript ordering** — always order by `created_at ASC`. If messages don't have the right timestamps, the transcript will be scrambled.
