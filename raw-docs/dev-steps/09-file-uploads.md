# Step 09 — File Uploads

**Depends on:** Steps 02, 06
**Unlocks:** Step 10 (admin dashboard shows uploaded assets)
**Estimated time:** Day 12

---

## What This Step Accomplishes

Clients can upload logos, headshots, and photos directly within the chat interface during Phase 5. Files are uploaded directly from the browser to Supabase Storage (bypassing the Next.js function to avoid timeout issues). Asset records are created in the database. The upload UI only appears when the session reaches Phase 5.

---

## Architecture Note: Direct-to-Supabase Upload

Do NOT stream large files through a Next.js API route — this will hit Vercel's timeout for files over ~10MB. Instead:

1. Client requests a **signed upload URL** from the Next.js API
2. Client uploads **directly to Supabase Storage** using that URL
3. Client notifies the API that the upload is complete
4. API creates the asset record in the database

This keeps the Next.js function lightweight and avoids timeout issues.

---

## Implementation Tasks

### 1. Build the signed URL API route

`app/api/upload/presign/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId, fileName, mimeType, fileSize, assetCategory } = await req.json()

  // Validate session exists
  const supabase = createServerClient()
  const { data: session } = await supabase.from('sessions').select('id, current_phase').eq('id', sessionId).single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.current_phase < 5) return NextResponse.json({ error: 'File uploads not available yet' }, { status: 403 })

  // Validate file type (allowed MIME types)
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'application/pdf']
  if (!allowedMimes.includes(mimeType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  // Validate file size (300MB max)
  const maxBytes = 300 * 1024 * 1024
  if (fileSize > maxBytes) {
    return NextResponse.json({ error: 'File too large (max 300MB)' }, { status: 400 })
  }

  // Generate storage path
  const uuid = crypto.randomUUID()
  const storagePath = `sessions/${sessionId}/${uuid}-${fileName}`

  // Create signed upload URL
  const { data, error } = await supabase.storage
    .from('session-assets')
    .createSignedUploadUrl(storagePath)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    signedUrl: data.signedUrl,
    storagePath,
    token: data.token,
  })
}
```

### 2. Build the upload confirmation API route

`app/api/upload/confirm/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'

export async function POST(req: Request) {
  const { sessionId, storagePath, fileName, mimeType, fileSize, assetCategory } = await req.json()

  const supabase = createServerClient()

  // Verify the file actually exists in storage (confirms upload completed)
  const { data: fileData, error: fileError } = await supabase.storage
    .from('session-assets')
    .download(storagePath)

  if (fileError) return NextResponse.json({ error: 'File not found in storage — upload may have failed' }, { status: 400 })

  // Server-side MIME type validation via magic bytes
  const buffer = await fileData.arrayBuffer()
  const detected = await fileTypeFromBuffer(Buffer.from(buffer))
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'application/pdf']
  if (detected && !allowedMimes.includes(detected.mime)) {
    // Delete the uploaded file and reject
    await supabase.storage.from('session-assets').remove([storagePath])
    return NextResponse.json({ error: 'File type rejected — content does not match extension' }, { status: 400 })
  }

  // Get public URL (or generate signed URL for private access)
  const { data: urlData } = supabase.storage
    .from('session-assets')
    .getPublicUrl(storagePath)

  // Insert asset record
  const { data: asset, error } = await supabase.from('assets').insert({
    session_id: sessionId,
    file_name: fileName,
    storage_path: storagePath,
    public_url: urlData.publicUrl,
    mime_type: detected?.mime ?? mimeType,
    file_size_bytes: fileSize,
    asset_category: assetCategory,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ assetId: asset.id, publicUrl: urlData.publicUrl })
}
```

Note: `file-type` package must be installed:
```bash
npm install file-type
```

### 3. Build the FileUploadButton component

`components/chat/FileUploadButton.tsx`:
```typescript
'use client'
import { useState, useRef } from 'react'

type Props = {
  sessionId: string
  onUploadComplete: (fileName: string, assetId: string) => void
}

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.gif', '.png', '.tif', '.tiff', '.pdf']

export default function FileUploadButton({ sessionId, onUploadComplete }: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Client-side validation
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`)
      return
    }
    if (file.size > 300 * 1024 * 1024) {
      setError('File too large. Maximum size is 300MB.')
      return
    }

    setError('')
    setUploading(true)
    setProgress(0)

    try {
      // Step 1: Get signed upload URL
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          assetCategory: detectCategory(file.name),
        }),
      })
      const { signedUrl, storagePath, error: presignError } = await presignRes.json()
      if (presignError) throw new Error(presignError)

      // Step 2: Upload directly to Supabase Storage
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload to storage failed')
      setProgress(80)

      // Step 3: Confirm upload and create asset record
      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          storagePath,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          assetCategory: detectCategory(file.name),
        }),
      })
      const { assetId, error: confirmError } = await confirmRes.json()
      if (confirmError) throw new Error(confirmError)

      setProgress(100)
      onUploadComplete(file.name, assetId)
    } catch (err: any) {
      setError(err.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function detectCategory(fileName: string): string {
    const lower = fileName.toLowerCase()
    if (lower.includes('logo')) return 'logo'
    if (lower.includes('headshot') || lower.includes('portrait') || lower.includes('photo')) return 'headshot'
    return 'other'
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.join(',')}
        onChange={handleFileSelect}
        disabled={uploading}
        className="hidden"
        id="file-upload"
      />
      <label htmlFor="file-upload" className={`cursor-pointer px-3 py-1.5 border rounded text-sm ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}>
        {uploading ? `Uploading... ${progress}%` : '📎 Attach file'}
      </label>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  )
}
```

### 4. Wire FileUploadButton into ChatInterface

In `components/chat/ChatInterface.tsx`, add the upload button below the text input, visible only in Phase 5+:

```typescript
// Add to ChatInterface props
const currentPhase = initialSession.current_phase

// In the form:
{currentPhase >= 5 && (
  <FileUploadButton
    sessionId={sessionId}
    onUploadComplete={(fileName, assetId) => {
      // Append a system-style message to the chat thread
      append({ role: 'user', content: `[File uploaded: ${fileName}]` })
    }}
  />
)}
```

---

## Test Process

### T1 — Upload button appears only in Phase 5+
Manually set a test session to phase 4, open the session URL — upload button should NOT appear.
Set to phase 5 — upload button SHOULD appear.

### T2 — Successful file upload creates an asset record
Upload a small PNG logo.
```sql
SELECT file_name, mime_type, asset_category, file_size_bytes
FROM assets
WHERE session_id = 'YOUR_SESSION_ID'
ORDER BY uploaded_at DESC;
```
Expected: Row with correct file name, mime type, and size.

### T3 — File appears in Supabase Storage
In Supabase → Storage → `session-assets`, navigate to `sessions/{sessionId}/` and verify the file exists.

### T4 — Invalid file type is rejected client-side
Attempt to select a `.exe` file. Expected: Error shown before any upload attempt.

### T5 — Invalid file type is rejected server-side (magic bytes)
Rename a `.exe` file to `.jpg` and attempt upload. Expected: 400 from the confirm route, file deleted from storage.

### T6 — File too large is rejected
Create a file > 300MB (or mock one). Expected: Client-side size validation rejects it before the presign request is made.

### T7 — Upload notification appears in chat
After uploading, verify a "[File uploaded: filename.png]" message appears in the chat thread. This lets the agent acknowledge the upload.

### T8 — Assets list loads correctly on session re-open
Close and reopen the session URL. Verify previously uploaded files are listed (load from `assets` table in the page server component).

---

## Common Failure Points

- **Streaming through Next.js API** — always use the signed URL approach. Direct file streaming through a Next.js function will timeout for files > ~10MB on Vercel Hobby.
- **Missing MIME type validation** — client MIME types can be faked. Validate by reading file magic bytes server-side using the `file-type` package. Delete the file if validation fails — don't leave bad data in storage.
- **Phase gate missing** — the presign route must verify `current_phase >= 5`. Without this, clients can upload files at any phase, which would create asset records with no chat context.
- **Bucket is private** — the `session-assets` bucket should be private. Use signed URLs or service-role-key access for any reads. Do not make it public unless you have a specific reason.
