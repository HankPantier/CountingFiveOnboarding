import { NextResponse } from 'next/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  readFile,
  writeFiles,
  FileNotFoundError,
  StaleShaError,
} from '@/lib/github/repo-files'
import {
  patchBrandPalette,
  patchDesignTypography,
  patchDesignFlags,
  PALETTE_ROLES,
  type PalettePatch,
  type TypographyPatch,
  type DesignFlagsPatch,
} from '@/lib/editor/theme-edit'
import { generateThemeCss, checkThemeContrast } from '@/lib/content/theme-css-generator'
import { deepSetPath } from '@/lib/mbp/schema-write'
import { asJson } from '@/lib/supabase/json-typed'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import type { PaletteData } from '@/types/palette'
import {
  BRAND_PATH,
  DESIGN_PATH,
  OVERRIDES_PATH,
  THEME_CSS_PATH,
  normalizeTypography,
  type ThemeSources,
} from './_theme'

export const runtime = 'nodejs'

// Read a text file on draft, returning a fallback when it's absent (a client
// packaged before a given file was introduced).
async function readOr(githubRepo: string, path: string, fallback: string): Promise<string> {
  try {
    return (await readFile(githubRepo, path, DRAFT_BRANCH)).content
  } catch (err) {
    if (err instanceof FileNotFoundError) return fallback
    throw err
  }
}

// GET the client site's current theme sources from the draft branch — feeds the
// Theme Studio preview + the token panel. Admin-only, same gate as the theme chat.
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
    await ensureDraftBranch(githubRepo)
    const brandText = await readOr(githubRepo, BRAND_PATH, '')
    const designText = await readOr(githubRepo, DESIGN_PATH, '')
    if (!brandText || !designText) {
      return NextResponse.json(
        { error: 'This site has no brand.json / design.json yet — theme editing is unavailable.' },
        { status: 409 }
      )
    }
    let brand: BrandJson
    let design: DesignJson
    try {
      brand = JSON.parse(brandText) as BrandJson
      design = JSON.parse(designText) as DesignJson
    } catch {
      return NextResponse.json({ error: 'brand.json / design.json is not valid JSON.' }, { status: 422 })
    }

    const themeCss = await readOr(githubRepo, THEME_CSS_PATH, '')
    const overridesCss = await readOr(githubRepo, OVERRIDES_PATH, '')

    const sources: ThemeSources = {
      palette: brand.palette,
      typography: normalizeTypography(design.typography),
      roundness: design.roundness,
      density: design.density,
      visualFeel: design.visualFeel,
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
      spacing: design.spacing,
      radius: design.radius,
      themeCss,
      overridesCss,
    }
    return NextResponse.json(sources)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load theme sources' },
      { status: 500 }
    )
  }
}

type ThemePatchBody = { palette?: PalettePatch; typography?: TypographyPatch; flags?: DesignFlagsPatch }

// Build the free-text MBP summary the operator sees on the profile.
function paletteSummary(palette: BrandJson['palette']): string {
  return PALETTE_ROLES.map((r) => `${r}: ${palette[r]}`).join(', ')
}
function typographySummary(t: DesignJson['typography']): string {
  return `Headings: ${t.headingFont} · Body: ${t.bodyFont} · Accent: ${t.accentFont}`
}

// Re-key the structured content_jobs palette from the new hexes, preserving any
// existing swatch names (fall back to the role name).
function toPaletteData(palette: BrandJson['palette'], existing: PaletteData | null): PaletteData {
  const out = {} as PaletteData
  for (const role of PALETTE_ROLES) {
    out[role] = { hex: palette[role], name: existing?.[role]?.name ?? role }
  }
  return out
}

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
    // changed source files together so nothing lands half-applied.
    const themeCss = generateThemeCss(brand, design)
    const changes: { path: string; content: string; expectedSha?: string }[] = [
      { path: THEME_CSS_PATH, content: themeCss, expectedSha: themeFile.sha || undefined },
    ]
    if (brandChanged) changes.push({ path: BRAND_PATH, content: brandText, expectedSha: brandFile.sha })
    if (designChanged) changes.push({ path: DESIGN_PATH, content: designText, expectedSha: designFile.sha })

    const changedParts = [
      brandChanged && 'palette',
      fontsChanged && 'fonts',
      treatmentsChanged && 'treatments',
    ].filter(Boolean) as string[]
    await writeFiles(githubRepo, changes, DRAFT_BRANCH, `Theme: update ${changedParts.join(' + ')} (${adminEmail ?? 'admin'})`, {
      authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
      authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
    })

    // MBP sync: keep the profile in step with the site.
    const supabase = createServerClient()
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', sessionId)
      .single()
    if (session) {
      let schema = (session.schema_data ?? {}) as Record<string, unknown>
      if (brandChanged) schema = deepSetPath(schema, 'brand.primaryColors', paletteSummary(brand.palette))
      if (designChanged) schema = deepSetPath(schema, 'brand.typography', typographySummary(normalizeTypography(design.typography)))
      await supabase.from('sessions').update({ schema_data: asJson(schema) }).eq('id', sessionId)
    }
    if (brandChanged) {
      const { data: job } = await supabase
        .from('content_jobs')
        .select('palette')
        .eq('id', jobId)
        .maybeSingle()
      const nextPalette = toPaletteData(brand.palette, (job?.palette as PaletteData | null) ?? null)
      await supabase.from('content_jobs').update({ palette: asJson(nextPalette) }).eq('id', jobId)
    }

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
    // A concurrent theme edit (another tab / the theme chat) moved one of the
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save theme changes' },
      { status: 500 }
    )
  }
}
