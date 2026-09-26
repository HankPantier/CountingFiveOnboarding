// Server-only. Apply a DesignBundle to a client repo's DRAFT branch as ONE
// atomic commit (brand.json, design.json, regenerated theme.css, and the
// managed design-overrides.css region), guarded by expected blob shas so a
// concurrent edit surfaces as StaleShaError (rethrown — callers map it to 409).
// Contrast is a hard gate: nothing is written if the palette fails WCAG checks.
// The MBP mirror is NOT done here — callers invoke syncMbpTheme() after.
//
// `base` (optional): the theme files the caller built on, as immutable blob
// shas + their texts. When given, the branch is NOT re-read (a read right after
// a commit can still return the pre-commit tip) — the bundle is rendered onto
// the base texts and EVERY existing base file is sha-guarded in the commit
// (unchanged ones ride along as same-blob guard entries; a written file absent
// from the base is guarded as must-not-exist), so the writeFiles guard is the
// only staleness check (StaleShaError when the draft moved).
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { DRAFT_BRANCH, ensureDraftBranch, readFile, writeFiles, FileNotFoundError } from '@/lib/github/repo-files'
import { checkThemeContrast } from '@/lib/content/theme-css-generator'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { bundleToRepoFiles } from './bundle-files'
import type { DesignBundle } from './bundle'
import type { DraftThemeSnapshot } from './theme-snapshot'

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

// A draft-branch file's text + blob sha, or null when it doesn't exist.
export async function readOptional(repo: string, path: string): Promise<{ content: string; sha: string } | null> {
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
  base?: DraftThemeSnapshot
  // Restore of a baseline / captured version: write this EXACT
  // design-overrides.css (the text that version recorded, hand CSS included)
  // instead of splicing the bundle's managed region into the current file.
  overridesVerbatim?: string
}): Promise<ApplyBundleResult> {
  const { githubRepo, bundle, removeLegacy, message, author, base, overridesVerbatim } = args
  await ensureDraftBranch(githubRepo)

  const fromBase = (p: string): { content: string; sha: string } | null => {
    const sha = base?.shas[p]
    const content = base?.texts[p as keyof DraftThemeSnapshot['texts']]
    return sha && content !== undefined ? { content, sha } : null
  }
  const read = (p: string) => (base ? Promise.resolve(fromBase(p)) : readOptional(githubRepo, p))

  const brandFile = await read(BRAND_PATH)
  const designFile = await read(DESIGN_PATH)
  if (!brandFile || !designFile) {
    return { ok: false, status: 409, error: 'This site has no brand.json / design.json yet — design changes are unavailable.' }
  }
  const themeFile = await read(THEME_CSS_PATH)
  const overridesFile = await read(OVERRIDES_PATH)

  const rendered = bundleToRepoFiles(
    bundle,
    { brandText: brandFile.content, designText: designFile.content, overridesCss: overridesFile?.content ?? '' },
    // A verbatim overrides file replaces the current one wholesale, so the
    // current file's region (even a malformed one) is irrelevant.
    { removeLegacy: overridesVerbatim !== undefined ? true : removeLegacy }
  )
  if (!rendered.ok) return { ok: false, status: 422, error: rendered.errors.join(' ') }
  if (overridesVerbatim !== undefined) rendered.files.overridesCss = overridesVerbatim

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
    // Base mode: a file absent from the base must still be absent at commit
    // time (null = must-not-exist), so a concurrent creation is a StaleShaError.
    // Without a base, an absent file is written unguarded (today's behaviour).
    .map((c) => ({ path: c.path, content: c.next, expectedSha: c.current?.sha || (base ? null : undefined) }))

  if (changes.length === 0) {
    return { ok: true, commitSha: null, blobs: {}, changedPaths: [], brand, design, css: rendered.css }
  }

  const changedPaths = changes.map((c) => c.path)
  // Base mode: guard the unchanged base files too (same content = same blob,
  // so the tree is untouched for them) — the whole base must still be current.
  const guards = base
    ? candidates
        .filter((c) => c.current !== null && !changedPaths.includes(c.path))
        .map((c) => ({ path: c.path, content: c.current?.content ?? '', expectedSha: c.current?.sha }))
    : []

  const written = await writeFiles(githubRepo, [...changes, ...guards], DRAFT_BRANCH, message, {
    authorName: author.name,
    authorEmail: author.email,
  })
  const blobs: Record<string, string> = {}
  for (const p of changedPaths) if (written.blobs[p]) blobs[p] = written.blobs[p]
  return { ok: true, commitSha: written.commitSha, blobs, changedPaths, brand, design, css: rendered.css }
}
