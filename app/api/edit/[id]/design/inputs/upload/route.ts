import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { createInput, type DesignInputRow } from '@/lib/design/store'
import { designStoragePath, removeDesignPaths, signDesignPaths, storeDesignImage } from '@/lib/design/storage'
import { readImageForm, toValidatedWebp } from '@/lib/design/upload-image'
import { parseOptionalText } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'

// POST multipart { file, label?, notes? } — an inspiration image. Validated
// (size, magic bytes) and re-encoded to WebP (strips metadata, caps the long
// edge) BEFORE anything is written; stored privately under
// design/{sid}/inputs/{uuid}.webp. If the row insert fails the object is
// deleted, so nothing is left behind.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const read = await readImageForm(req)
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status })

  const label = parseOptionalText(read.form.get('label'), INPUT_LABEL_MAX, 'Label')
  if (!label.ok) return NextResponse.json({ error: label.reason }, { status: 400 })
  const notes = parseOptionalText(read.form.get('notes'), INPUT_NOTES_MAX, 'Notes')
  if (!notes.ok) return NextResponse.json({ error: notes.reason }, { status: 400 })

  const image = await toValidatedWebp(read.file)
  if (!image.ok) return NextResponse.json({ error: image.error }, { status: image.status })
  const webp = image.webp

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
