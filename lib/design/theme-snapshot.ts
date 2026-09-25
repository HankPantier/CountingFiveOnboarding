// Server-only. The draft branch's four theme files as { path → blob sha } plus
// their texts, for drift detection, the v0 baseline import and the stale
// theme.css check. One listTree (conditional getRef + cached tree — cheap and
// rate-limit friendly) gives the shas; texts are read by sha and cached in
// process, since blobs are immutable.
import { DRAFT_BRANCH, ensureDraftBranch, listTree, readTextBlobs } from '@/lib/github/repo-files'
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
