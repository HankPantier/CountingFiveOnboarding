import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { computeDrift, draftFontsModuleKind, isFontsModuleStale, isThemeCssStale, toBlobMap } from '@/lib/design/drift'
import { fontsUnlocked } from '@/lib/design/capabilities'
import { listInputs, listVersions, readSessionSchema } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { buildInputSuggestions, toInputDto, toVersionDto, versionThumbnailPaths } from '@/lib/design/studio-dto'
import type { DesignStudioState } from '@/lib/design/studio-types'
import { loadLatestRunDto } from '@/lib/design/run-view'
import type { DesignRunDto } from '@/lib/design/run-types'
import { requireDesignAdmin } from './_design'
import { ensureDesignBaseline } from './_baseline'

export const runtime = 'nodejs'

// GET — the Design Studio's full state for one client: versions (newest
// first), drift of the draft theme vs the latest version, whether theme.css is
// stale (and, on L2+ drafts, whether the fonts module is), the design inputs (with signed thumbnails) and MBP-derived input
// suggestions. On the first load it imports the current draft as v0; if that
// import fails (malformed override markers, an uncurated font, …) the state
// still loads with baseline.status = 'error'. Admin-only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    const supabase = createServerClient()
    const [{ snapshot, draftCaps, themePaths, baseline }, schema, inputs] = await Promise.all([
      ensureDesignBaseline(supabase, ctx),
      readSessionSchema(supabase, ctx.sessionId),
      listInputs(supabase, ctx.sessionId),
    ])

    const versionRows = await listVersions(supabase, ctx.sessionId)
    const latestRow = versionRows[0] ?? null
    const drift = computeDrift(
      snapshot.shas,
      latestRow ? { versionNo: latestRow.version_no, appliedBlobs: toBlobMap(latestRow.applied_blobs) } : null,
      themePaths
    )

    const paths = [
      ...inputs.flatMap((i) => (i.storage_path ? [i.storage_path] : [])),
      ...versionThumbnailPaths(versionRows),
    ]
    let signed: Record<string, string> = {}
    try {
      signed = await signDesignPaths(supabase, paths)
    } catch (err) {
      console.warn('[design:state] signDesignPaths failed, continuing without thumbnails:', err)
    }
    const versions = versionRows.map((v) => toVersionDto(v, signed))

    // The latest run is best-effort for the page load (the Studio still opens
    // if it can't be read); the runs route reports errors while polling.
    let run: DesignRunDto | null = null
    try {
      run = await loadLatestRunDto(supabase, ctx.sessionId)
    } catch (err) {
      console.warn('[design:state] latest run unavailable:', err)
    }

    const state: DesignStudioState = {
      versions,
      latest: versions[0] ?? null,
      drift,
      baseline,
      themeCssStale: isThemeCssStale(snapshot.texts),
      fontsModuleStale: fontsUnlocked(draftCaps) ? isFontsModuleStale(snapshot.texts) : null,
      fontsModuleKind: fontsUnlocked(draftCaps) ? draftFontsModuleKind(snapshot.texts) : null,
      inputs: inputs.map((i) => toInputDto(i, signed)),
      suggestions: buildInputSuggestions(schema),
      run,
    }
    return NextResponse.json(state)
  } catch (err) {
    return internalError('design:state', err, 'Failed to load the Design Studio')
  }
}
