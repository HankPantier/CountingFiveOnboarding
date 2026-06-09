import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { DRAFT_BRANCH, readFile, writeFile, FileNotFoundError } from '@/lib/github/repo-files'
import type { SessionSchema } from '@/types/session-schema'
import type { BrandAmendment } from '@/lib/content/brand-fit'

export const runtime = 'nodejs'

// Apply an admin-approved brand amendment: the documented voice evolves to
// cover a direction the brand-fit check flagged. schema_data.brand is the
// operative source (drives all future generation); content/brand.md on the
// draft branch gets a dated human-readable record (best-effort).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Brand amendments mutate the MBP (schema_data.brand) directly, so they are
  // admin-only — managers get a read-only MBP.
  const adminAuth = await requireAdminUser()
  if (adminAuth instanceof NextResponse) return adminAuth

  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let amendment: BrandAmendment
  try {
    const body = (await req.json()) as BrandAmendment
    if (!body || typeof body.summary !== 'string' || !body.summary.trim()) {
      return NextResponse.json({ error: 'Amendment summary is required' }, { status: 400 })
    }
    amendment = {
      summary: body.summary.trim(),
      toneAdjectivesAdd: Array.isArray(body.toneAdjectivesAdd)
        ? body.toneAdjectivesAdd.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [],
      toneToAvoidRemove: Array.isArray(body.toneToAvoidRemove)
        ? body.toneToAvoidRemove.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [],
      aspirationalToneAppend:
        typeof body.aspirationalToneAppend === 'string' && body.aspirationalToneAppend.trim()
          ? body.aspirationalToneAppend.trim()
          : null,
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', ctx.sessionId)
    .single()
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Read-merge-write on schema_data.brand (pattern: app/api/sessions/[id]).
  const schema = (session.schema_data ?? {}) as SessionSchema
  const brand = { ...(schema.brand ?? {}) } as NonNullable<SessionSchema['brand']>

  const adjectives = new Set((brand.toneAdjectives ?? []).map((a) => a.trim()).filter(Boolean))
  for (const add of amendment.toneAdjectivesAdd) adjectives.add(add)
  brand.toneAdjectives = [...adjectives]

  if (amendment.toneToAvoidRemove.length) {
    const removeSet = new Set(amendment.toneToAvoidRemove.map((t) => t.toLowerCase()))
    brand.toneToAvoid = (brand.toneToAvoid ?? []).filter((t) => !removeSet.has(t.toLowerCase()))
  }

  if (amendment.aspirationalToneAppend) {
    brand.aspirationalTone = [brand.aspirationalTone, amendment.aspirationalToneAppend]
      .filter(Boolean)
      .join(' ')
  }

  const updatedSchema = { ...schema, brand }
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ schema_data: asJson(updatedSchema) })
    .eq('id', ctx.sessionId)
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Best-effort repo record: dated bullet under "## Voice Amendments".
  let repoUpdated = false
  try {
    const doc = await readFile(ctx.githubRepo, 'content/brand.md', DRAFT_BRANCH)
    const date = new Date().toISOString().slice(0, 10)
    const details = [
      amendment.toneAdjectivesAdd.length ? `tone += ${amendment.toneAdjectivesAdd.join(', ')}` : null,
      amendment.toneToAvoidRemove.length ? `no longer avoiding: ${amendment.toneToAvoidRemove.join(', ')}` : null,
      amendment.aspirationalToneAppend ? `aspiration: ${amendment.aspirationalToneAppend}` : null,
    ].filter(Boolean).join('; ')
    const bullet = `- ${date}: ${amendment.summary}${details ? ` (${details})` : ''}`

    const next = /^## Voice Amendments$/m.test(doc.content)
      ? doc.content.replace(/^## Voice Amendments$/m, `## Voice Amendments\n\n${bullet}`).replace(/\n{3,}/g, '\n\n')
      : `${doc.content.trimEnd()}\n\n## Voice Amendments\n\n${bullet}\n`

    await writeFile(
      ctx.githubRepo,
      'content/brand.md',
      next,
      DRAFT_BRANCH,
      `Brand voice amendment via admin (${ctx.adminEmail ?? 'admin'})`,
      { expectedSha: doc.sha, authorName: 'CountingFive Admin', authorEmail: ctx.adminEmail }
    )
    repoUpdated = true
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      console.warn('[brand-amendment] content/brand.md missing — schema updated, repo record skipped')
    } else {
      console.warn('[brand-amendment] brand.md update failed (schema already updated):', err)
    }
  }

  return NextResponse.json({
    success: true,
    repoUpdated,
    brand: {
      toneAdjectives: brand.toneAdjectives,
      toneToAvoid: brand.toneToAvoid ?? [],
      aspirationalTone: brand.aspirationalTone ?? '',
    },
  })
}
