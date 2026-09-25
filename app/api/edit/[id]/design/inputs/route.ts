import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { createInput, listInputs } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { isPlainObject, normalizeInputUrl, parseOptionalText, parseUrlInputKind } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { INPUT_LABEL_MAX, INPUT_NOTES_MAX } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'

interface CreateUrlInputBody {
  kind?: unknown
  url?: unknown
  label?: unknown
  notes?: unknown
}

type Params = { params: Promise<{ id: string }> }

// GET — the session's design inputs (oldest first) with signed thumbnails.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const supabase = createServerClient()
    const rows = await listInputs(supabase, ctx.sessionId)
    const signed = await signDesignPaths(supabase, rows.flatMap((r) => (r.storage_path ? [r.storage_path] : [])))
    return NextResponse.json({ inputs: rows.map((r) => toInputDto(r, signed)) })
  } catch (err) {
    return internalError('design:inputs:list', err, 'Failed to load the inputs')
  }
}

// POST — add an inspiration / competitor / current-site URL. Validated only;
// nothing is fetched until the admin presses Capture.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const raw = await readJsonBody<unknown>(req)
  if (raw instanceof NextResponse) return raw
  if (!isPlainObject(raw)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const body: CreateUrlInputBody = raw

  const kind = parseUrlInputKind(body.kind)
  if (!kind) {
    return NextResponse.json({ error: 'kind must be inspiration_url, competitor_url or current_site.' }, { status: 400 })
  }
  const url = normalizeInputUrl(body.url)
  if (!url.ok) return NextResponse.json({ error: url.reason }, { status: 400 })
  const label = parseOptionalText(body.label, INPUT_LABEL_MAX, 'Label')
  if (!label.ok) return NextResponse.json({ error: label.reason }, { status: 400 })
  const notes = parseOptionalText(body.notes, INPUT_NOTES_MAX, 'Notes')
  if (!notes.ok) return NextResponse.json({ error: notes.reason }, { status: 400 })

  try {
    const row = await createInput(createServerClient(), {
      sessionId: ctx.sessionId,
      kind,
      url: url.url,
      label: label.value,
      notes: notes.value,
      createdBy: ctx.adminId,
    })
    return NextResponse.json({ input: toInputDto(row, {}) }, { status: 201 })
  } catch (err) {
    return internalError('design:inputs:create', err, 'Failed to add the input')
  }
}
