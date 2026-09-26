import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { parseThemeForMbp, syncMbpTheme } from '@/lib/design/sync-mbp-theme'
import { readDraftThemeSnapshot, themeTextsFromSnapshot } from '@/lib/design/theme-snapshot'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SyncMbpResponse {
  ok: true
}

// POST — "Sync palette & fonts to MBP": the human-clicked path that mirrors
// the DRAFT's current palette (brand.primaryColors + content_jobs.palette) and
// fonts (brand.typography) into the profile. Chat commits never do this on
// their own (CLAUDE.md: an interactive AI session never mutates schema_data),
// and after a chat commit the draft is in sync with the latest version, so
// capture has nothing to record — this button is how a chat-made design
// reaches the MBP. Admin-only (requireDesignAdmin). No repo write.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    const draft = themeTextsFromSnapshot(await readDraftThemeSnapshot(ctx.githubRepo))
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 409 })
    const theme = parseThemeForMbp(draft.files.brandText, draft.files.designText)
    if (!theme.ok) return NextResponse.json({ error: theme.error }, { status: 409 })
    const synced = await syncMbpTheme(createServerClient(), {
      sessionId: ctx.sessionId,
      jobId: ctx.jobId,
      brand: theme.brand,
      design: theme.design,
    })
    if (!synced) return NextResponse.json({ error: 'Couldn’t update the MBP — try again.' }, { status: 503 })
    const response: SyncMbpResponse = { ok: true }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:sync-mbp', err, 'Failed to sync the design to the MBP')
  }
}
