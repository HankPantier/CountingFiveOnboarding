import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { computeDrift, draftFontsModuleKind, isFontsModuleStale, isThemeCssStale, mergeAppliedBlobs, themeFilePaths, toBlobMap } from '@/lib/design/drift'
import { readDesignCapabilities } from '@/lib/design/capabilities-read'
import { fontsUnlocked } from '@/lib/design/capabilities'
import { readDraftThemeSnapshot } from '@/lib/design/theme-snapshot'
import { getBaselineOrCreate, listInputs, listVersions, readSessionSchema, type BaselineSource } from '@/lib/design/store'
import { signDesignPaths } from '@/lib/design/storage'
import { buildInputSuggestions, toInputDto, toVersionDto, versionThumbnailPaths } from '@/lib/design/studio-dto'
import type { BaselineStatus, DesignStudioState } from '@/lib/design/studio-types'
import { loadLatestRunDto } from '@/lib/design/run-view'
import type { DesignRunDto } from '@/lib/design/run-types'
import { requireDesignAdmin } from './_design'

export const runtime = 'nodejs'

const NO_THEME_FILES = 'This site has no brand.json / design.json yet — there is no design to import as v0.'

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
    const [snapshot, schema, inputs] = await Promise.all([
      readDraftThemeSnapshot(ctx.githubRepo),
      readSessionSchema(supabase, ctx.sessionId),
      listInputs(supabase, ctx.sessionId),
    ])
    // After the snapshot (it ensured the draft branch). The DRAFT marker decides
    // which files the theme contract tracks (the fonts module on L2+).
    const draftCaps = await readDesignCapabilities(ctx.githubRepo)
    const themePaths = themeFilePaths(draftCaps)

    const brandText = snapshot.texts[BRAND_PATH]
    const designText = snapshot.texts[DESIGN_PATH]
    let source: BaselineSource
    if (brandText && designText) {
      // Lazy-imported: bundle-files pulls in the sanitizer (lightningcss),
      // which needs its own outputFileTracingIncludes entry (R7) and must
      // never be a static import in a route module.
      try {
        const { bundleFromRepoFiles } = await import('@/lib/design/bundle-files')
        source = bundleFromRepoFiles(
          { brandText, designText, overridesCss: snapshot.texts[OVERRIDES_PATH] ?? '' },
          { name: 'Baseline', source: 'baseline' }
        )
      } catch (err) {
        console.error('[design:state] bundle-files unavailable:', err)
        source = { ok: false, errors: ['Could not read the current theme — try again shortly.'] }
      }
    } else {
      source = { ok: false, errors: [NO_THEME_FILES] }
    }

    const outcome = await getBaselineOrCreate(supabase, {
      sessionId: ctx.sessionId,
      createdBy: ctx.adminId,
      source,
      appliedBlobs: mergeAppliedBlobs(snapshot.shas, {}, themePaths),
    })
    const baseline: BaselineStatus =
      outcome.status === 'error' ? { status: 'error', error: outcome.error } : { status: 'ok', created: outcome.status === 'created' }

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
