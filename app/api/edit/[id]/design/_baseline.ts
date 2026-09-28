import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { mergeAppliedBlobs, themeFilePaths } from '@/lib/design/drift'
import { readDesignCapabilities } from '@/lib/design/capabilities-read'
import { readDraftThemeSnapshot, type DraftThemeSnapshot } from '@/lib/design/theme-snapshot'
import { getBaselineOrCreate, type BaselineSource } from '@/lib/design/store'
import type { BaselineStatus } from '@/lib/design/studio-types'
import type { DesignCapabilities } from '@/lib/design/run-types'
import type { EditContext } from '../_helpers'

const NO_THEME_FILES = 'This site has no brand.json / design.json yet — there is no design to import as v0.'

export type EnsuredBaseline = {
  snapshot: DraftThemeSnapshot
  draftCaps: DesignCapabilities
  themePaths: ReturnType<typeof themeFilePaths>
  baseline: BaselineStatus
}

// Imports the current draft as version v0 when the session has no version yet
// (a chat commit 409s without one). Shared by the Studio's state load and the
// editor's Design drawer, which can open before the Studio ever has.
export async function ensureDesignBaseline(
  supabase: SupabaseClient<Database>,
  ctx: Pick<EditContext, 'sessionId' | 'githubRepo' | 'adminId'>
): Promise<EnsuredBaseline> {
  const snapshot = await readDraftThemeSnapshot(ctx.githubRepo)
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
      console.error('[design:baseline] bundle-files unavailable:', err)
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
  return { snapshot, draftCaps, themePaths, baseline }
}
