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

// Unquote a single-line YAML scalar: "double" (JSON-compatible escapes) or
// 'single' ('' → '). Returns the bare value plus whether it was quoted.
export function unquoteYamlScalar(raw: string): { value: string; quoted: boolean } {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(v)
      if (typeof parsed === 'string') return { value: parsed, quoted: true }
    } catch {
      // Not JSON-compatible — fall back to stripping the quotes.
    }
    return { value: v.slice(1, -1), quoted: true }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return { value: v.slice(1, -1).replace(/''/g, "'"), quoted: true }
  }
  return { value: v, quoted: false }
}

// End index (exclusive) of the frontmatter block's inner text, or -1 when the
// file has no `---` fenced frontmatter. Rewrites are confined to this region so
// a body line that happens to start with `url:` is never touched.
function frontmatterEnd(content: string): number {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return -1
  const afterOpen = content.indexOf('\n') + 1
  return content.indexOf('\n---', afterOpen - 1)
}

const URL_LINE_RE = /^(url|canonical_url):[ \t]*(.*?)[ \t]*$/gm
const HOST_PREFIX_RE = /^(?:https?:\/\/[^/\s]+)?$/

// Swap the `from` path with `to` in the page's `url:`/`canonical_url:`
// frontmatter lines, preserving any host prefix (https://example.com). Handles
// bare, "double-quoted" and 'single-quoted' values; a quoted value is written
// back as a JSON-quoted string (valid YAML). Keeps the canonical correct after
// the page moves.
export function swapFrontmatterUrl(content: string, from: string, to: string): string {
  // Fence-less file: fall back to scanning the whole text (legacy behavior).
  const end = frontmatterEnd(content) < 0 ? content.length : frontmatterEnd(content)
  const head = content.slice(0, end)
  const rewritten = head.replace(URL_LINE_RE, (line: string, key: string, rawValue: string) => {
    const { value, quoted } = unquoteYamlScalar(rawValue)
    if (!value.endsWith(from)) return line
    const prefix = value.slice(0, value.length - from.length)
    if (!HOST_PREFIX_RE.test(prefix)) return line
    const next = prefix + to
    return `${key}: ${quoted ? JSON.stringify(next) : next}`
  })
  return rewritten + content.slice(end)
}

// The page's own url from its frontmatter (`url:` preferred, else `canonical_url:`),
// unquoted. Used to recognise a destination file that is already the page we're
// moving — e.g. relocated by an earlier save — so we skip it instead of flagging
// a collision.
export function frontmatterUrl(content: string): string | null {
  const m = /^(?:url|canonical_url):\s*(.+?)\s*$/m.exec(content)
  if (!m) return null
  const { value } = unquoteYamlScalar(m[1])
  return value || null
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
