# Step 13 — PDF Generation

**Depends on:** Steps 02, 10
**Unlocks:** Step 12 (Basecamp attaches the PDF on approval)
**Estimated time:** Day 19–20

> **Note:** Build this step before Step 12, even though they're triggered together. The Approve route in Step 12 calls the PDF endpoint first, then Basecamp.

---

## What This Step Accomplishes

When an admin approves a session, the system generates a formatted PDF summary of all collected intake data using `@react-pdf/renderer`, uploads it to Supabase Storage, and returns a URL that gets attached to the Basecamp project.

---

## Architecture Note

`@react-pdf/renderer` requires the Node.js runtime — it will not work on Vercel's Edge runtime. Add `export const runtime = 'nodejs'` to the API route. For PDF generation time > 10 seconds (complex layouts), Vercel Pro is required (60-second function timeout). Keep the PDF lean — do not embed full-size images.

---

## Implementation Tasks

### 1. Build the PDF components

`lib/pdf/components/`:

`CoverPage.tsx`:
```typescript
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 48, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24 },
  field: { fontSize: 10, marginBottom: 4 },
  label: { fontWeight: 'bold' },
})

export function CoverPage({ schema, approvedAt }: { schema: any; approvedAt: string }) {
  return (
    <Page size="A4" style={styles.page}>
      <View>
        <Text style={styles.title}>{schema.business?.name ?? 'Unnamed Firm'}</Text>
        <Text style={styles.subtitle}>Website Intake Summary</Text>
        <Text style={styles.field}><Text style={styles.label}>Website: </Text>{schema.websiteUrl}</Text>
        <Text style={styles.field}><Text style={styles.label}>Contact: </Text>{schema.contact?.firstName} {schema.contact?.lastName}</Text>
        <Text style={styles.field}><Text style={styles.label}>Email: </Text>{schema.contact?.email}</Text>
        <Text style={styles.field}><Text style={styles.label}>Phone: </Text>{schema.contact?.phone}</Text>
        <Text style={styles.field}><Text style={styles.label}>Date Approved: </Text>{new Date(approvedAt).toLocaleDateString()}</Text>
      </View>
    </Page>
  )
}
```

`DataPage.tsx` (reusable section page):
```typescript
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 48 },
  heading: { fontSize: 16, fontWeight: 'bold', marginBottom: 12, borderBottom: '1pt solid #ddd', paddingBottom: 6 },
  section: { marginBottom: 16 },
  label: { fontSize: 9, color: '#888', marginBottom: 2 },
  value: { fontSize: 11, marginBottom: 8 },
  subheading: { fontSize: 12, fontWeight: 'bold', marginBottom: 6, marginTop: 8 },
})

export function DataPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </Page>
  )
}

export function Field({ label, value }: { label: string; value: string | number | undefined }) {
  if (!value && value !== 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text style={styles.value}>{String(value)}</Text>
    </View>
  )
}

export function Subheading({ children }: { children: string }) {
  return <Text style={styles.subheading}>{children}</Text>
}
```

### 2. Build the main PDF generator

`lib/pdf/generate-pdf.ts`:
```typescript
import { Document, renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { CoverPage } from './components/CoverPage'
import { DataPage, Field, Subheading } from './components/DataPage'

export async function generateIntakePdf(session: any): Promise<Buffer> {
  const s = session.schema_data ?? {}

  const doc = React.createElement(Document, {},
    // Page 1: Cover
    React.createElement(CoverPage, { schema: s, approvedAt: session.approved_at }),

    // Page 2: Locations + Technical
    React.createElement(DataPage, { title: 'Locations & Technical' },
      ...(s.locations ?? []).map((loc: any, i: number) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement(Subheading, {}, loc.name || `Location ${i + 1}`),
          React.createElement(Field, { label: 'Address', value: `${loc.street}, ${loc.city}, ${loc.state} ${loc.zip}` }),
          React.createElement(Field, { label: 'Phone', value: loc.phone }),
          React.createElement(Field, { label: 'Email', value: loc.email }),
        )
      ),
      React.createElement(Subheading, {}, 'Domain & Hosting'),
      React.createElement(Field, { label: 'Registrar', value: s.technical?.registrar }),
      React.createElement(Field, { label: 'Registration Date', value: s.technical?.registrationDate }),
      React.createElement(Field, { label: 'Expiry Date', value: s.technical?.expiryDate }),
      React.createElement(Field, { label: 'Hosting Provider', value: s.technical?.hostingProvider }),
      React.createElement(Field, { label: 'Registrar Username', value: s.technical?.registrarUsername }),
      React.createElement(Field, { label: 'Registrar PIN', value: s.technical?.registrarPin }),
    ),

    // Page 3: Team
    React.createElement(DataPage, { title: 'Team' },
      ...(s.team ?? []).map((member: any, i: number) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement(Subheading, {}, member.name),
          React.createElement(Field, { label: 'Title', value: member.title }),
          React.createElement(Field, { label: 'Certifications', value: member.certifications?.join(', ') }),
          React.createElement(Field, { label: 'Specializations', value: member.specializations?.join(', ') }),
          React.createElement(Field, { label: 'Bio', value: member.bio }),
        )
      ),
    ),

    // Page 4: Services & Niches
    React.createElement(DataPage, { title: 'Services & Industries Served' },
      React.createElement(Subheading, {}, 'Services'),
      ...(s.services ?? []).map((svc: any, i: number) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement(Field, { label: svc.name, value: svc.description }),
        )
      ),
      React.createElement(Subheading, {}, 'Industries Served'),
      ...(s.niches ?? []).map((niche: any, i: number) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement(Field, { label: niche.name, value: niche.description }),
          React.createElement(Field, { label: 'Ideal Client', value: niche.icp }),
        )
      ),
    ),

    // Page 5: Business Details
    React.createElement(DataPage, { title: 'Business & Positioning' },
      React.createElement(Field, { label: 'Founded', value: s.business?.foundingYear }),
      React.createElement(Field, { label: 'Tagline', value: s.business?.tagline }),
      React.createElement(Field, { label: 'Positioning Selection', value: s.business?.positioningOption }),
      React.createElement(Field, { label: 'Positioning Statement', value: s.business?.positioningStatement }),
      React.createElement(Field, { label: 'Differentiators', value: s.business?.differentiators }),
      React.createElement(Field, { label: 'Firm History', value: s.business?.firmHistory }),
      React.createElement(Field, { label: 'Geographic Scope', value: s.business?.geographicScope }),
      React.createElement(Field, { label: 'How Clients Find Them', value: s.business?.howClientsFind }),
    ),

    // Page 6: Culture, Assets, Additional
    React.createElement(DataPage, { title: 'Culture, Assets & Additional' },
      React.createElement(Field, { label: 'Mission / Values', value: s.culture?.missionVisionValues }),
      React.createElement(Field, { label: 'Team Culture', value: s.culture?.teamDescription }),
      React.createElement(Field, { label: 'Social Channels', value: s.culture?.socialMediaChannels?.join(', ') }),
      React.createElement(Subheading, {}, 'Assets'),
      React.createElement(Field, { label: 'Headshots Available', value: s.assets?.headshotsAvailable?.join(', ') }),
      React.createElement(Field, { label: 'Office Photos', value: s.assets?.officePhotosAvailable ? 'Yes' : 'No' }),
      React.createElement(Field, { label: 'Testimonials', value: s.assets?.testimonialsAvailable?.join('; ') }),
      React.createElement(Field, { label: 'Additional Notes', value: s.additional?.otherDetails }),
    ),
  )

  return renderToBuffer(doc)
}
```

### 3. Build the PDF generation API route

`app/api/pdf/generate/route.ts`:
```typescript
export const runtime = 'nodejs'
export const maxDuration = 30  // Requires Vercel Pro for >10s

import { createServerClient } from '@/lib/supabase/server'
import { generateIntakePdf } from '@/lib/pdf/generate-pdf'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId } = await req.json()
  const supabase = createServerClient()

  const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  try {
    // Generate PDF buffer
    const pdfBuffer = await generateIntakePdf(session)

    // Upload to Supabase Storage
    const storagePath = `pdfs/${sessionId}/intake-summary.pdf`
    const { error: uploadError } = await supabase.storage
      .from('session-assets')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) throw uploadError

    // Get the storage URL
    const { data: urlData } = supabase.storage.from('session-assets').getPublicUrl(storagePath)

    // Update session with PDF URL
    await supabase.from('sessions').update({ pdf_url: urlData.publicUrl }).eq('id', sessionId)

    return NextResponse.json({ url: urlData.publicUrl, storagePath })
  } catch (err: any) {
    console.error('[PDF Generation]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
```

### 4. Add PDF download link to admin session detail

In the admin session detail page, show a download link if `session.pdf_url` is set:
```typescript
{session.pdf_url && (
  <a href={session.pdf_url} target="_blank" className="text-sm text-blue-600 underline">
    Download Intake PDF
  </a>
)}
```

---

## Test Process

### T1 — PDF generates without error locally
```bash
# Create a test script: scripts/test-pdf.ts
import { generateIntakePdf } from '../lib/pdf/generate-pdf'
import fs from 'fs'

const mockSession = {
  schema_data: {
    business: { name: 'Test CPA Firm', foundingYear: '2005', differentiators: 'We care.' },
    contact: { firstName: 'John', lastName: 'Smith', email: 'john@test.com', phone: '555-1234' },
    websiteUrl: 'https://testcpa.com',
    team: [{ name: 'John Smith', title: 'CPA', certifications: ['CPA', 'PFS'] }],
    services: [{ name: 'Tax Planning', description: 'Strategic tax minimization.' }],
  },
  approved_at: new Date().toISOString(),
}

const buffer = await generateIntakePdf(mockSession)
fs.writeFileSync('test-output.pdf', buffer)
console.log('PDF written to test-output.pdf')
```
Open `test-output.pdf` — verify it renders correctly.

### T2 — PDF API route returns a URL
```bash
curl -X POST http://localhost:3000/api/pdf/generate \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "YOUR_SESSION_ID"}'
```
Expected: `{ "url": "https://...supabase.co/storage/..." }`

### T3 — PDF is stored in Supabase Storage
In Supabase → Storage → `session-assets`, navigate to `pdfs/{sessionId}/`.
Expected: `intake-summary.pdf` exists.

### T4 — PDF URL is saved in sessions table
```sql
SELECT pdf_url FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: Non-null URL.

### T5 — PDF is readable (not corrupted)
Download the PDF from the returned URL and open it. Verify all sections render.

### T6 — PDF regeneration overwrites the old file
Call the generate route twice for the same session.
Expected: Second call succeeds, file is overwritten (upsert: true), no duplicate files in storage.

### T7 — Missing schema fields don't crash the PDF
Test with a minimal schema (only `business.name` and `websiteUrl`).
Expected: PDF generates successfully with empty sections for missing fields.

---

## Common Failure Points

- **Edge runtime** — `@react-pdf/renderer` does not work on the Edge runtime. The route MUST export `runtime = 'nodejs'`.
- **Function timeout on Hobby plan** — complex PDFs can take 5–15 seconds. Vercel Hobby has a 10-second limit. Use Vercel Pro or move to a background job.
- **Embedding images in the PDF** — do not fetch and embed uploaded headshots/logos in the PDF. Reference them by filename only. Embedding large images makes PDFs memory-intensive and slow to generate.
- **`renderToBuffer` vs `renderToStream`** — use `renderToBuffer` for upload-and-store workflows. `renderToStream` is better for direct HTTP streaming, but adds complexity. Buffer is simpler for this use case.
- **Storage bucket path** — PDF storage path is `pdfs/{sessionId}/intake-summary.pdf`, which is separate from uploaded client assets at `sessions/{sessionId}/`. Keep these paths distinct.
