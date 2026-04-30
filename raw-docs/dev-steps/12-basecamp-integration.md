# Step 12 — Basecamp Integration

**Depends on:** Steps 02, 10 (Admin Dashboard Approve button)
**Unlocks:** Step 14 (Testing)
**Credentials needed:** `BASECAMP_CLIENT_ID`, `BASECAMP_CLIENT_SECRET`, `BASECAMP_ACCOUNT_ID`
**Estimated time:** Day 17–18

---

## What This Step Accomplishes

When an admin approves a completed session, the system automatically creates a Basecamp project, posts the full intake summary as a rich-text message, attaches the PDF (generated in Step 13), uploads all client assets to the project vault, and marks the session as approved. This is the final handoff from onboarding to the build team.

---

## Pre-Requisites

1. Register a Basecamp OAuth app at `launchpad.37signals.com/integrations`:
   - **Name:** CountingFive Onboarding
   - **Redirect URI:** `https://onboard.countingfive.com/api/basecamp/callback`
   - Note the Client ID and Client Secret
2. Add to `.env.local` and Vercel:
   ```env
   BASECAMP_CLIENT_ID=your_client_id
   BASECAMP_CLIENT_SECRET=your_client_secret
   BASECAMP_ACCOUNT_ID=your_account_id  # from your Basecamp URL: 3.basecamp.com/{ACCOUNT_ID}
   ```

---

## Implementation Tasks

### 1. Build the OAuth authorization route

`app/api/basecamp/auth/route.ts`:
```typescript
import { NextResponse } from 'next/server'

export async function GET() {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: process.env.BASECAMP_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
  })

  return NextResponse.redirect(
    `https://launchpad.37signals.com/authorization/new?${params.toString()}`
  )
}
```

### 2. Build the OAuth callback route

`app/api/basecamp/callback/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')

  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  // Exchange code for tokens
  const res = await fetch('https://launchpad.37signals.com/authorization/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      type: 'web_server',
      client_id: process.env.BASECAMP_CLIENT_ID!,
      client_secret: process.env.BASECAMP_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
      code,
    }),
  })

  const tokens = await res.json()
  if (!tokens.access_token) return NextResponse.json({ error: 'Token exchange failed', tokens }, { status: 500 })

  const supabase = createServerClient()

  // Store tokens (upsert singleton row)
  await supabase.from('basecamp_tokens').upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin/dashboard?basecamp=connected`)
}
```

### 3. Add "Connect Basecamp" button to admin dashboard

Add to the dashboard header (only show if not yet connected):
```typescript
<a href="/api/basecamp/auth" className="px-4 py-2 bg-yellow-500 text-white rounded text-sm">
  Connect Basecamp
</a>
```

After successful OAuth, redirect back to dashboard with `?basecamp=connected` — show a success banner.

### 4. Build the Basecamp API client with auto token refresh

`lib/basecamp/client.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'

const BC_BASE = `https://3.basecampapi.com/${process.env.BASECAMP_ACCOUNT_ID}`
const USER_AGENT = 'CountingFive Onboarding (webhank@gmail.com)'

async function getValidToken(): Promise<string> {
  const supabase = createServerClient()
  const { data: tokenRow } = await supabase
    .from('basecamp_tokens')
    .select('*')
    .eq('id', 1)
    .single()

  if (!tokenRow) throw new Error('Basecamp not connected — complete OAuth first')

  // Refresh if expired (or within 5 minutes of expiry)
  const expiresAt = new Date(tokenRow.expires_at)
  const bufferMs = 5 * 60 * 1000
  if (expiresAt.getTime() - Date.now() < bufferMs) {
    const res = await fetch('https://launchpad.37signals.com/authorization/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        type: 'refresh',
        refresh_token: tokenRow.refresh_token,
        client_id: process.env.BASECAMP_CLIENT_ID!,
        client_secret: process.env.BASECAMP_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
      }),
    })
    const refreshed = await res.json()
    if (!refreshed.access_token) throw new Error('Token refresh failed')

    await supabase.from('basecamp_tokens').update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', 1)

    return refreshed.access_token
  }

  return tokenRow.access_token
}

export async function basecampFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getValidToken()
  const res = await fetch(`${BC_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      ...(options.headers ?? {}),
    },
  })

  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise(r => setTimeout(r, 10000))
    return basecampFetch(path, options)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Basecamp API error ${res.status}: ${body}`)
  }

  return res.status === 204 ? null : res.json()
}
```

### 5. Build the project creation sequence

`lib/basecamp/create-project.ts`:
```typescript
import { basecampFetch } from './client'
import { createServerClient } from '@/lib/supabase/server'

export async function createBasecampProject(session: any, pdfUrl: string | null): Promise<string> {
  const firmName = session.schema_data?.business?.name ?? session.website_url
  const projectName = `${firmName} — Website Build`

  // 1. Create the project
  const project = await basecampFetch('/projects.json', {
    method: 'POST',
    body: JSON.stringify({ name: projectName, description: 'Website build project — intake completed via onboarding agent.' }),
  })

  const projectId = project.id
  const supabase = createServerClient()

  // 2. Get the message board dock
  const projectDetail = await basecampFetch(`/projects/${projectId}.json`)
  const messageDock = projectDetail.dock.find((d: any) => d.name === 'message_board')
  const messageBoardId = messageDock.id

  // 3. Build the intake summary HTML
  const summaryHtml = buildIntakeSummaryHtml(session.schema_data)

  // 4. Post the message (plain text first — will be updated with attachments)
  const message = await basecampFetch(`/buckets/${projectId}/message_boards/${messageBoardId}/messages.json`, {
    method: 'POST',
    body: JSON.stringify({
      subject: `Intake Summary — ${firmName}`,
      content: summaryHtml,
      status: 'active',
    }),
  })

  // 5. Upload assets and collect sgids
  const assets = await supabase.from('assets').select('*').eq('session_id', session.id)
  const attachmentSgids: string[] = []

  for (const asset of (assets.data ?? [])) {
    await new Promise(r => setTimeout(r, 200))  // Rate limit: 200ms between uploads
    try {
      const sgid = await uploadAssetToBasecamp(projectId, asset)
      attachmentSgids.push(sgid)
    } catch (err) {
      console.error(`[Basecamp] Failed to upload asset ${asset.file_name}:`, err)
    }
  }

  // 6. Upload PDF if available
  if (pdfUrl) {
    try {
      const pdfSgid = await uploadPdfToBasecamp(projectId, session.id, pdfUrl)
      attachmentSgids.unshift(pdfSgid)  // PDF first
    } catch (err) {
      console.error('[Basecamp] Failed to upload PDF:', err)
    }
  }

  // 7. Update message with attachment tags
  if (attachmentSgids.length > 0) {
    const attachmentTags = attachmentSgids.map(sgid => `<bc-attachment sgid="${sgid}"></bc-attachment>`).join('\n')
    await basecampFetch(`/buckets/${projectId}/messages/${message.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        subject: message.subject,
        content: summaryHtml + '\n\n' + attachmentTags,
      }),
    })
  }

  return String(projectId)
}

async function uploadAssetToBasecamp(projectId: number, asset: any): Promise<string> {
  // Fetch file from Supabase Storage
  const supabase = createServerClient()
  const { data: fileData } = await supabase.storage.from('session-assets').download(asset.storage_path)
  if (!fileData) throw new Error(`Could not download ${asset.file_name}`)

  const buffer = await fileData.arrayBuffer()

  // Upload to Basecamp attachments
  const attachment = await basecampFetch('/attachments.json', {
    method: 'POST',
    headers: { 'Content-Type': asset.mime_type, 'Content-Length': String(buffer.byteLength) },
    body: buffer,
  })

  return attachment.attachable_sgid
}

async function uploadPdfToBasecamp(projectId: number, sessionId: string, pdfUrl: string): Promise<string> {
  const supabase = createServerClient()
  const { data: fileData } = await supabase.storage.from('session-assets').download(`pdfs/${sessionId}/intake-summary.pdf`)
  if (!fileData) throw new Error('PDF not found in storage')

  const buffer = await fileData.arrayBuffer()

  const attachment = await basecampFetch('/attachments.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.byteLength) },
    body: buffer,
  })

  return attachment.attachable_sgid
}

function buildIntakeSummaryHtml(schema: any): string {
  const s = schema ?? {}
  return `
<h1>Website Intake Summary — ${s.business?.name ?? 'Unknown Firm'}</h1>

<h2>Contact</h2>
<p>${s.contact?.firstName} ${s.contact?.lastName}<br>
${s.contact?.email}<br>
${s.contact?.phone}</p>

<h2>Business</h2>
<p><strong>Website:</strong> ${s.websiteUrl}<br>
<strong>Founded:</strong> ${s.business?.foundingYear}<br>
<strong>Positioning:</strong> ${s.business?.positioningStatement}</p>

<h2>Differentiators</h2>
<p>${s.business?.differentiators}</p>

<h2>Firm History</h2>
<p>${s.business?.firmHistory}</p>

<h2>Team (${s.team?.length ?? 0} members)</h2>
${(s.team ?? []).map((t: any) => `<p><strong>${t.name}</strong> — ${t.title}<br>${t.certifications?.join(', ')}</p>`).join('')}

<h2>Services (${s.services?.length ?? 0})</h2>
${(s.services ?? []).map((sv: any) => `<p><strong>${sv.name}:</strong> ${sv.description}</p>`).join('')}

<h2>Assets Uploaded</h2>
<p>See attachments below.</p>
  `.trim()
}
```

### 6. Wire the Approve route

`app/api/sessions/[id]/approve/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { createBasecampProject } from '@/lib/basecamp/create-project'
import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createServerClient()

  const { data: session } = await supabase.from('sessions').select('*').eq('id', params.id).single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'approved') return NextResponse.json({ error: 'Already approved' }, { status: 409 })
  if (session.basecamp_project_id) return NextResponse.json({ error: 'Basecamp project already exists' }, { status: 409 })

  try {
    // Step 1: Generate PDF (implemented in Step 13)
    const pdfRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/pdf/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: params.id }),
    })
    const pdfData = await pdfRes.json()
    const pdfUrl = pdfData.url ?? null

    // Step 2: Create Basecamp project
    const basecampProjectId = await createBasecampProject(session, pdfUrl)

    // Step 3: Mark as approved
    const { data: adminUser } = await supabase.auth.getUser()
    await supabase.from('sessions').update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: adminUser.user?.id,
      basecamp_project_id: basecampProjectId,
      content_generation_ready: true,
      pdf_url: pdfUrl,
    }).eq('id', params.id)

    return NextResponse.json({ success: true, basecampProjectId })
  } catch (err: any) {
    console.error('[Approve]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
```

---

## Test Process

### T1 — Basecamp OAuth connects successfully
Click "Connect Basecamp" in the admin dashboard.
Expected: Redirected to Basecamp authorization page → authorize → redirected back to dashboard with `?basecamp=connected`.
Check: `basecamp_tokens` table has one row with a valid `access_token`.

### T2 — Token refresh works
Manually set `expires_at` to a past timestamp in the `basecamp_tokens` table.
Trigger any Basecamp API call.
Expected: New token fetched, `basecamp_tokens` row updated with new token and future `expires_at`.

### T3 — Approve creates a Basecamp project
Approve a completed test session.
Expected:
- Basecamp project appears in your Basecamp account named `[Firm Name] — Website Build`
- Message board has a post titled "Intake Summary — [Firm Name]" with the summary content

### T4 — PDF is attached to the Basecamp message
After approval, verify the intake summary message has a PDF attachment.

### T5 — Asset files are uploaded to Basecamp
If the session had uploaded assets, verify they appear as attachments in the Basecamp message.

### T6 — Session status is approved after approval
```sql
SELECT status, approved_at, basecamp_project_id, content_generation_ready
FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: `status = 'approved'`, `approved_at` set, `basecamp_project_id` has a value, `content_generation_ready = true`.

### T7 — Double-approval is blocked
Try to approve the same session twice.
Expected: Second attempt returns 409 "Already approved".

---

## Common Failure Points

- **Token expiry** — Basecamp access tokens expire after 2 weeks. Always call `getValidToken()` at the start of every Basecamp API interaction — never cache the token in a variable across requests.
- **Attachment upload order** — you must create the message first (plain text), upload all attachments to get their sgids, then update the message with `<bc-attachment>` tags. The Basecamp API requires this sequence.
- **Rate limiting** — Basecamp allows 50 requests per 10 seconds. The 200ms delay between asset uploads helps. For sessions with many files, consider logging upload counts.
- **Large files in memory** — fetch files from Supabase Storage using `.download()` which returns a Blob. Convert to ArrayBuffer before uploading. For very large files (50MB+), this can be memory-intensive in a serverless function. Monitor Vercel function memory usage.
- **Basecamp account ID** — find it in your Basecamp URL: `3.basecamp.com/{ACCOUNT_ID}`. Do not confuse it with the project ID.
