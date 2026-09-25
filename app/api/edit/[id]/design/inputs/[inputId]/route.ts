import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { deleteInput, updateInput, type DesignInputPatch } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { isPlainObject, isUuid, parseOptionalText } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'

interface PatchInputBody {
  label?: unknown
  notes?: unknown
  archived?: unknown
}

type Params = { params: Promise<{ id: string; inputId: string }> }

function invalidId() {
  return NextResponse.json({ error: 'Invalid input id.' }, { status: 400 })
}

// PATCH — edit an input's label / notes, or archive / unarchive it. Scoped to
// the gated session: an id from another session is 404.
export async function PATCH(req: Request, { params }: Params) {
  const { id, inputId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(inputId)) return invalidId()

  const raw = await readJsonBody<unknown>(req)
  if (raw instanceof NextResponse) return raw
  if (!isPlainObject(raw)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const body: PatchInputBody = raw

  const patch: DesignInputPatch = {}
  if ('label' in body) {
    const r = parseOptionalText(body.label, INPUT_LABEL_MAX, 'Label')
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 })
    patch.label = r.value
  }
  if ('notes' in body) {
    const r = parseOptionalText(body.notes, INPUT_NOTES_MAX, 'Notes')
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 })
    patch.notes = r.value
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') return NextResponse.json({ error: 'archived must be true or false.' }, { status: 400 })
    patch.archived = body.archived
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  try {
    const supabase = createServerClient()
    const row = await updateInput(supabase, ctx.sessionId, inputId, patch)
    if (!row) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    const signed = row.storage_path ? await signDesignPaths(supabase, [row.storage_path]) : {}
    return NextResponse.json({ input: toInputDto(row, signed) })
  } catch (err) {
    return internalError('design:inputs:update', err, 'Failed to update the input')
  }
}

// DELETE — remove an input and its stored screenshot/image.
export async function DELETE(_req: Request, { params }: Params) {
  const { id, inputId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(inputId)) return invalidId()
  try {
    const deleted = await deleteInput(createServerClient(), ctx.sessionId, inputId)
    if (!deleted) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return internalError('design:inputs:delete', err, 'Failed to delete the input')
  }
}
