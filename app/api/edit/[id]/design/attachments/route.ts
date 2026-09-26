import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import type { ChatAttachmentDto } from '@/lib/design/chat-types'
import { attachmentStoragePath, signDesignPaths, storeDesignImage } from '@/lib/design/storage'
import { readImageForm, toValidatedWebp } from '@/lib/design/upload-image'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

interface UploadAttachmentResponse {
  attachment: ChatAttachmentDto
}

// POST multipart { file } — a chat attachment (an annotated screenshot, already
// composited and downscaled in the browser). Validated server-side anyway
// (size, magic bytes), re-encoded to WebP ≤ 1568 px, stored privately at
// design/{sid}/attachments/{uuid}.webp. No DB row and never the `assets`
// table — the uuid IS the attachment id a chat message references.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const read = await readImageForm(req)
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status })
  const image = await toValidatedWebp(read.file)
  if (!image.ok) return NextResponse.json({ error: image.error }, { status: image.status })

  const attachmentId = randomUUID()
  const path = attachmentStoragePath(ctx.sessionId, attachmentId)
  const supabase = createServerClient()
  try {
    await storeDesignImage(supabase, path, image.webp)
  } catch (err) {
    return internalError('design:attachments', err, 'Failed to save the image')
  }

  let url: string | null = null
  try {
    url = (await signDesignPaths(supabase, [path]))[path] ?? null
  } catch (err) {
    console.warn('[design:attachments] signing failed after upload:', err)
  }
  const response: UploadAttachmentResponse = { attachment: { id: attachmentId, url, width: image.width, height: image.height } }
  return NextResponse.json(response, { status: 201 })
}
