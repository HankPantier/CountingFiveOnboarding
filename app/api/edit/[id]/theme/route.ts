import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { DRAFT_BRANCH, ensureDraftBranch, readFile, writeFiles, FileNotFoundError, StaleShaError } from '@/lib/github/repo-files'
import {
  patchBrandPalette,
  patchDesignTypography,
  patchDesignFlags,
  type PalettePatch,
  type TypographyPatch,
  type DesignFlagsPatch,
} from '@/lib/editor/theme-edit'
import { generateThemeCss, checkThemeContrast } from '@/lib/content/theme-css-generator'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { syncMbpTheme } from '@/lib/design/sync-mbp-theme'
import { loadDraftThemeSources } from '@/lib/design/theme-sources'
import { BRAND_PATH, DESIGN_PATH, THEME_CSS_PATH, normalizeTypography } from './_theme'

export const runtime = 'nodejs'

// GET the client site's current theme sources from the draft branch — feeds the
// Theme Studio preview + the token panel. Admin-only (same gate as PATCH).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo } = ctx

  const user = ctx.user
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const loaded = await loadDraftThemeSources(githubRepo)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    return NextResponse.json(loaded.sources)
  } catch (err) {
    return internalError('theme:get', err, 'Failed to load theme sources')
  }
}

type ThemePatchBody = { palette?: PalettePatch; typography?: TypographyPatch; flags?: DesignFlagsPatch }

// PATCH — direct (non-AI) theme edits from the Theme Studio pickers. Applies a
// palette and/or typography change: commits brand.json/design.json + the
// regenerated theme.css to the draft branch in ONE commit, then syncs the MBP
// (free-text brand fields + structured content_jobs.palette). Admin-only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo, sessionId, jobId, adminEmail, adminName } = ctx

  const user = ctx.user
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as ThemePatchBody
  if (!body.palette && !body.typography && !body.flags) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const load = async (path: string, optional = false): Promise<{ content: string; sha: string } | null> => {
    try {
      const b = await readFile(githubRepo, path, DRAFT_BRANCH)
      return { content: b.content, sha: b.sha }
    } catch (err) {
      if (optional && err instanceof FileNotFoundError) return { content: '', sha: '' }
      if (err instanceof FileNotFoundError) return null
      throw err
    }
  }

  try {
    await ensureDraftBranch(githubRepo)
    const brandFile = await load(BRAND_PATH)
    const designFile = await load(DESIGN_PATH)
    if (!brandFile || !designFile) {
      return NextResponse.json(
        { error: 'This site has no brand.json / design.json yet — theme editing is unavailable.' },
        { status: 409 }
      )
    }
    const themeFile = (await load(THEME_CSS_PATH, true))!

    let brandText = brandFile.content
    let designText = designFile.content
    let brand = JSON.parse(brandText) as BrandJson
    let design = JSON.parse(designText) as DesignJson
    let brandChanged = false
    let designChanged = false
    let fontsChanged = false
    let treatmentsChanged = false

    if (body.palette) {
      const res = patchBrandPalette(brandText, body.palette)
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 })
      brand = res.brand
      brandText = res.next
      brandChanged = res.changed
    }
    if (body.typography) {
      const res = patchDesignTypography(designText, body.typography)
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 })
      design = res.design
      designText = res.next
      fontsChanged = res.changed
    }
    if (body.flags) {
      const res = patchDesignFlags(designText, body.flags)
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 })
      design = res.design
      designText = res.next
      treatmentsChanged = res.changed
    }
    designChanged = fontsChanged || treatmentsChanged

    if (!brandChanged && !designChanged) {
      return NextResponse.json({ ok: true, note: 'No change — those values were already set.' })
    }

    // Regenerate theme.css from the final brand + design, then commit the
    // source files together so nothing lands half-applied. EVERY input is
    // guarded: theme.css is derived from both brand.json and design.json, so
    // the unchanged one rides along with its current content (a no-op write)
    // purely to lock its sha, and an absent theme.css must still be absent (a
    // concurrent Design Studio apply that created it wins → 409, not clobbered).
    const themeCss = generateThemeCss(brand, design)
    const changes: { path: string; content: string; expectedSha: string | null }[] = [
      { path: THEME_CSS_PATH, content: themeCss, expectedSha: themeFile.sha || null },
      { path: BRAND_PATH, content: brandChanged ? brandText : brandFile.content, expectedSha: brandFile.sha },
      { path: DESIGN_PATH, content: designChanged ? designText : designFile.content, expectedSha: designFile.sha },
    ]

    const changedParts = [
      brandChanged && 'palette',
      fontsChanged && 'fonts',
      treatmentsChanged && 'treatments',
    ].filter(Boolean) as string[]
    await writeFiles(githubRepo, changes, DRAFT_BRANCH, `Theme: update ${changedParts.join(' + ')} (${adminEmail ?? 'admin'})`, {
      authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
      authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
    })

    // MBP sync: keep the profile in step with the site (best-effort).
    await syncMbpTheme(createServerClient(), {
      sessionId,
      jobId,
      brand: brandChanged ? brand : undefined,
      design: designChanged ? design : undefined,
    })

    return NextResponse.json({
      ok: true,
      palette: brand.palette,
      typography: normalizeTypography(design.typography),
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
      contrastWarnings: checkThemeContrast(brand).map(
        (f) => `${f.name}: ${f.ratio.toFixed(2)}:1 (need ${f.minRatio}:1)`
      ),
    })
  } catch (err) {
    // A concurrent theme edit (another tab / a Design Studio apply) moved one of the
    // files since we read it — a conflict, not a server error.
    if (err instanceof StaleShaError) {
      return NextResponse.json(
        {
          error: 'The theme changed in another window. Reload the Theme Studio and try again.',
          stale: true,
          path: err.path,
        },
        { status: 409 }
      )
    }
    return internalError('theme:patch', err, 'Failed to save theme changes')
  }
}
