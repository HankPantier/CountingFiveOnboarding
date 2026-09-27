import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { draftFontsModuleKind, isFontsModuleStale, FONTS_MODULE_PATH } from '@/lib/design/drift'
import { classifyThemeCss, type ThemeCssState } from './theme-drift'
import { lintOverrides, type OverridesLint } from './overrides-lint'
import { readMarker } from './special-files'
import type { ClientEntry } from './types'

// Read-only fleet health (scripts/fleet-status.ts). Every read goes through the
// operator's `gh` CLI; nothing is written anywhere.

const run = promisify(execFile)

const BRAND = 'content/brand.json'
const DESIGN = 'content/design.json'
const THEME = 'src/styles/theme.css'
const OVERRIDES = 'content/design-overrides.css'
const MARKER = 'c5-template.json'

export type Fetcher = (args: string[]) => Promise<string | null>

export const ghFetcher: Fetcher = async (args) => {
  try {
    const { stdout } = await run('gh', ['api', ...args], { maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

async function raw(fetch: Fetcher, slug: string, p: string, ref: string): Promise<string | null> {
  return fetch(['-H', 'Accept: application/vnd.github.raw', `repos/${slug}/contents/${p}?ref=${ref}`])
}

async function json<T>(fetch: Fetcher, p: string): Promise<T | null> {
  const out = await fetch([p])
  if (out === null) return null
  try {
    return JSON.parse(out) as T
  } catch {
    return null
  }
}

export interface BranchHealth {
  templateVersion: string | null
  syncedFrom: string | null
  theme: ThemeCssState
  themePaletteDiffs: number
  committedAction: string | null
  brandAction: string | null
  fontsKind: 'default' | 'synced' | null
  fontsStale: boolean | null
}

export interface ClientHealth {
  slug: string
  displayName: string
  main: BranchHealth | null
  draft: BranchHealth | null
  draftAhead: { commits: number; files: number } | null
  vercelMain: string
  vercelDraft: string
  ci: string
  overrides: OverridesLint
  problems: string[]
}

async function branchHealth(fetch: Fetcher, slug: string, ref: string): Promise<{ health: BranchHealth; overrides: string | null } | null> {
  const [marker, brand, design, theme, fonts, overrides] = await Promise.all(
    [MARKER, BRAND, DESIGN, THEME, FONTS_MODULE_PATH, OVERRIDES].map((p) => raw(fetch, slug, p, ref))
  )
  if (marker === null && brand === null && theme === null) return null
  const m = readMarker(marker)
  const t = classifyThemeCss(theme, brand, design)
  const texts = { [DESIGN]: design ?? undefined, [FONTS_MODULE_PATH]: fonts ?? undefined }
  return {
    health: {
      templateVersion: m.templateVersion,
      syncedFrom: m.syncedFrom,
      theme: t.state,
      themePaletteDiffs: t.paletteDiffs.length,
      committedAction: t.committedAction,
      brandAction: t.brandAction,
      fontsKind: draftFontsModuleKind(texts),
      fontsStale: isFontsModuleStale(texts),
    },
    overrides,
  }
}

interface Compare {
  ahead_by?: number
  files?: unknown[]
}
interface CombinedStatus {
  statuses?: { context: string; state: string }[]
}
interface Runs {
  total_count?: number
  workflow_runs?: { conclusion: string | null; status: string; name: string; created_at: string }[]
}

export async function clientHealth(client: ClientEntry, latestVersion: string | null, fetch: Fetcher = ghFetcher): Promise<ClientHealth> {
  const slug = client.slug
  const [main, draft, cmp, stMain, stDraft, runs] = await Promise.all([
    branchHealth(fetch, slug, 'main'),
    branchHealth(fetch, slug, 'draft'),
    json<Compare>(fetch, `repos/${slug}/compare/main...draft`),
    json<CombinedStatus>(fetch, `repos/${slug}/commits/main/status`),
    json<CombinedStatus>(fetch, `repos/${slug}/commits/draft/status`),
    json<Runs>(fetch, `repos/${slug}/actions/runs?branch=main&per_page=1`),
  ])
  const vercel = (s: CombinedStatus | null) => s?.statuses?.find((x) => /^vercel/i.test(x.context))?.state ?? 'none'
  const ci = !runs ? 'unknown' : !runs.total_count ? 'no-ci' : (runs.workflow_runs?.[0]?.conclusion ?? runs.workflow_runs?.[0]?.status ?? 'unknown')
  const overrides = lintOverrides(main?.overrides ?? null)

  const problems: string[] = []
  const mh = main?.health ?? null
  if (!mh) problems.push('main unreadable')
  if (mh && latestVersion && mh.templateVersion !== latestVersion) problems.push(`template ${mh.templateVersion ?? '?'} < ${latestVersion}`)
  if (mh && !mh.syncedFrom) problems.push('no syncedFrom (next sync needs --from)')
  if (mh?.theme === 'palette') problems.push(`theme.css palette ≠ brand.json (live action ${mh.committedAction ?? '?'} vs brand ${mh.brandAction ?? '?'})`)
  if (mh?.fontsStale) problems.push(`fonts module ${mh.fontsKind === 'default' ? 'is the DEFAULT seed' : 'is stale'} vs design.json`)
  if (cmp?.ahead_by && cmp.files?.length) problems.push(`draft has ${cmp.files.length} unpublished file(s)`)
  if (vercel(stMain) === 'none') problems.push('no Vercel status on main (no deploy target?)')
  else if (vercel(stMain) !== 'success') problems.push(`Vercel main ${vercel(stMain)}`)
  if (ci === 'failure') problems.push('CI failing on main')
  if (overrides.ownedShadows || overrides.tailwindSelectors) problems.push(`overrides shadow template (${overrides.ownedShadows} owned, ${overrides.tailwindSelectors} tailwind-keyed)`)

  return {
    slug,
    displayName: client.displayName,
    main: mh,
    draft: draft?.health ?? null,
    draftAhead: cmp ? { commits: cmp.ahead_by ?? 0, files: cmp.files?.length ?? 0 } : null,
    vercelMain: vercel(stMain),
    vercelDraft: vercel(stDraft),
    ci,
    overrides,
    problems,
  }
}
