import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'
import { deepSetPath, isPathFilled } from '@/lib/mbp/schema-write'
import { regenerateMbpIfApproved } from '@/lib/mbp/regenerate-if-approved'
import { normalizeGapField } from '@/lib/mbp/completeness'
import { asJson } from '@/lib/supabase/json-typed'
import type { GapItem } from '@/types/gap-item'

type StorageBucket = ReturnType<ReturnType<typeof createServerClient>['storage']['from']>

// Every object path under `prefix`, following pagination and sub-folders
// (folder entries come back with a null id). Throws on a list error so the
// caller never proceeds on a partial listing.
async function listAllFiles(bucket: StorageBucket, prefix: string, depth = 0): Promise<string[]> {
  const out: string[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset })
    if (error) throw error
    const entries = data ?? []
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`
      if (entry.id === null) {
        if (depth < 5) out.push(...(await listAllFiles(bucket, path, depth + 1)))
      } else {
        out.push(path)
      }
    }
    if (entries.length < PAGE) break
  }
  return out
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: session } = await supabase.from('sessions').select('id').eq('id', id).single()
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Remove uploaded files, generated PDFs/MDs, and assembled content packages
  // from storage. Listing is paginated + recursive (list() caps at 100 by
  // default and doesn't descend into sub-folders).
  const bucket = supabase.storage.from('session-assets')
  let filesToRemove: string[]
  try {
    const lists = await Promise.all([
      listAllFiles(bucket, `sessions/${id}`),
      listAllFiles(bucket, `pdfs/${id}`),
      listAllFiles(bucket, `content-packages/${id}`),
    ])
    filesToRemove = lists.flat()
  } catch (err) {
    console.error('[DELETE session] storage list failed:', err)
    return NextResponse.json({ error: 'Failed to list session files' }, { status: 500 })
  }
  for (let i = 0; i < filesToRemove.length; i += 1000) {
    const { error: removeErr } = await bucket.remove(filesToRemove.slice(i, i + 1000))
    if (removeErr) {
      console.error('[DELETE session] storage remove failed:', removeErr)
      return NextResponse.json({ error: 'Failed to remove session files' }, { status: 500 })
    }
  }

  // Delete related records then the session itself
  const related = await Promise.all([
    supabase.from('messages').delete().eq('session_id', id),
    supabase.from('assets').delete().eq('session_id', id),
    supabase.from('reminders').delete().eq('session_id', id),
  ])
  const relatedErr = related.find(r => r.error)?.error
  if (relatedErr) {
    console.error('[DELETE session] related-row delete failed:', relatedErr)
    return NextResponse.json({ error: 'Failed to delete session records' }, { status: 500 })
  }
  const { error: sessionErr } = await supabase.from('sessions').delete().eq('id', id)
  if (sessionErr) {
    console.error('[DELETE session] session delete failed:', sessionErr)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await readJsonBody<{
    fieldPath?: string
    value?: unknown
    isAdminOverride?: boolean
  }>(req)
  if (body instanceof NextResponse) return body
  const { fieldPath, value, isAdminOverride } = body

  if (!fieldPath) return NextResponse.json({ error: 'fieldPath required' }, { status: 400 })

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data, gap_list')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const schema = (session.schema_data as Record<string, unknown>) ?? {}
  let updated = deepSetPath(schema, fieldPath, value)

  if (isAdminOverride) {
    const meta = (updated._meta as Record<string, unknown>) ?? {}
    const overrides = (meta.admin_overrides as Record<string, boolean>) ?? {}
    updated = {
      ...updated,
      _meta: { ...meta, admin_overrides: { ...overrides, [fieldPath]: true } },
    }
  }

  // Mark the matching gap resolved when the field is now filled, so gap_list
  // stays honest for any consumer not going through computeOpenGaps. Gap fields
  // use bracket form (niches[0].x); the editor sends dot form — normalize to match.
  const gaps = (session.gap_list as GapItem[] | null) ?? null
  const filledGaps =
    gaps && isPathFilled(updated, fieldPath)
      ? gaps.map(g => (!g.resolved && normalizeGapField(g.field) === fieldPath ? { ...g, resolved: true } : g))
      : gaps

  await supabase
    .from('sessions')
    .update({
      schema_data: asJson(updated),
      ...(filledGaps ? { gap_list: asJson(filledGaps) } : {}),
    })
    .eq('id', id)

  // Refresh the downloadable MBP if this session is already approved.
  after(() => regenerateMbpIfApproved(supabase, id))

  return NextResponse.json({ success: true })
}
