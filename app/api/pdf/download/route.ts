import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Resolve and validate a session-assets storage path. Only the two path
// families this bucket holds are signable: generated documents under
// pdfs/{sessionId}/ and client uploads under sessions/{sessionId}/. Decode
// before validating (security rule 8) so encoded traversal can't slip past,
// and sign exactly the string that was validated.
function resolvePath(raw: string): { sessionId: string; path: string } | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const segments = decoded.split('/')
  if (segments.length < 3) return null
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null
  const [root, sessionId] = segments
  if (root !== 'pdfs' && root !== 'sessions') return null
  if (!UUID_RE.test(sessionId)) return null
  return { sessionId, path: decoded }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawPath = searchParams.get('path')
  if (!rawPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const resolved = resolvePath(rawPath)
  if (!resolved) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  const access = await requireSessionAccess(resolved.sessionId)
  if (access instanceof NextResponse) return access

  const supabase = createServerClient()
  const { data, error } = await supabase.storage
    .from('session-assets')
    .createSignedUrl(resolved.path, 300) // 5-minute signed URL

  if (error || !data) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })

  return NextResponse.redirect(data.signedUrl)
}
