import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'application/pdf']
const MAX_BYTES = 300 * 1024 * 1024

export async function POST(req: Request) {
  const { sessionId, fileName, mimeType, fileSize, assetCategory } = await req.json()

  if (!sessionId || !fileName || !mimeType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, current_phase')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.current_phase < 5) {
    return NextResponse.json({ error: 'File uploads not available yet' }, { status: 403 })
  }

  if (!ALLOWED_MIMES.includes(mimeType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  if (fileSize > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 300MB)' }, { status: 400 })
  }

  const uuid = crypto.randomUUID()
  const storagePath = `sessions/${sessionId}/${uuid}-${fileName}`

  const { data, error } = await supabase.storage
    .from('session-assets')
    .createSignedUploadUrl(storagePath)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  void assetCategory

  return NextResponse.json({
    signedUrl: data.signedUrl,
    storagePath,
    token: data.token,
  })
}
