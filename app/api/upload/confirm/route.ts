import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { readJsonBody } from '@/app/api/_json'

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff', 'application/pdf']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const parsed = await readJsonBody<{
    sessionId?: string; storagePath?: string; fileName?: string; mimeType?: string
    assetCategory?: string; metadata?: unknown
  }>(req)
  if (parsed instanceof NextResponse) return parsed
  const { sessionId, storagePath, fileName, mimeType, assetCategory, metadata } = parsed

  if (!sessionId || !storagePath || !fileName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }
  // Metadata is optional; if present must be a plain object (no arrays, no
  // primitives). The DB column accepts any jsonb but we constrain at the
  // API boundary so the assets table doesn't accumulate inconsistent shapes.
  if (metadata !== undefined && (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))) {
    return NextResponse.json({ error: 'Invalid metadata — must be an object' }, { status: 400 })
  }

  // Validate storagePath belongs to this session — prevent cross-session file
  // claiming. Decode before checking (security rule 8) so percent-encoded
  // traversal can't pass the prefix check, and reject dot segments outright.
  if (typeof storagePath !== 'string') {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(storagePath)
  } catch {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }
  const expectedPrefix = `sessions/${sessionId}/`
  if (
    decodedPath !== storagePath ||
    !decodedPath.startsWith(expectedPrefix) ||
    decodedPath.split('/').some(s => s === '' || s === '.' || s === '..')
  ) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: fileData, error: fileError } = await supabase.storage
    .from('session-assets')
    .download(storagePath)

  if (fileError) {
    return NextResponse.json(
      { error: 'File not found in storage — upload may have failed' },
      { status: 400 }
    )
  }

  const buffer = await fileData.arrayBuffer()
  const detected = await fileTypeFromBuffer(buffer)

  if (!detected || !ALLOWED_MIMES.includes(detected.mime)) {
    await supabase.storage.from('session-assets').remove([storagePath])
    return NextResponse.json(
      { error: 'File type rejected — content does not match extension' },
      { status: 400 }
    )
  }

  // The session-assets bucket is private — never store a public URL.
  // Admin UIs sign URLs on demand via lib/supabase server.createSignedUrl().
  // Server-side context binding: if the agent has staged a current team
  // member name (Phase 3 chunk 3), tag this upload as a team-photo for that
  // member. The chat UI doesn't need to know — the agent owns the linkage
  // via _meta.current_team_member_name and the server applies it here.
  let resolvedCategory = assetCategory ?? null
  let resolvedMetadata: Record<string, unknown> | null =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null

  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()

  const sessionMeta =
    (sessionRow?.schema_data as { _meta?: Record<string, unknown> } | null)?._meta
  const currentMember = sessionMeta?.current_team_member_name
  if (typeof currentMember === 'string' && currentMember.trim()) {
    resolvedCategory = 'team-photo'
    resolvedMetadata = { ...(resolvedMetadata ?? {}), team_member_name: currentMember.trim() }
  }

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      session_id: sessionId,
      file_name: fileName,
      storage_path: storagePath,
      public_url: null,
      mime_type: detected?.mime ?? mimeType,
      // Trust the actual downloaded byte length, not the client-supplied fileSize.
      file_size_bytes: buffer.byteLength,
      asset_category: resolvedCategory,
      metadata: resolvedMetadata,
    })
    .select()
    .single()

  if (error) {
    console.error('[upload/confirm]', error)
    return NextResponse.json({ error: 'Failed to record asset' }, { status: 500 })
  }

  return NextResponse.json({ assetId: asset.id })
}
