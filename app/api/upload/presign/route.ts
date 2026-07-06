import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'

// image/svg+xml is allowed here so the admin logo flow can presign an SVG; the
// bytes are validated/sanitized at its own confirm step (the generic
// /api/upload/confirm still rejects SVG via magic-byte checks).
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff', 'application/pdf', 'image/svg+xml']
const MAX_BYTES = 300 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const { sessionId, fileName, mimeType, fileSize, assetCategory } = await req.json()

  if (!sessionId || !fileName || !mimeType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, current_phase')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.current_phase < 5) {
    // The phase gate exists for the client-facing chat flow (uploads unlock
    // at agent phase 5). Admins manage team photos from the dashboard at any
    // phase — let an authenticated admin through.
    const auth = await requireSessionAccess(sessionId)
    if (auth instanceof NextResponse) {
      return NextResponse.json({ error: 'File uploads not available yet' }, { status: 403 })
    }
  } else {
    // Phase >= 5 is unauthenticated (client flow) — bound presigns per session
    // so a leaked session URL can't flood the private bucket.
    if (!(await checkRateLimit(`presign:${sessionId}`, 60, 60 * 60 * 1000))) {
      return NextResponse.json({ error: 'Upload limit reached — please wait a bit' }, { status: 429 })
    }
  }

  if (!ALLOWED_MIMES.includes(mimeType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  if (fileSize > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 300MB)' }, { status: 400 })
  }

  const uuid = crypto.randomUUID()
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `sessions/${sessionId}/${uuid}-${safeName}`

  const { data, error } = await supabase.storage
    .from('session-assets')
    .createSignedUploadUrl(storagePath)

  if (error) {
    console.error('[upload/presign]', error)
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
  }

  void assetCategory

  return NextResponse.json({
    signedUrl: data.signedUrl,
    storagePath,
    token: data.token,
  })
}
