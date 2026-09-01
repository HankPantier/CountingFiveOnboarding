import { toPathname } from './nav-urls'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  moveFile,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'

const REDIRECTS_PATH = 'content/redirects.csv'

export type Move = { from: string; to: string }

// Minimal shape shared by every relocate op: the repo slug plus the commit
// author. EditContext is structurally compatible, so callers pass it directly.
export interface RelocateCtx {
  githubRepo: string
  adminName?: string
  adminEmail?: string
}

function author(ctx: RelocateCtx) {
  return {
    authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name,
    authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
  }
}

// A genuine collision: a DIFFERENT page already occupies the destination path.
// (The same page already sitting there — e.g. a re-run — is not a collision.)
export class DestinationOccupiedError extends Error {
  constructor(
    public from: string,
    public to: string
  ) {
    super(`A page already exists at ${to}`)
    this.name = 'DestinationOccupiedError'
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Swap the trailing `from` path with `to` in the page's `url:`/`canonical_url:`
// frontmatter lines, preserving any host prefix. Keeps the canonical correct
// after the page moves.
export function swapFrontmatterUrl(content: string, from: string, to: string): string {
  return content.replace(
    new RegExp('^((?:url|canonical_url):.*?)' + escapeRe(from) + '\\s*$', 'gm'),
    `$1${to}`
  )
}

// The page's own url from its frontmatter (`url:` preferred, else `canonical_url:`).
// Used to recognise a destination file that is already the page we're moving —
// e.g. relocated by an earlier save — so we skip it instead of flagging a collision.
export function frontmatterUrl(content: string): string | null {
  const m = /^(?:url|canonical_url):\s*(.+?)\s*$/m.exec(content)
  return m ? m[1] : null
}

// Append 301 redirect rows to content/redirects.csv (creating it if absent),
// skipping any from-url that already has one. `reason` is the CSV note column;
// callers pass a fixed string (never client input) so it can't corrupt the CSV.
export async function appendRedirects(
  ctx: RelocateCtx,
  pairs: Move[],
  reason: string
): Promise<void> {
  let content = ''
  let sha: string | undefined
  try {
    const f = await readFile(ctx.githubRepo, REDIRECTS_PATH, DRAFT_BRANCH)
    content = f.content
    sha = f.sha
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
    content = 'old_url,new_url,status_code,reason\n'
  }
  if (!content.endsWith('\n')) content += '\n'
  const existing = new Set(content.split('\n').map((l) => l.split(',')[0]))
  let added = false
  for (const { from, to } of pairs) {
    if (existing.has(from)) continue
    content += `${from},${to},301,${reason}\n`
    added = true
  }
  if (added) {
    await writeFile(ctx.githubRepo, REDIRECTS_PATH, content, DRAFT_BRANCH, 'Add redirects via admin', {
      ...(sha ? { expectedSha: sha } : {}),
      ...author(ctx),
    })
  }
}

// Relocate a single live content file (page/post) from fromPath→toPath on the
// draft branch: an atomic moveFile (reuses the blob — no re-upload), fix its
// url/canonical frontmatter, then append a 301. Collision-aware: a foreign page
// already at toPath throws DestinationOccupiedError; the same page already
// sitting there (a re-run) is a no-op success. Throws StaleShaError if fromPath
// changed since expectedSha. Mirrors the batch logic that lives in the nav route.
export async function relocateFile(
  ctx: RelocateCtx,
  args: {
    fromPath: string
    toPath: string
    fromUrl: string
    toUrl: string
    expectedSha: string
    reason: string
  }
): Promise<{ blobSha: string; moved: boolean }> {
  const { fromPath, toPath, fromUrl, toUrl, expectedSha, reason } = args

  // Destination check: free → move; occupied by THIS page already → done;
  // occupied by a foreign page → collision.
  let occupant: { content: string; sha: string } | null = null
  try {
    occupant = await readFile(ctx.githubRepo, toPath, DRAFT_BRANCH)
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
  }
  if (occupant) {
    const occUrl = frontmatterUrl(occupant.content)
    if (occUrl && toPathname(occUrl) === toPathname(toUrl)) {
      return { blobSha: occupant.sha, moved: false }
    }
    throw new DestinationOccupiedError(fromUrl, toUrl)
  }

  await moveFile(
    ctx.githubRepo,
    fromPath,
    toPath,
    DRAFT_BRANCH,
    expectedSha,
    `Move ${fromUrl} → ${toUrl} via admin${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
    author(ctx)
  )
  const moved = await readFile(ctx.githubRepo, toPath, DRAFT_BRANCH)
  const fixed = swapFrontmatterUrl(moved.content, fromUrl, toUrl)
  let blobSha = moved.sha
  if (fixed !== moved.content) {
    const w = await writeFile(ctx.githubRepo, toPath, fixed, DRAFT_BRANCH, `Update canonical for ${toUrl}`, {
      expectedSha: moved.sha,
      ...author(ctx),
    })
    blobSha = w.blobSha
  }
  await appendRedirects(ctx, [{ from: fromUrl, to: toUrl }], reason)
  return { blobSha, moved: true }
}
