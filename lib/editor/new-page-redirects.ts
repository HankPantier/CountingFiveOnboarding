// A page created (or restored from drafts) at a url that redirects.csv still
// 301s away is unreachable: Next applies the redirect before the page. The
// create/restore writers drop those rows IN THE SAME COMMIT as the page, so the
// page never lands shadowed, and tell the operator what was removed.
import { formatClearedRedirectNotice, removeRedirectsFrom } from './redirects'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  readFile,
  writeFile,
  writeFiles,
} from '@/lib/github/repo-files'

export const REDIRECTS_PATH = 'content/redirects.csv'

export type RedirectsCompanion = { path: string; content: string; expectedSha: string }

/**
 * The redirects.csv write that clears every row whose source is one of `urls`,
 * or null when the file is absent or has no such row. The companion carries the
 * sha it was read at, so a concurrent redirects edit aborts the whole commit.
 */
export async function planRedirectClear(
  githubRepo: string,
  urls: string[]
): Promise<{ companion: RedirectsCompanion; notice: string } | null> {
  let file: { content: string; sha: string }
  try {
    file = await readFile(githubRepo, REDIRECTS_PATH, DRAFT_BRANCH)
  } catch (err) {
    if (err instanceof FileNotFoundError) return null
    throw err
  }
  let content = file.content
  const removed: ReturnType<typeof removeRedirectsFrom>['removed'] = []
  for (const url of urls) {
    const r = removeRedirectsFrom(content, url)
    content = r.content
    removed.push(...r.removed)
  }
  const notice = formatClearedRedirectNotice(removed)
  if (!notice) return null
  return { companion: { path: REDIRECTS_PATH, content, expectedSha: file.sha }, notice }
}

/**
 * Write a NEW page file at `path` (served at `url`) on draft, removing any
 * redirects.csv row that would shadow it in the same commit. Returns the page's
 * blob sha and, when rows were removed, the notice for the operator.
 */
export async function writeNewPage(
  githubRepo: string,
  path: string,
  url: string,
  content: string,
  message: string,
  author: { authorName?: string; authorEmail?: string }
): Promise<{ blobSha: string; redirectNotice?: string }> {
  const clear = await planRedirectClear(githubRepo, [url])
  if (!clear) {
    const { blobSha } = await writeFile(githubRepo, path, content, DRAFT_BRANCH, message, author)
    return { blobSha }
  }
  const { blobs } = await writeFiles(
    githubRepo,
    [{ path, content, expectedSha: null }, clear.companion],
    DRAFT_BRANCH,
    message,
    author
  )
  return { blobSha: blobs[path] ?? '', redirectNotice: clear.notice }
}
