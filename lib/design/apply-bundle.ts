// Server-only. Apply a DesignBundle to a client repo's DRAFT branch as ONE
// atomic commit (brand.json, design.json, regenerated theme.css, and the
// managed design-overrides.css region), guarded by expected blob shas so a
// concurrent edit surfaces as StaleShaError (rethrown — callers map it to 409).
// Contrast is a hard gate: nothing is written if the palette fails WCAG checks.
// The MBP mirror is NOT done here — callers invoke syncMbpTheme() after.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { DRAFT_BRANCH, ensureDraftBranch, readFile, writeFiles, FileNotFoundError } from '@/lib/github/repo-files'
import { checkThemeContrast } from '@/lib/content/theme-css-generator'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { bundleToRepoFiles } from './bundle-files'
import type { DesignBundle } from './bundle'

export type ApplyBundleResult =
  | {
      ok: true
      commitSha: string | null
      blobs: Record<string, string>
      changedPaths: string[]
      brand: BrandJson
      design: DesignJson
      // The sanitized, canonical CSS actually written (rendered.css) — later
      // phases store exactly this, not the bundle's pre-sanitize css.
      css: DesignBundle['css']
    }
  | { ok: false; status: 409 | 422; error: string }

async function readOptional(repo: string, path: string): Promise<{ content: string; sha: string } | null> {
  try {
    const f = await readFile(repo, path, DRAFT_BRANCH)
    return { content: f.content, sha: f.sha }
  } catch (err) {
    if (err instanceof FileNotFoundError) return null
    throw err
  }
}

export async function applyBundleToDraft(args: {
  githubRepo: string
  bundle: DesignBundle
  removeLegacy: boolean
  message: string
  author: { name: string; email: string }
}): Promise<ApplyBundleResult> {
  const { githubRepo, bundle, removeLegacy, message, author } = args
  await ensureDraftBranch(githubRepo)

  const brandFile = await readOptional(githubRepo, BRAND_PATH)
  const designFile = await readOptional(githubRepo, DESIGN_PATH)
  if (!brandFile || !designFile) {
    return { ok: false, status: 409, error: 'This site has no brand.json / design.json yet — design changes are unavailable.' }
  }
  const themeFile = await readOptional(githubRepo, THEME_CSS_PATH)
  const overridesFile = await readOptional(githubRepo, OVERRIDES_PATH)

  const rendered = bundleToRepoFiles(
    bundle,
    { brandText: brandFile.content, designText: designFile.content, overridesCss: overridesFile?.content ?? '' },
    { removeLegacy }
  )
  if (!rendered.ok) return { ok: false, status: 422, error: rendered.errors.join(' ') }

  const brand = JSON.parse(rendered.files.brandText) as BrandJson
  const design = JSON.parse(rendered.files.designText) as DesignJson

  const contrast = checkThemeContrast(brand)
  if (contrast.length > 0) {
    const detail = contrast.map((f) => `${f.name}: ${f.ratio.toFixed(2)}:1 (need ${f.minRatio}:1)`).join('; ')
    return { ok: false, status: 422, error: `The palette fails contrast checks — ${detail}.` }
  }

  const candidates: { path: string; next: string; current: { content: string; sha: string } | null }[] = [
    { path: BRAND_PATH, next: rendered.files.brandText, current: brandFile },
    { path: DESIGN_PATH, next: rendered.files.designText, current: designFile },
    { path: THEME_CSS_PATH, next: rendered.files.themeCss, current: themeFile },
    { path: OVERRIDES_PATH, next: rendered.files.overridesCss, current: overridesFile },
  ]
  const changes = candidates
    .filter((c) => c.next !== (c.current?.content ?? null))
    // An absent overrides file that would stay empty is not a change.
    .filter((c) => !(c.current === null && c.next === ''))
    .map((c) => ({ path: c.path, content: c.next, expectedSha: c.current?.sha || undefined }))

  if (changes.length === 0) {
    return { ok: true, commitSha: null, blobs: {}, changedPaths: [], brand, design, css: rendered.css }
  }

  const { commitSha, blobs } = await writeFiles(githubRepo, changes, DRAFT_BRANCH, message, {
    authorName: author.name,
    authorEmail: author.email,
  })
  return { ok: true, commitSha, blobs, changedPaths: changes.map((c) => c.path), brand, design, css: rendered.css }
}
