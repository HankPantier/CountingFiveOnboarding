import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { createInput, type DesignInputRow } from '@/lib/design/store'
import { designStoragePath, removeDesignPaths, signDesignPaths, storeDesignImage, toWebp } from '@/lib/design/storage'
import { parseOptionalText } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
// Multipart framing (boundary markers, headers) adds a little over the raw
// file size — 64 KB is generous headroom for a single-file form.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
// Magic-byte-verifiable rasters only. SVG has no magic bytes and can carry script.
const UPLOAD_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

// POST multipart { file, label?, notes? } — an inspiration image. Validated
// (size, magic bytes) and re-encoded to WebP (strips metadata, caps the long
// edge) BEFORE anything is written; stored privately under
// design/{sid}/inputs/{uuid}.webp. If the row insert fails the object is
// deleted, so nothing is left behind.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  // Cheap rejection of an oversized body before buffering the whole
  // multipart payload into memory via req.formData().
  const contentLength = Number(req.headers.get('content-length'))
  if (contentLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: 'Images must be 8 MB or smaller.' }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'An image file is required.' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Images must be 8 MB or smaller.' }, { status: 413 })

  const label = parseOptionalText(form.get('label'), INPUT_LABEL_MAX, 'Label')
  if (!label.ok) return NextResponse.json({ error: label.reason }, { status: 400 })
  const notes = parseOptionalText(form.get('notes'), INPUT_NOTES_MAX, 'Notes')
  if (!notes.ok) return NextResponse.json({ error: notes.reason }, { status: 400 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const type = await fileTypeFromBuffer(bytes)
  if (!type || !UPLOAD_MIMES.has(type.mime)) {
    return NextResponse.json({ error: 'Upload a PNG, JPEG or WebP image.' }, { status: 415 })
  }
  let webp: Buffer
  try {
    webp = (await toWebp(bytes)).webp
  } catch {
    return NextResponse.json({ error: 'That image could not be read.' }, { status: 415 })
  }

  const inputId = randomUUID()
  const path = designStoragePath(ctx.sessionId, 'inputs', `${inputId}.webp`)
  const supabase = createServerClient()
  // `storedPath` tracks a new object that can still be rolled back if
  // something fails BEFORE the row is committed to point at it. Once the
  // commit succeeds we clear it — nothing past that point (including a
  // signing failure below) may delete the new object.
  let storedPath: string | null = null
  let row: DesignInputRow
  try {
    await storeDesignImage(supabase, path, webp)
    storedPath = path
    row = await createInput(supabase, {
      id: inputId,
      sessionId: ctx.sessionId,
      kind: 'inspiration_image',
      url: null,
      label: label.value,
      notes: notes.value,
      storagePath: path,
      captureStatus: 'ok',
      capturedAt: new Date().toISOString(),
      createdBy: ctx.adminId,
    })
    // Commit point: the row now points at `path`. This upload is no longer
    // eligible for rollback.
    storedPath = null
  } catch (err) {
    if (storedPath) {
      await removeDesignPaths(supabase, [storedPath]).catch((e) => console.warn('[design-upload] cleanup failed:', e))
    }
    return internalError('design:inputs:upload', err, 'Failed to save the image')
  }

  // Signing is best-effort and deliberately outside the rollback above: a
  // signing failure must not undo an already-committed row — it only means
  // the client gets a null thumbnail for now (the next GET will retry it).
  try {
    const signed = await signDesignPaths(supabase, [path])
    return NextResponse.json({ input: toInputDto(row, signed) }, { status: 201 })
  } catch (err) {
    console.warn('[design-upload] signing failed after upload:', err)
    return NextResponse.json({ input: toInputDto(row, {}) }, { status: 201 })
  }
}
