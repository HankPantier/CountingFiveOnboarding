// Apply the human-approved branding proposals (palette + type pairing) to the
// managed client sites. DRY-RUN BY DEFAULT: nothing is committed, pushed or
// written to the DB without --apply.
//
//   npx tsx --env-file=.env.local scripts/apply-approved-branding.ts --work <dir>                 # dry-run, every approved site
//   npx tsx --env-file=.env.local scripts/apply-approved-branding.ts --work <dir> --slugs Accord-Advisors
//   npx tsx --env-file=.env.local scripts/apply-approved-branding.ts --work <dir> --apply [--json out.json]
//
// Per site it produces EXACTLY the bytes the Theme Studio Controls PATCH
// (app/api/edit/[id]/theme/route.ts) would: brand.json palette via
// patchBrandPalette, design.json typography (+ rebuilt googleFontsUrl) via
// patchDesignTypography, theme.css via generateThemeCss, and on L2+ repos the
// fonts module via generateFontsModule(normalizeTypography(...)). A
// "regenerate" site keeps its values and only rewrites the derived files.
//
// It never publishes the clients' pending draft edits (no draft→main). Fleet
// pattern instead (lib/fleet): commit on a fresh clone of main → local verify
// (npm ci, tsc, vitest, build, generate-fonts --check; one retry) → trial-merge
// into origin/draft (skip on conflict) → push main → merge main→draft through
// the GitHub API → wait for the Vercel status. The first site is a canary: it
// must deploy green before any other is pushed, and the run stops at the first
// failure.
//
// Versioning (after the main→draft merge): the draft's theme is recorded as a
// Design Studio `import` version (what "Capture as version" writes) so the
// Studio lists it and can restore the one before it. A session with no
// versions first gets its v0 baseline from the PRE-apply draft, so the old look
// stays restorable. Then the MBP brand fields + content_jobs.palette are synced
// (syncMbpTheme → updateSessionWithCas) and content_jobs.design_tokens is locked
// to the applied pairing, so the brand gate and the Divi export see the values.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { BrandJson } from '../types/brand-json'
import type { DesignJson } from '../types/design-json'
import type { DesignTokens } from '../types/design-tokens'
import { patchBrandPalette, patchDesignTypography, PALETTE_ROLES, type PalettePatch } from '../lib/editor/theme-edit'
import { generateThemeCss, checkThemeContrast, checkActionContrast, formatContrastFailure } from '../lib/content/theme-css-generator'
import { generateFontsModule } from '../lib/content/font-module-generator'
import { findPairing } from '../lib/content/type-pairing-catalog'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH, normalizeTypography } from '../app/api/edit/[id]/theme/_theme'
import { FONTS_MODULE_PATH, mergeAppliedBlobs, themeFilePaths } from '../lib/design/drift'
import { TEMPLATE_MARKER_PATH, fontsUnlocked, parseTemplateMarker } from '../lib/design/capabilities'
import { git, revParse, tryGit } from '../lib/fleet/git-local'
import { pool, verifyRepo, type VerifyResult } from '../lib/fleet/verify'
import { draftPreflight, mergeMainIntoDraft, pushMain, waitForVercel } from '../lib/fleet/remote'
import { runPushPhase, type PushResult } from '../lib/fleet/push-phase'

const OWNER = 'HankPantier'
const TRAILER = 'Branding-Apply'

type Palette = Record<(typeof PALETTE_ROLES)[number], string>

type SiteSpec =
  // New palette (all six roles) + a curated type pairing.
  | { repo: string; sessionId: string; mode: 'rebrand'; palette: Palette; pairingId: string }
  // Keep the live palette but darken `action` until white text reaches 4.5:1.
  | { repo: string; sessionId: string; mode: 'darken-action' }
  // Keep every value; only rewrite the derived theme files (theme.css + fonts module).
  | { repo: string; sessionId: string; mode: 'regenerate' }

// Approved 2026-09-27 (branding proposals, "NEW derivation (after)" palettes).
// Canary first. Slachta-Accounting + TruCount-CPA are skipped: no logo yet.
export const APPROVED: SiteSpec[] = [
  { repo: 'Accord-Advisors', sessionId: '94247ec6-c50f-4806-85e0-b2f425bbf52d', mode: 'rebrand', pairingId: 'classic-editorial',
    palette: { primary: '#403838', secondary: '#a31e37', complementary: '#f8e2e2', action: '#a31e37', nearBlack: '#1c1717', nearWhite: '#fef9f9' } },
  { repo: 'Abramson-Company-LLC', sessionId: '8964c91b-8d34-4012-81ac-cd630873da05', mode: 'rebrand', pairingId: 'traditional-pro',
    palette: { primary: '#782223', secondary: '#4f0008', complementary: '#ffdfdd', action: '#9d6900', nearBlack: '#211514', nearWhite: '#fef9f8' } },
  { repo: 'Aurora-Consulting-Group', sessionId: '7deb4269-964e-41ec-9457-ddbff7c91c0f', mode: 'rebrand', pairingId: 'refined-modern',
    palette: { primary: '#484042', secondary: '#ee589a', complementary: '#f7e1e8', action: '#cc377d', nearBlack: '#1c1718', nearWhite: '#fef8fa' } },
  { repo: 'Berg-Advisors', sessionId: '5eb44502-3a91-4752-986a-d3c003d24c34', mode: 'rebrand', pairingId: 'civic-editorial',
    palette: { primary: '#202f42', secondary: '#fdec55', complementary: '#d9eaff', action: '#a06700', nearBlack: '#15191d', nearWhite: '#f7fafe' } },
  { repo: 'BussCPA', sessionId: '389e0489-e621-4192-98b8-f15bd92fccf5', mode: 'rebrand', pairingId: 'corporate-clean',
    palette: { primary: '#2d2524', secondary: '#d32827', complementary: '#f8e2df', action: '#d32827', nearBlack: '#1c1716', nearWhite: '#fef9f8' } },
  { repo: 'Kinexus-CPAs-Advisors', sessionId: '12b5d935-bfba-4dba-a37b-54348e3ad976', mode: 'rebrand', pairingId: 'geometric-pro',
    palette: { primary: '#12284c', secondary: '#ff6c0d', complementary: '#dbe9ff', action: '#c34f00', nearBlack: '#131921', nearWhite: '#f8fafe' } },
  { repo: 'Stephen-P.-Pryor-CPA', sessionId: '07df2372-dbcd-4810-99ff-244ea7aeffb6', mode: 'rebrand', pairingId: 'journal',
    palette: { primary: '#261f23', secondary: '#964876', complementary: '#f5e2eb', action: '#964876', nearBlack: '#1b1719', nearWhite: '#fdf9fb' } },
  { repo: 'korbey-lague-site', sessionId: 'c2aee032-ac4c-40a0-bd00-e0699719a53c', mode: 'darken-action' },
  { repo: 'bblcpa', sessionId: '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184', mode: 'regenerate' },
]

// korbey has no Vercel project (clients.json noDeploy).
const NO_DEPLOY = new Set(['korbey-lague-site'])

// ── WCAG darkening (port of the proposal sheet's darken_to, Python colorsys HLS) ──

function luminance(hex: string): number {
  const x = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export function contrastRatio(a: string, b: string): number {
  const A = luminance(a)
  const B = luminance(b)
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05)
}
function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b)
  const minc = Math.min(r, g, b)
  const l = (minc + maxc) / 2
  if (minc === maxc) return [0, l, 0]
  const s = l <= 0.5 ? (maxc - minc) / (maxc + minc) : (maxc - minc) / (2 - maxc - minc)
  const rc = (maxc - r) / (maxc - minc)
  const gc = (maxc - g) / (maxc - minc)
  const bc = (maxc - b) / (maxc - minc)
  let h = r === maxc ? bc - gc : g === maxc ? 2 + rc - bc : 4 + gc - rc
  h = (((h / 6) % 1) + 1) % 1
  return [h, l, s]
}
function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const m1 = 2 * l - m2
  const v = (hue: number) => {
    hue = ((hue % 1) + 1) % 1
    if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6
    if (hue < 0.5) return m2
    if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6
    return m1
  }
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)]
}
// Python round(): half to even.
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}
export function darkenTo(hex: string, bg = '#ffffff', target = 4.5): string {
  const x = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255)
  const [h, l0, s] = rgbToHls(r, g, b)
  for (let l = l0; l > 0; l -= 0.005) {
    const c = '#' + hlsToRgb(h, l, s).map((v) => roundHalfEven(v * 255).toString(16).padStart(2, '0')).join('')
    if (contrastRatio(c, bg) >= target) return c
  }
  return hex
}

// ── compute the Theme Studio bytes for one clone ─────────────────────────────

export interface ComputedSite {
  spec: SiteSpec
  files: { path: string; before: string | null; after: string }[]
  brand: BrandJson
  design: DesignJson
  brandChanged: boolean
  fontsChanged: boolean
  fontsWritable: boolean
  warnings: string[]
  summary: string
}

const readOpt = (dir: string, p: string): string | null => {
  const f = path.join(dir, p)
  return existsSync(f) ? readFileSync(f, 'utf8') : null
}

export function computeSite(dir: string, spec: SiteSpec): ComputedSite {
  const brandText = readOpt(dir, BRAND_PATH)
  const designText = readOpt(dir, DESIGN_PATH)
  if (brandText === null || designText === null) throw new Error(`${spec.repo}: no brand.json / design.json`)
  let brand = JSON.parse(brandText) as BrandJson
  let design = JSON.parse(designText) as DesignJson
  let nextBrandText = brandText
  let nextDesignText = designText
  let brandChanged = false
  let fontsChanged = false
  const warnings: string[] = []
  let summary: string

  if (spec.mode === 'rebrand' || spec.mode === 'darken-action') {
    const patch: PalettePatch =
      spec.mode === 'rebrand' ? { ...spec.palette } : { action: darkenTo(brand.palette.action) }
    const res = patchBrandPalette(brandText, patch)
    if (!res.ok) throw new Error(`${spec.repo}: ${res.reason}`)
    brand = res.brand
    nextBrandText = res.next
    brandChanged = res.changed
    summary = spec.mode === 'rebrand' ? 'palette' : `action ${JSON.parse(brandText).palette.action} → ${patch.action}`
  } else {
    summary = 'regenerate theme files'
  }
  if (spec.mode === 'rebrand') {
    const pairing = findPairing(spec.pairingId)
    if (!pairing) throw new Error(`${spec.repo}: unknown pairing ${spec.pairingId}`)
    const res = patchDesignTypography(designText, { headingFont: pairing.headingFont, bodyFont: pairing.bodyFont })
    if (!res.ok) throw new Error(`${spec.repo}: ${res.reason}`)
    design = res.design
    nextDesignText = res.next
    fontsChanged = res.changed
    summary += ` + fonts ${pairing.label} (${pairing.headingFont} / ${pairing.bodyFont})`
  }

  const themeBefore = readOpt(dir, THEME_CSS_PATH)
  const themeCss = generateThemeCss(brand, design)
  const caps = parseTemplateMarker(readOpt(dir, TEMPLATE_MARKER_PATH))
  const fontsWritable = fontsUnlocked(caps)
  const files: ComputedSite['files'] = [
    { path: BRAND_PATH, before: brandText, after: nextBrandText },
    { path: DESIGN_PATH, before: designText, after: nextDesignText },
    { path: THEME_CSS_PATH, before: themeBefore, after: themeCss },
  ]
  if (fontsWritable) {
    const mod = generateFontsModule(normalizeTypography(design.typography))
    for (const w of mod.warnings) warnings.push(`fonts module: ${w}`)
    files.push({ path: FONTS_MODULE_PATH, before: readOpt(dir, FONTS_MODULE_PATH), after: mod.source })
  }
  for (const f of [...checkThemeContrast(brand), ...checkActionContrast(brand)]) warnings.push(`contrast (advisory): ${formatContrastFailure(f)}`)
  return { spec, files, brand, design, brandChanged, fontsChanged, fontsWritable, warnings, summary }
}

function numstat(before: string | null, after: string): string {
  if (before === after) return 'unchanged'
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'branding-diff-'))
  try {
    const a = path.join(tmp, 'a')
    const b = path.join(tmp, 'b')
    writeFileSync(a, before ?? '')
    writeFileSync(b, after)
    const r = spawnSync('git', ['diff', '--no-index', '--numstat', a, b], { encoding: 'utf8' })
    const [add, del] = (r.stdout.trim().split(/\s+/) as string[])
    return `${before === null ? 'added' : 'modified'} +${add ?? '?'} -${del ?? '?'}`
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ── clones ───────────────────────────────────────────────────────────────────

function freshClone(workDir: string, repo: string): string {
  const dir = path.join(workDir, repo)
  if (!existsSync(path.join(dir, '.git'))) {
    const r = spawnSync('git', ['clone', '-q', '--branch', 'main', `https://github.com/${OWNER}/${repo}.git`, dir], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`clone ${repo} failed: ${r.stderr}`)
  }
  git(dir, ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
  git(dir, ['checkout', '-q', '-B', 'main', 'refs/remotes/origin/main'])
  git(dir, ['reset', '-q', '--hard', 'refs/remotes/origin/main'])
  git(dir, ['clean', '-q', '-fd'])
  return dir
}

// ── DB (versions + MBP) — lazily imported so a dry-run needs no credentials ──

interface DbOutcome {
  baselineVersion?: { id: string; no: number; created: boolean }
  version?: { id: string; no: number }
  mbpSynced?: boolean
  tokensLocked?: boolean
  note?: string
}

async function findJob(sessionId: string): Promise<{ id: string; design_tokens: unknown } | null> {
  const { createServerClient } = await import('../lib/supabase/server')
  const { data, error } = await createServerClient()
    .from('content_jobs')
    .select('id, design_tokens')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`content_jobs read: ${error.message}`)
  return data
}

// Before any push: a session with no versions gets its v0 baseline from the
// CURRENT (pre-apply) draft, exactly as the Studio's first load would.
async function ensureBaseline(spec: SiteSpec, createdBy: string | null): Promise<DbOutcome['baselineVersion']> {
  const { createServerClient } = await import('../lib/supabase/server')
  const { getBaselineOrCreate } = await import('../lib/design/store')
  const { readDraftThemeSnapshot } = await import('../lib/design/theme-snapshot')
  const { readDesignCapabilities } = await import('../lib/design/capabilities-read')
  const { bundleFromRepoFiles } = await import('../lib/design/bundle-files')
  const githubRepo = `${OWNER}/${spec.repo}`
  const snapshot = await readDraftThemeSnapshot(githubRepo)
  const brandText = snapshot.texts[BRAND_PATH]
  const designText = snapshot.texts[DESIGN_PATH]
  if (!brandText || !designText) throw new Error('draft has no brand.json / design.json')
  const source = bundleFromRepoFiles(
    { brandText, designText, overridesCss: snapshot.texts[OVERRIDES_PATH] ?? '' },
    { name: 'Baseline', source: 'baseline' }
  )
  const themePaths = themeFilePaths(await readDesignCapabilities(githubRepo))
  const outcome = await getBaselineOrCreate(createServerClient(), {
    sessionId: spec.sessionId,
    createdBy,
    source,
    appliedBlobs: mergeAppliedBlobs(snapshot.shas, {}, themePaths),
  })
  if (outcome.status === 'error') throw new Error(`baseline: ${outcome.error}`)
  return { id: outcome.latest.id, no: outcome.latest.version_no, created: outcome.status === 'created' }
}

function tokensFor(existing: unknown, design: DesignJson, pairingId: string): DesignTokens {
  const pairing = findPairing(pairingId)
  if (!pairing) throw new Error(`unknown pairing ${pairingId}`)
  const t = normalizeTypography(design.typography)
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Partial<DesignTokens>) : {}
  return {
    ...base,
    typePairing: { id: pairing.id, label: pairing.label, headingFont: t.headingFont, bodyFont: t.bodyFont, accentFont: t.accentFont },
    roundness: design.roundness,
    density: design.density,
    visualFeel: design.visualFeel,
    ...(design.headlineStyle ? { headlineStyle: design.headlineStyle } : {}),
    ...(design.eyebrowStyle ? { eyebrowStyle: design.eyebrowStyle } : {}),
    ...(design.darkSections ? { darkSections: true } : {}),
  }
}

// After the main→draft merge: record the draft theme as an `import` version,
// then sync the MBP + lock the job's Design System.
async function recordAndSync(site: ComputedSite, draftCommit: string | null, createdBy: string | null): Promise<DbOutcome> {
  const { createServerClient } = await import('../lib/supabase/server')
  const { insertVersion } = await import('../lib/design/store')
  const { readDraftThemeSnapshot } = await import('../lib/design/theme-snapshot')
  const { readDesignCapabilities } = await import('../lib/design/capabilities-read')
  const { bundleFromRepoFiles } = await import('../lib/design/bundle-files')
  const { syncMbpTheme } = await import('../lib/design/sync-mbp-theme')
  const { asJson } = await import('../lib/supabase/json-typed')
  const { spec } = site
  const db = createServerClient()
  const out: DbOutcome = {}
  const job = await findJob(spec.sessionId)
  if (!job) {
    out.note = 'no content job for this session — the Design Studio (job-keyed) cannot open it, so no version / MBP / job sync was recorded'
    return out
  }

  const githubRepo = `${OWNER}/${spec.repo}`
  const snapshot = await readDraftThemeSnapshot(githubRepo)
  const texts = snapshot.texts
  // The draft must now hold exactly the applied bytes, or the version would lie.
  for (const f of site.files) {
    if (texts[f.path as keyof typeof texts] !== f.after) throw new Error(`draft ${f.path} does not match the applied bytes — version not recorded`)
  }
  const pairingLabel = spec.mode === 'rebrand' ? findPairing(spec.pairingId)?.label : null
  const name = spec.mode === 'rebrand' ? `Approved branding — ${pairingLabel}` : spec.mode === 'darken-action' ? 'Approved branding — AA action' : 'Regenerated theme files'
  const captured = bundleFromRepoFiles(
    { brandText: texts[BRAND_PATH]!, designText: texts[DESIGN_PATH]!, overridesCss: texts[OVERRIDES_PATH] ?? '' },
    { name, source: 'import' }
  )
  if (!captured.ok) throw new Error(`capture: ${captured.errors.join(' ')}`)
  const themePaths = themeFilePaths(await readDesignCapabilities(githubRepo))
  const version = await insertVersion(db, {
    sessionId: spec.sessionId,
    source: 'import',
    bundle: captured.bundle,
    summary: `Approved branding applied via main→draft merge: ${site.summary}`,
    appliedCommitSha: draftCommit,
    appliedBlobs: mergeAppliedBlobs(snapshot.shas, {}, themePaths),
    createdBy,
  })
  out.version = { id: version.id, no: version.version_no }

  if (spec.mode === 'regenerate') {
    out.note = 'regenerate only — no brand/design value changed, so no MBP sync (same as the Theme Studio regenerate)'
    return out
  }
  out.mbpSynced = await syncMbpTheme(db, {
    sessionId: spec.sessionId,
    jobId: job.id,
    brand: site.brandChanged ? site.brand : undefined,
    design: site.fontsChanged ? site.design : undefined,
  })
  if (spec.mode === 'rebrand') {
    const tokens = tokensFor(job.design_tokens, site.design, spec.pairingId)
    const { error } = await db.from('content_jobs').update({ design_tokens: asJson(tokens) }).eq('id', job.id)
    if (error) throw new Error(`design_tokens lock: ${error.message}`)
    out.tokensLocked = true
  }
  return out
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface Args {
  apply: boolean
  workDir: string
  slugs: string[] | null
  json: string | null
  createdBy: string | null
  canary: number
}

function parseArgs(argv: string[]): Args {
  const a: Args = { apply: false, workDir: '', slugs: null, json: null, createdBy: null, canary: 1 }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--apply') a.apply = true
    else if (k === '--work') a.workDir = argv[++i]
    else if (k === '--slugs') a.slugs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--json') a.json = argv[++i]
    else if (k === '--created-by') a.createdBy = argv[++i]
    else if (k === '--canary') a.canary = Number(argv[++i])
    else throw new Error(`unknown argument ${k}`)
  }
  if (!a.workDir) throw new Error('--work <dir> is required (local clones live there)')
  return a
}

interface SiteReport {
  repo: string
  summary: string
  files: { path: string; change: string }[]
  warnings: string[]
  commit?: string
  verify?: Pick<VerifyResult, 'ok' | 'attempts' | 'failedStep' | 'tail'>
  push?: PushResult
  db?: DbOutcome
  error?: string
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const specs = args.slugs ? APPROVED.filter((s) => args.slugs!.includes(s.repo)) : APPROVED
  if (args.slugs && specs.length !== args.slugs.length) throw new Error('an --slugs name is not in the approved list')
  const reports = new Map<string, SiteReport>()
  const computed = new Map<string, ComputedSite>()

  console.log(`${args.apply ? 'APPLY' : 'DRY-RUN'} — ${specs.length} site(s)\n`)
  for (const spec of specs) {
    const dir = freshClone(args.workDir, spec.repo)
    const site = computeSite(dir, spec)
    computed.set(spec.repo, site)
    const rep: SiteReport = {
      repo: spec.repo,
      summary: site.summary,
      files: site.files.map((f) => ({ path: f.path, change: numstat(f.before, f.after) })),
      warnings: site.warnings,
    }
    reports.set(spec.repo, rep)
    console.log(`■ ${spec.repo}  (${spec.mode}; fonts module ${site.fontsWritable ? 'L2+' : 'L1 — not written'})  ${site.summary}`)
    for (const f of rep.files) console.log(`    ${f.path.padEnd(30)} ${f.change}`)
    console.log(`    palette: ${PALETTE_ROLES.map((r) => `${r} ${site.brand.palette[r]}`).join(' · ')}`)
    const t = normalizeTypography(site.design.typography)
    console.log(`    fonts:   ${t.headingFont} / ${t.bodyFont} (accent ${t.accentFont})`)
    for (const w of site.warnings) console.log(`    ⚠ ${w}`)
  }
  if (!args.apply) {
    console.log('\nDry-run only. Re-run with --apply to commit, verify, push and record versions.')
    return writeJson(args.json, reports)
  }

  // 1. Commit on the fresh main clone.
  const toPush: ComputedSite[] = []
  for (const spec of specs) {
    const site = computed.get(spec.repo)!
    const rep = reports.get(spec.repo)!
    const dir = path.join(args.workDir, spec.repo)
    if (site.files.every((f) => f.before === f.after)) {
      rep.error = 'nothing to change — already applied'
      continue
    }
    for (const f of site.files) writeFileSync(path.join(dir, f.path), f.after)
    git(dir, ['add', '--', ...site.files.map((f) => f.path)])
    const verb = spec.mode === 'regenerate' ? 'regenerate theme files' : `update ${[site.brandChanged && 'palette', site.fontsChanged && 'fonts'].filter(Boolean).join(' + ')}`
    git(dir, ['commit', '-q', '-m', `Theme: ${verb} — approved branding`, '-m', site.summary, '-m', `${TRAILER}: ${spec.mode}`])
    rep.commit = revParse(dir, 'HEAD')
    toPush.push(site)
  }

  // 2. Local verify (npm ci, tsc, vitest, build, generate-fonts --check; one retry).
  console.log(`\nVerifying ${toPush.length} repo(s)…`)
  const verified = await pool(toPush, 2, async (site) => {
    const dir = path.join(args.workDir, site.spec.repo)
    const v = await verifyRepo(dir, { retries: 1 })
    reports.get(site.spec.repo)!.verify = { ok: v.ok, attempts: v.attempts, failedStep: v.failedStep, tail: v.ok ? '' : v.tail }
    console.log(`  ${v.ok ? '✓' : '✗'} ${site.spec.repo} verify (${v.attempts} attempt(s))${v.ok ? '' : ` failed at ${v.failedStep}`}`)
    return { site, ok: v.ok }
  })
  const failedVerify = verified.filter((v) => !v.ok)
  if (failedVerify.length) {
    for (const f of failedVerify) tryGit(path.join(args.workDir, f.site.spec.repo), ['reset', '-q', '--hard', 'refs/remotes/origin/main'])
    console.log(`\nStopping: ${failedVerify.map((f) => f.site.spec.repo).join(', ')} failed verify — nothing was pushed.`)
    return writeJson(args.json, reports)
  }

  // 3. Pre-apply baselines (sessions with no versions yet), before anything is pushed.
  for (const site of toPush) {
    const rep = reports.get(site.spec.repo)!
    if (!(await findJob(site.spec.sessionId))) continue
    try {
      rep.db = { baselineVersion: await ensureBaseline(site.spec, args.createdBy) }
    } catch (err) {
      rep.error = `baseline failed: ${(err as Error).message}`
      console.log(`\nStopping: ${site.spec.repo} ${rep.error} — nothing was pushed.`)
      return writeJson(args.json, reports)
    }
  }

  // 4. Draft pre-merge → push main → main→draft → Vercel (canary first, fail fast).
  const phase = await runPushPhase(
    toPush.map((s) => ({ slug: `${OWNER}/${s.spec.repo}`, dir: path.join(args.workDir, s.spec.repo), noDeploy: NO_DEPLOY.has(s.spec.repo) })),
    { keepGoing: false, canary: args.canary, deployWait: true },
    {
      draftPreflight,
      pushMain,
      mergeDraft: (slug) => mergeMainIntoDraft(slug, `Merge main into draft (approved branding)`),
      waitDeploy: (slug, sha) => waitForVercel(slug, sha),
      resetLocal: (dir) => void tryGit(dir, ['reset', '-q', '--hard', 'refs/remotes/origin/main']),
    },
    (line) => console.log(line)
  )

  // 5. Versions + MBP for every repo whose draft now holds the applied theme.
  for (const r of phase.results) {
    const repo = r.slug.split('/')[1]
    const rep = reports.get(repo)!
    rep.push = r
    const draftHas = r.status === 'pushed' || (r.stage === 'deploy' && (r.draft?.result === 'merged' || r.draft?.result === 'up-to-date'))
    if (!draftHas) continue
    const draftSha = ghDraftSha(r.slug)
    try {
      rep.db = { ...(rep.db ?? {}), ...(await recordAndSync(computed.get(repo)!, draftSha, args.createdBy)) }
    } catch (err) {
      rep.error = `DB record/sync failed: ${(err as Error).message}`
    }
  }
  if (phase.stoppedBy) console.log(`\nStopped after ${phase.stoppedBy}.`)
  writeJson(args.json, reports)
}

function ghDraftSha(slug: string): string | null {
  const r = spawnSync('gh', ['api', `repos/${slug}/branches/draft`, '--jq', '.commit.sha'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() || null : null
}

function writeJson(file: string | null, reports: Map<string, SiteReport>): void {
  if (file) writeFileSync(file, JSON.stringify([...reports.values()], null, 2) + '\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
