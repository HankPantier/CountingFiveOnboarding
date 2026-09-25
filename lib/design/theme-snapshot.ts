// Server-only. The draft branch's four theme files as { path → blob sha } plus
// their texts, for drift detection, the v0 baseline import and the stale
// theme.css check. One listTree (conditional getRef + cached tree — cheap and
// rate-limit friendly) gives the shas; texts are read by sha and cached in
// process, since blobs are immutable.
import { DRAFT_BRANCH, ensureDraftBranch, listTree, readTextBlobs } from '@/lib/github/repo-files'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { THEME_FILE_PATHS, type ThemeFilePath } from './drift'
import type { ThemeBlobShas } from './studio-types'

export type DraftThemeSnapshot = { shas: ThemeBlobShas; texts: Partial<Record<ThemeFilePath, string>> }

const CACHE_MAX = 64
const blobTextCache = new Map<string, string>()

export function __resetThemeBlobCacheForTests(): void {
  blobTextCache.clear()
}

function remember(sha: string, text: string): void {
  if (blobTextCache.size >= CACHE_MAX) {
    const oldest = blobTextCache.keys().next().value
    if (oldest !== undefined) blobTextCache.delete(oldest)
  }
  blobTextCache.set(sha, text)
}

export async function readDraftThemeSnapshot(githubRepo: string): Promise<DraftThemeSnapshot> {
  await ensureDraftBranch(githubRepo)
  const wanted = new Set<string>(THEME_FILE_PATHS)
  const entries = (await listTree(githubRepo, DRAFT_BRANCH)).filter((e) => e.type === 'blob' && wanted.has(e.path))

  const shas: ThemeBlobShas = {}
  for (const e of entries) shas[e.path] = e.sha

  const missing = entries.filter((e) => !blobTextCache.has(e.sha))
  if (missing.length > 0) {
    for (const r of await readTextBlobs(githubRepo, missing)) {
      const sha = shas[r.path]
      if (sha) remember(sha, r.content)
    }
  }

  const texts: Partial<Record<ThemeFilePath, string>> = {}
  for (const p of THEME_FILE_PATHS) {
    const sha = shas[p]
    const text = sha ? blobTextCache.get(sha) : undefined
    if (text !== undefined) texts[p] = text
  }
  return { shas, texts }
}

// The draft theme as the texts every Design Studio consumer needs (the
// orchestrator's generate + render stages, the concept apply / preview
// routes). brand.json + design.json are required; theme.css and the overrides
// file default to ''. `shas` is the snapshot's blob map, for drift/guards.
export const MISSING_THEME_FILES_ERROR = 'This site has no brand.json / design.json yet.'

export type DraftThemeTexts = { brandText: string; designText: string; themeCss: string; overridesCss: string }
export type DraftThemeTextsResult =
  | { ok: true; files: DraftThemeTexts; shas: ThemeBlobShas }
  | { ok: false; reason: 'missing_theme_files'; error: string }

export function themeTextsFromSnapshot(snapshot: DraftThemeSnapshot): DraftThemeTextsResult {
  const brandText = snapshot.texts[BRAND_PATH]
  const designText = snapshot.texts[DESIGN_PATH]
  if (!brandText || !designText) return { ok: false, reason: 'missing_theme_files', error: MISSING_THEME_FILES_ERROR }
  return {
    ok: true,
    files: {
      brandText,
      designText,
      themeCss: snapshot.texts[THEME_CSS_PATH] ?? '',
      overridesCss: snapshot.texts[OVERRIDES_PATH] ?? '',
    },
    shas: snapshot.shas,
  }
}

export async function readDraftThemeTexts(githubRepo: string): Promise<DraftThemeTextsResult> {
  return themeTextsFromSnapshot(await readDraftThemeSnapshot(githubRepo))
}
