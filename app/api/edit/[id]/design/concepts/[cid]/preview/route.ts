import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { parseDesignBundle } from '@/lib/design/bundle'
import { composedThemeFromFiles } from '@/lib/design/composed-theme'
import { isUuid } from '@/lib/design/input-validation'
import { getConcept } from '@/lib/design/run-store'
import { readDraftThemeTexts } from '@/lib/design/theme-snapshot'
import { requireDesignAdmin } from '../../../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET — the composed theme (theme.css, overrides, fonts, treatment attributes)
// a concept would produce on the current draft, for the Studio's live scaled
// iframe (ViewportToggle). ?removeLegacy=0 previews "keep legacy overrides".
// Admin-only; read-only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(cid)) return NextResponse.json({ error: 'Invalid concept id' }, { status: 400 })
  const flag = new URL(req.url).searchParams.get('removeLegacy') ?? '1'
  if (flag !== '0' && flag !== '1') return NextResponse.json({ error: 'removeLegacy must be 0 or 1.' }, { status: 400 })

  let bundleToRepoFiles: (typeof import('@/lib/design/bundle-files'))['bundleToRepoFiles']
  try {
    ;({ bundleToRepoFiles } = await import('@/lib/design/bundle-files')) // native lightningcss — lazy
  } catch (err) {
    console.error('[design:concept:preview] failed to load the design engine', err)
    return NextResponse.json({ error: 'The design engine is unavailable right now.' }, { status: 503 })
  }

  try {
    const concept = await getConcept(createServerClient(), ctx.sessionId, cid)
    if (!concept) return NextResponse.json({ error: 'Concept not found.' }, { status: 404 })
    if (concept.bundle === null) return NextResponse.json({ error: 'This concept has no design to preview.' }, { status: 409 })
    const parsed = parseDesignBundle(concept.bundle)
    if (!parsed.ok) return NextResponse.json({ error: 'This concept can no longer be previewed.' }, { status: 422 })

    const draft = await readDraftThemeTexts(ctx.githubRepo)
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 409 })
    const { brandText, designText, overridesCss } = draft.files
    const files = bundleToRepoFiles(parsed.bundle, { brandText, designText, overridesCss }, { removeLegacy: flag === '1' })
    if (!files.ok) return NextResponse.json({ error: files.errors.join(' ') }, { status: 422 })
    return NextResponse.json({ theme: composedThemeFromFiles(files.files) })
  } catch (err) {
    return internalError('design:concept:preview', err, 'Failed to preview the concept')
  }
}
