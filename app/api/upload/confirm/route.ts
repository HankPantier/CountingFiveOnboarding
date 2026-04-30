import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'application/pdf']

export async function POST(req: Request) {
  const { sessionId, storagePath, fileName, mimeType, fileSize, assetCategory } = await req.json()

  if (!sessionId || !storagePath || !fileName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

  const { data: urlData } = supabase.storage
    .from('session-assets')
    .getPublicUrl(storagePath)

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      session_id: sessionId,
      file_name: fileName,
      storage_path: storagePath,
      public_url: urlData.publicUrl,
      mime_type: detected?.mime ?? mimeType,
      file_size_bytes: fileSize,
      asset_category: assetCategory ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ assetId: asset.id, publicUrl: urlData.publicUrl })
}
