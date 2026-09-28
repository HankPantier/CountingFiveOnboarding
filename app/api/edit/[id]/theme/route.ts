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
  patchDesignLayout,
  type PalettePatch,
  type TypographyPatch,
  type DesignFlagsPatch,
} from '@/lib/editor/theme-edit'
import { generateThemeCss, checkThemeContrast, checkActionContrast, formatContrastFailure } from '@/lib/content/theme-css-generator'
import { FALLBACK_PALETTE } from '@/lib/content/deliverable-defaults'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { syncMbpTheme } from '@/lib/design/sync-mbp-theme'
import { logoSizeOf } from '@/lib/design/logo-size'
import { loadDraftThemeSources } from '@/lib/design/theme-sources'
import { readDesignCapabilities, readEffectiveCapabilities } from '@/lib/design/capabilities-read'
import { LAYOUT_LOCKED_REASON, fontsUnlocked, layoutPresetsUnlocked } from '@/lib/design/capabilities'
import { normalizeLayoutPresets, type LayoutPresets } from '@/lib/design/layout-presets'
import { FONTS_MODULE_PATH } from '@/lib/design/drift'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { BRAND_PATH, DESIGN_PATH, THEME_CSS_PATH, normalizeTypography } from './_theme'

export const runtime = 'nodejs'

// The Controls' Layout presets follow the EFFECTIVE tier (draft marker ∩ the
// deployed shell), like every Design Studio gate. Never throws: a failed read
// keeps them disabled with a reason.
async function layoutLockReason(githubRepo: string, jobId: string): Promise<string | null> {
  try {
    const { effective } = await readEffectiveCapabilities({ githubRepo, jobId })
    return layoutPresetsUnlocked(effective) ? null : LAYOUT_LOCKED_REASON
  } catch (err) {
    console.warn('[theme] capability read failed; layout presets disabled', err)
    return 'Couldn’t check this site’s template capabilities — reload to try again.'
  }
}

// GET the client site's current theme sources from the draft branch — feeds the
// Theme Studio preview + the token panel. Admin-only (same gate as PATCH).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo, jobId } = ctx

  const user = ctx.user
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Independent reads: the capability handshake (never throws) runs
    // alongside the draft theme-source reads.
    const [loaded, layoutLock] = await Promise.all([loadDraftThemeSources(githubRepo), layoutLockReason(githubRepo, jobId)])
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    return NextResponse.json({ ...loaded.sources, layoutLock })
  } catch (err) {
    return internalError('theme:get', err, 'Failed to load theme sources')
  }
}

// regenerate: rewrite theme.css (+ the fonts module on L2+) from the CURRENT
// brand.json + design.json with no value change — the "Regenerate theme files"
// action on the Design Studio stale notices.
// allowFallbackPalette: the operator confirmed regenerating a site whose
// brand.json is still FALLBACK_PALETTE.
type ThemePatchBody = {
  palette?: PalettePatch
  typography?: TypographyPatch
  flags?: DesignFlagsPatch
  // design.json layout presets (template 2026.09.9) — refused (422) unless the
  // EFFECTIVE tier has `layout-presets`.
  layout?: LayoutPresets
  regenerate?: boolean
  allowFallbackPalette?: boolean
}

function isFallbackPalette(p: BrandJson['palette'] | undefined): boolean {
  if (!p) return false
  return (Object.keys(FALLBACK_PALETTE) as (keyof typeof FALLBACK_PALETTE)[]).every(
    (k) => typeof p[k] === 'string' && p[k].toLowerCase() === FALLBACK_PALETTE[k].hex.toLowerCase()
  )
}

// PATCH — direct (non-AI) theme edits from the Theme Studio pickers. Applies a
// palette and/or typography change: commits brand.json/design.json + the
// regenerated theme.css (+ on L2+ drafts the regenerated fonts module) to the
// draft branch in ONE commit, then syncs the MBP
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
  const regenerate = body.regenerate === true
  if (!body.palette && !body.typography && !body.flags && !body.layout && !regenerate) {
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
    if (body.layout) {
      const lock = await layoutLockReason(githubRepo, jobId)
      if (lock) return NextResponse.json({ error: lock }, { status: 422 })
    }
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
    let layoutChanged = false

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
    if (body.layout) {
      const res = patchDesignLayout(designText, body.layout)
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 })
      design = res.design
      designText = res.next
      layoutChanged = res.changed
    }
    designChanged = fontsChanged || treatmentsChanged || layoutChanged

    if (!brandChanged && !designChanged && !regenerate) {
      return NextResponse.json({ ok: true, note: 'No change — those values were already set.' })
    }

    // Regenerate theme.css from the final brand + design, then commit the
    // source files together so nothing lands half-applied. EVERY input is
    // guarded: theme.css is derived from both brand.json and design.json, so
    // the unchanged one rides along with its current content (a no-op write)
    // purely to lock its sha, and an absent theme.css must still be absent (a
    // concurrent Design Studio apply that created it wins → 409, not clobbered).
    const themeCss = generateThemeCss(brand, design)
    let derivedUnchanged = themeCss === themeFile.content
    const changes: { path: string; content: string; expectedSha: string | null }[] = [
      { path: THEME_CSS_PATH, content: themeCss, expectedSha: themeFile.sha || null },
      { path: BRAND_PATH, content: brandChanged ? brandText : brandFile.content, expectedSha: brandFile.sha },
      { path: DESIGN_PATH, content: designChanged ? designText : designFile.content, expectedSha: designFile.sha },
    ]
    // L2+ drafts: the live fonts come from the generated next/font module, so
    // regenerate it from the FINAL design.json on every theme write (same as
    // theme.css) and guard it — an absent module must still be absent.
    const fontsWritable = fontsUnlocked(await readDesignCapabilities(githubRepo))
    if (fontsWritable) {
      const fontsFile = (await load(FONTS_MODULE_PATH, true))!
      const fontsModule = generateFontsModule(normalizeTypography(design.typography)).source
      derivedUnchanged = derivedUnchanged && fontsModule === fontsFile.content
      changes.push({ path: FONTS_MODULE_PATH, content: fontsModule, expectedSha: fontsFile.sha || null })
    }

    const changedParts = [
      brandChanged && 'palette',
      fontsChanged && 'fonts',
      treatmentsChanged && 'treatments',
      layoutChanged && 'layout presets',
    ].filter(Boolean) as string[]
    const regenerateOnly = !brandChanged && !designChanged
    // An L1 draft (template marker without `fonts`) has no live-fonts module to
    // write, so a regenerate only ever touches theme.css there.
    const fontsNote = regenerateOnly && !fontsWritable ? ' The fonts module was not touched: this site’s template doesn’t unlock live fonts yet.' : ''
    // Nothing to regenerate when the derived files already match — no empty commit.
    if (regenerateOnly && derivedUnchanged) {
      return NextResponse.json({ ok: true, note: `Theme files already match brand.json + design.json.${fontsNote}` })
    }
    // Regenerating a site whose brand.json still holds the generic FALLBACK
    // palette would swap its live colours for the fallback on publish. Refuse
    // unless the operator confirmed it explicitly.
    if (regenerateOnly && themeCss !== themeFile.content && isFallbackPalette(brand.palette) && body.allowFallbackPalette !== true) {
      return NextResponse.json(
        {
          error: 'This site’s brand.json still has the fallback palette, so regenerating would switch the site to the fallback colours when you publish. Brand it first, or confirm to regenerate anyway.',
          fallbackPalette: true,
        },
        { status: 409 }
      )
    }
    const summary = regenerateOnly ? 'regenerate theme files' : `update ${changedParts.join(' + ')}`
    await writeFiles(githubRepo, changes, DRAFT_BRANCH, `Theme: ${summary} (${adminEmail ?? 'admin'})`, {
      authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
      authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
    })

    // MBP sync: keep the profile in step with the site (best-effort). A pure
    // regenerate changed no brand/design value, so there's nothing to sync.
    if (!regenerateOnly) {
      await syncMbpTheme(createServerClient(), {
        sessionId,
        jobId,
        brand: brandChanged ? brand : undefined,
        // The MBP mirrors fonts only; a layout-preset change has nothing to sync.
        design: fontsChanged || treatmentsChanged ? design : undefined,
      })
    }

    return NextResponse.json({
      ok: true,
      ...(regenerateOnly ? { note: `Regenerated the theme files on the draft from brand.json + design.json.${fontsNote}` } : {}),
      palette: brand.palette,
      typography: normalizeTypography(design.typography),
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
      logoSize: logoSizeOf(design),
      layout: normalizeLayoutPresets(design.layout),
      // Advisory, never blocking: the save above already landed, so a palette
      // that fails a pair is saved and the warning shows in the Controls. Small
      // action text is auto-corrected in theme.css (--color-action-text /
      // -on-primary), so checkActionContrast only warns for the raw action as
      // LARGE text (headline accent, stat figures, estimate) under 3:1.
      contrastWarnings: [...checkThemeContrast(brand), ...checkActionContrast(brand)].map(formatContrastFailure),
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
