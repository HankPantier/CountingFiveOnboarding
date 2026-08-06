import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { getCurrentUser } from '@/lib/auth/access'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  readFile,
  FileNotFoundError,
} from '@/lib/github/repo-files'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import {
  BRAND_PATH,
  DESIGN_PATH,
  OVERRIDES_PATH,
  THEME_CSS_PATH,
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

  const user = await getCurrentUser()
  if (!user || !user.isAdmin) {
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
      typography: design.typography,
      roundness: design.roundness,
      density: design.density,
      visualFeel: design.visualFeel,
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
