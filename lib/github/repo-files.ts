import { RequestError } from '@octokit/request-error'
import { getOctokit, resolveRepo } from './app-client'
import { withRateLimitRetry } from './rate-limit'

// How many blobs to upload at once when pushing a deliverable. Kept low so a
// ~300-file content push doesn't trip GitHub's secondary rate limit; each call
// also retries on a throttle. Mirrors the template seeder.
const PUSH_BLOB_CONCURRENCY = 4

export const DRAFT_BRANCH = 'draft'
export const MAIN_BRANCH = 'main'

export type TreeEntry = {
  path: string
  sha: string
  type: 'blob' | 'tree'
  size?: number
}

export type BinaryBlob = {
  path: string
  content: Buffer
  sha: string
  size: number
}

// Image file extensions surfaced in the asset/media UI. SVG is listed so
// existing ones render, but uploads of SVG are rejected upstream (no magic
// bytes to validate; stored-XSS risk).
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i

export type FileBlob = {
  path: string
  content: string
  sha: string
}

export class FileNotFoundError extends Error {
  constructor(path: string) {
    super(`File not found: ${path}`)
    this.name = 'FileNotFoundError'
  }
}

export class StaleShaError extends Error {
  constructor(
    public path: string,
    public currentSha: string,
    public currentContent: string
  ) {
    super(`File changed remotely: ${path}`)
    this.name = 'StaleShaError'
  }
}

export class AssetExistsError extends Error {
  constructor(public path: string) {
    super(`Asset already exists: ${path}`)
    this.name = 'AssetExistsError'
  }
}

function isRequestError(err: unknown): err is RequestError {
  return err instanceof RequestError
}

async function ensureBranch(
  slug: string,
  branch: string,
  fromBranch: string
): Promise<void> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
    return
  } catch (err) {
    if (!isRequestError(err) || err.status !== 404) throw err
  }
  const base = await octokit.git.getRef({ owner, repo, ref: `heads/${fromBranch}` })
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: base.data.object.sha,
  })
}

// Ensure the long-lived draft branch exists, branching from main if missing.
export async function ensureDraftBranch(slug: string): Promise<void> {
  await ensureBranch(slug, DRAFT_BRANCH, MAIN_BRANCH)
}

// Overlay a set of files onto a branch in one atomic commit via the Git Data
// API. base_tree is the branch's current tree, so files NOT in `entries` are
// preserved (the client repo's app code stays put; only the deliverable's
// content/ + public/ paths are added or updated). base64 blobs handle text and
// binary (images) uniformly.
export async function pushEntriesToBranch(
  slug: string,
  branch: string,
  entries: { path: string; content: string | Buffer }[],
  message: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<{ commitSha: string; fileCount: number }> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)

  const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
  const baseCommitSha = ref.data.object.sha
  const baseCommit = await octokit.git.getCommit({ owner, repo, commit_sha: baseCommitSha })

  // Explicit literal types for mode/type — Octokit's overloaded createTree
  // signature defeats `Parameters<...>['tree']` index access. Upload blobs in
  // bounded-concurrency batches with rate-limit retry so a large push (hundreds
  // of assets) neither bursts past GitHub's secondary limit nor fails outright.
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = []
  for (let i = 0; i < entries.length; i += PUSH_BLOB_CONCURRENCY) {
    const batch = entries.slice(i, i + PUSH_BLOB_CONCURRENCY)
    const created = await Promise.all(
      batch.map(async (e) => {
        const buf = typeof e.content === 'string' ? Buffer.from(e.content, 'utf-8') : e.content
        const blob = await withRateLimitRetry(() =>
          octokit.git.createBlob({ owner, repo, content: buf.toString('base64'), encoding: 'base64' })
        )
        return { path: e.path, mode: '100644' as const, type: 'blob' as const, sha: blob.data.sha }
      })
    )
    tree.push(...created)
  }

  const newTree = await withRateLimitRetry(() =>
    octokit.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.data.tree.sha,
      tree,
    })
  )
  const commit = await withRateLimitRetry(() =>
    octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.data.sha,
      parents: [baseCommitSha],
      ...(options.authorName && options.authorEmail
        ? { author: { name: options.authorName, email: options.authorEmail } }
        : {}),
    })
  )
  await withRateLimitRetry(() =>
    octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.data.sha,
    })
  )
  return { commitSha: commit.data.sha, fileCount: tree.length }
}

export async function listTree(
  slug: string,
  branch: string,
  prefix?: string
): Promise<TreeEntry[]> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
  const commit = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: ref.data.object.sha,
  })
  const tree = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commit.data.tree.sha,
    recursive: 'true',
  })
  const filtered = tree.data.tree.filter(
    (n): n is { path: string; sha: string; type: 'blob' | 'tree'; size?: number } =>
      typeof n.path === 'string' &&
      typeof n.sha === 'string' &&
      (n.type === 'blob' || n.type === 'tree')
  )
  return filtered
    .filter((n) => !prefix || n.path.startsWith(prefix))
    .map((n) => ({ path: n.path, sha: n.sha, type: n.type, size: n.size }))
}

// List image blobs under the asset roots (public/content-assets, public/og-images).
export async function listAssets(
  slug: string,
  branch: string
): Promise<TreeEntry[]> {
  const all = await listTree(slug, branch)
  return all.filter(
    (n) =>
      n.type === 'blob' &&
      (n.path.startsWith('public/content-assets/') ||
        n.path.startsWith('public/og-images/')) &&
      IMAGE_EXT_RE.test(n.path)
  )
}

// Read a binary blob (image) by path. Resolves the blob sha via getContent,
// then pulls full bytes via the git blobs API so files >1MB aren't truncated
// the way getContent's inline `content` would be.
export async function readBinaryFile(
  slug: string,
  path: string,
  branch: string
): Promise<BinaryBlob> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  try {
    const meta = await octokit.repos.getContent({ owner, repo, path, ref: branch })
    if (Array.isArray(meta.data) || meta.data.type !== 'file') {
      throw new Error(`Path is not a file: ${path}`)
    }
    const sha = meta.data.sha
    const blob = await octokit.git.getBlob({ owner, repo, file_sha: sha })
    const content = Buffer.from(blob.data.content, blob.data.encoding as BufferEncoding)
    return { path, content, sha, size: content.byteLength }
  } catch (err) {
    if (isRequestError(err) && err.status === 404) {
      throw new FileNotFoundError(path)
    }
    throw err
  }
}

// Current blob sha of a file, or null if it doesn't exist. Used to enforce
// optimistic locking on binary writes without decoding the bytes.
async function currentSha(
  slug: string,
  path: string,
  branch: string
): Promise<string | null> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  try {
    const res = await octokit.repos.getContent({ owner, repo, path, ref: branch })
    if (Array.isArray(res.data) || res.data.type !== 'file') return null
    return res.data.sha
  } catch (err) {
    if (isRequestError(err) && err.status === 404) return null
    throw err
  }
}

// Write binary content (already a Buffer) to the branch. `mode: 'create'`
// requires the path to be absent; `mode: 'replace'` requires expectedSha to
// match the current blob. StaleShaError (empty content) signals a lost race.
export async function writeBinaryFile(
  slug: string,
  path: string,
  content: Buffer,
  branch: string,
  message: string,
  options: {
    mode: 'create' | 'replace'
    expectedSha?: string
    authorName?: string
    authorEmail?: string
  }
): Promise<{ commitSha: string; blobSha: string }> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)

  const existing = await currentSha(slug, path, branch)
  if (options.mode === 'create' && existing !== null) {
    throw new AssetExistsError(path)
  }
  if (options.mode === 'replace') {
    if (existing === null) throw new FileNotFoundError(path)
    if (options.expectedSha && existing !== options.expectedSha) {
      throw new StaleShaError(path, existing, '')
    }
  }

  const payload: Parameters<typeof octokit.repos.createOrUpdateFileContents>[0] = {
    owner,
    repo,
    path,
    message,
    content: content.toString('base64'),
    branch,
  }
  if (existing) payload.sha = existing
  if (options.authorName && options.authorEmail) {
    payload.author = { name: options.authorName, email: options.authorEmail }
  }

  const res = await octokit.repos.createOrUpdateFileContents(payload)
  return {
    commitSha: res.data.commit.sha ?? '',
    blobSha: res.data.content?.sha ?? '',
  }
}

// Delete a file from the branch. expectedSha guards against deleting a blob
// that changed since the caller last listed it.
export async function deleteFile(
  slug: string,
  path: string,
  branch: string,
  expectedSha: string,
  message: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<{ commitSha: string }> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const existing = await currentSha(slug, path, branch)
  if (existing === null) throw new FileNotFoundError(path)
  if (existing !== expectedSha) throw new StaleShaError(path, existing, '')

  const res = await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha: expectedSha,
    branch,
    ...(options.authorName && options.authorEmail
      ? { author: { name: options.authorName, email: options.authorEmail } }
      : {}),
  })
  return { commitSha: res.data.commit.sha ?? '' }
}

// Atomically move a file (add at toPath + delete fromPath) in a single commit
// via the Git Data API, reusing the existing blob sha (no re-upload). Used to
// "draft"/"restore" a content page by relocating it between content/pages|posts
// and content/drafts/. expectedSha guards against a move racing a concurrent
// edit; the target must not already exist so a move never clobbers a file.
export async function moveFile(
  slug: string,
  fromPath: string,
  toPath: string,
  branch: string,
  expectedSha: string,
  message: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<{ commitSha: string }> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)

  const existing = await currentSha(slug, fromPath, branch)
  if (existing === null) throw new FileNotFoundError(fromPath)
  if (existing !== expectedSha) throw new StaleShaError(fromPath, existing, '')
  if ((await currentSha(slug, toPath, branch)) !== null) {
    throw new AssetExistsError(toPath)
  }

  const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
  const baseCommitSha = ref.data.object.sha
  const baseCommit = await octokit.git.getCommit({ owner, repo, commit_sha: baseCommitSha })

  // sha: null marks a deletion in the tree; the new entry reuses the moved
  // blob's sha so no blob upload is needed.
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [
    { path: toPath, mode: '100644', type: 'blob', sha: existing },
    { path: fromPath, mode: '100644', type: 'blob', sha: null },
  ]
  const newTree = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree,
  })
  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.data.sha,
    parents: [baseCommitSha],
    ...(options.authorName && options.authorEmail
      ? { author: { name: options.authorName, email: options.authorEmail } }
      : {}),
  })
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  })
  return { commitSha: commit.data.sha }
}

export async function readFile(
  slug: string,
  path: string,
  branch: string
): Promise<FileBlob> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  try {
    const res = await octokit.repos.getContent({ owner, repo, path, ref: branch })
    const data = res.data
    if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
      throw new Error(`Path is not a file: ${path}`)
    }
    const content = Buffer.from(data.content, data.encoding as BufferEncoding).toString('utf-8')
    return { path, content, sha: data.sha }
  } catch (err) {
    if (isRequestError(err) && err.status === 404) {
      throw new FileNotFoundError(path)
    }
    throw err
  }
}

// Write or create a file on the given branch. If expectedSha is supplied and
// does not match the file's current sha on the branch, throws StaleShaError
// with the remote content so the caller can present a conflict UI.
export async function writeFile(
  slug: string,
  path: string,
  content: string,
  branch: string,
  message: string,
  options: { expectedSha?: string; authorName?: string; authorEmail?: string } = {}
): Promise<{ commitSha: string; blobSha: string }> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)

  if (options.expectedSha !== undefined) {
    try {
      const existing = await readFile(slug, path, branch)
      if (existing.sha !== options.expectedSha) {
        throw new StaleShaError(path, existing.sha, existing.content)
      }
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        // File was deleted remotely; treat as stale.
        throw new StaleShaError(path, '', '')
      }
      throw err
    }
  }

  const payload: Parameters<typeof octokit.repos.createOrUpdateFileContents>[0] = {
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  }
  if (options.expectedSha) payload.sha = options.expectedSha
  if (options.authorName && options.authorEmail) {
    payload.author = { name: options.authorName, email: options.authorEmail }
  }

  const res = await octokit.repos.createOrUpdateFileContents(payload)
  return {
    commitSha: res.data.commit.sha ?? '',
    blobSha: res.data.content?.sha ?? '',
  }
}

// Remove a stale static public/sitemap.xml if one exists on the branch. New
// packages no longer ship it — the template's dynamic src/app/sitemap.ts owns
// the sitemap and auto-includes every post — but already-packaged repos still
// carry a frozen copy that shadows the route. Idempotent: returns false when
// nothing was there. Never throws; callers treat failure as non-fatal.
export async function removeStaleStaticSitemap(
  slug: string,
  branch: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<boolean> {
  let existing: FileBlob
  try {
    existing = await readFile(slug, 'public/sitemap.xml', branch)
  } catch (err) {
    if (err instanceof FileNotFoundError) return false
    throw err
  }
  await deleteFile(
    slug,
    'public/sitemap.xml',
    branch,
    existing.sha,
    'Remove static sitemap.xml — dynamic app/sitemap.ts now owns it',
    options
  )
  return true
}

// Patch only the `siteUrl: '...'` line in the repo-root site.config.ts so the
// dynamic sitemap (and any other siteConfig consumer) emits the canonical
// host. Targeted regex replace preserves every other field (legalLinks, forms,
// booking). No-op when the file is missing, the field is absent, or the value
// already matches. Returns true only when a commit was made.
// A legitimate site URL never contains quotes or backslashes; refusing them
// prevents an admin-supplied website_url from breaking out of the string
// literal we write into the executable site.config.ts (code injection).
const SAFE_SITE_URL_RE = /^https?:\/\/[A-Za-z0-9.\-:/_?#=&%]+$/

export async function patchSiteConfigSiteUrl(
  slug: string,
  branch: string,
  siteUrl: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<boolean> {
  if (!SAFE_SITE_URL_RE.test(siteUrl)) {
    console.warn(`[repo-files] Refusing unsafe siteUrl, not patching site.config.ts: ${siteUrl}`)
    return false
  }
  let blob: FileBlob
  try {
    blob = await readFile(slug, 'site.config.ts', branch)
  } catch (err) {
    if (err instanceof FileNotFoundError) return false
    throw err
  }
  const next = blob.content.replace(
    /(\bsiteUrl\s*:\s*)(['"])[^'"]*\2/,
    (_m, prefix: string, quote: string) => `${prefix}${quote}${siteUrl}${quote}`
  )
  if (next === blob.content) return false
  await writeFile(slug, 'site.config.ts', next, branch, `Set siteUrl to ${siteUrl}`, {
    expectedSha: blob.sha,
    ...options,
  })
  return true
}

// Returns { merged: true } on fast-forward / clean merge,
// or { merged: false, prUrl } if a PR had to be opened due to conflict.
export type MergeResult =
  | { merged: true; mergeCommitSha: string }
  | { merged: false; prUrl: string }

// Return the URL of the open draft→main PR, creating it if none exists. Idempotent:
// GitHub rejects a second PR for the same head branch ("A pull request already
// exists for owner:draft"), so we look one up first and fall back to a lookup if a
// create races. Used when a publish hits a merge conflict the admin must resolve.
async function ensureDraftPr(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string
): Promise<string> {
  const head = `${owner}:${DRAFT_BRANCH}`
  const existing = await octokit.pulls.list({
    owner,
    repo,
    base: MAIN_BRANCH,
    head,
    state: 'open',
  })
  if (existing.data.length > 0) return existing.data[0].html_url

  try {
    const pr = await octokit.pulls.create({
      owner,
      repo,
      head: DRAFT_BRANCH,
      base: MAIN_BRANCH,
      title: 'Publish draft to live (manual resolve required)',
      body:
        'Auto-publish detected a conflict between `draft` and `main`. ' +
        'Resolve the conflict in this PR and merge to deploy.',
    })
    return pr.data.html_url
  } catch (err) {
    // A PR was created between our list and create (or already existed) — GitHub
    // 422s with a custom "already exists" message. Re-fetch and return it.
    if (isRequestError(err) && err.status === 422) {
      const retry = await octokit.pulls.list({ owner, repo, base: MAIN_BRANCH, head, state: 'open' })
      if (retry.data.length > 0) return retry.data[0].html_url
    }
    throw err
  }
}

export async function mergeDraftToMain(slug: string): Promise<MergeResult> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)

  // Check if there's anything to merge.
  const cmp = await octokit.repos.compareCommits({
    owner,
    repo,
    base: MAIN_BRANCH,
    head: DRAFT_BRANCH,
  })
  if (cmp.data.ahead_by === 0) {
    return { merged: true, mergeCommitSha: '' }
  }

  try {
    const res = await octokit.repos.merge({
      owner,
      repo,
      base: MAIN_BRANCH,
      head: DRAFT_BRANCH,
      commit_message: 'Publish draft to live',
    })
    return { merged: true, mergeCommitSha: res.data.sha }
  } catch (err) {
    if (!isRequestError(err) || err.status !== 409) throw err
    // Conflict — surface a PR (reusing an open one) for the admin to resolve.
    return { merged: false, prUrl: await ensureDraftPr(octokit, owner, repo) }
  }
}

// Force-update draft branch to point at main's HEAD. Used after a successful
// publish so the next round of edits starts from a clean base, and by the admin
// "Reset draft to live" action to discard a draft that has drifted too far to
// merge (e.g. main got direct commits the editor's draft never saw).
export async function resetDraftToMain(slug: string): Promise<void> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const main = await octokit.git.getRef({ owner, repo, ref: `heads/${MAIN_BRANCH}` })
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${DRAFT_BRANCH}`,
    sha: main.data.object.sha,
    force: true,
  })
}

export type SyncResult =
  | { synced: true; alreadyCurrent: boolean; mergeCommitSha: string | null }
  | { synced: false; reason: string }

// "Keep draft current": merge commits that landed on main (e.g. direct dev
// pushes, a hand-merged PR) into the long-lived draft branch so a later publish
// merges cleanly instead of conflicting. Nothing on main to pull → alreadyCurrent;
// a clean merge → a new merge commit on draft (draft edits preserved). A content
// conflict can't be auto-resolved, so we report it rather than force anything —
// the admin resolves on GitHub or uses "Reset draft to live".
export async function syncMainIntoDraft(slug: string): Promise<SyncResult> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)

  // ahead_by = commits main has that draft lacks (how stale draft is).
  const cmp = await octokit.repos.compareCommits({
    owner,
    repo,
    base: DRAFT_BRANCH,
    head: MAIN_BRANCH,
  })
  if (cmp.data.ahead_by === 0) {
    return { synced: true, alreadyCurrent: true, mergeCommitSha: null }
  }

  try {
    const res = await octokit.repos.merge({
      owner,
      repo,
      base: DRAFT_BRANCH,
      head: MAIN_BRANCH,
      commit_message: 'Update draft from live',
    })
    return { synced: true, alreadyCurrent: false, mergeCommitSha: res.data.sha ?? null }
  } catch (err) {
    if (isRequestError(err) && err.status === 409) {
      return {
        synced: false,
        reason:
          'Live has changes that conflict with the current draft. Resolve them on GitHub, ' +
          'or use "Reset draft to live" to discard the draft and start from the live site.',
      }
    }
    throw err
  }
}

export type RepoStatus = {
  draftAhead: number
  draftBehind: number
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitAt: string | null
  /** True when main's HEAD is a publish merge that revertLastPublish can undo. */
  canRevertPublish: boolean
}

const PUBLISH_MERGE_MESSAGE = 'Publish draft to live'

// main HEAD must be the merge commit our publish created — two parents and
// the exact publish message. Anything else (manual commits, GitHub-side
// merges) is not safe to force-revert blindly.
async function isPublishMergeHead(slug: string) {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const head = await octokit.repos.getCommit({ owner, repo, ref: MAIN_BRANCH })
  const isPublish =
    head.data.parents.length === 2 &&
    head.data.commit.message.startsWith(PUBLISH_MERGE_MESSAGE)
  return { isPublish, parentSha: head.data.parents[0]?.sha ?? null }
}

export async function getStatus(slug: string): Promise<RepoStatus> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const cmp = await octokit.repos.compareCommits({
    owner,
    repo,
    base: MAIN_BRANCH,
    head: DRAFT_BRANCH,
  })
  const head = cmp.data.commits.at(-1)
  let canRevertPublish = false
  try {
    canRevertPublish = (await isPublishMergeHead(slug)).isPublish
  } catch {
    // Status must stay usable even if the HEAD lookup hiccups.
  }
  return {
    draftAhead: cmp.data.ahead_by,
    draftBehind: cmp.data.behind_by,
    lastCommitSha: head?.sha ?? null,
    lastCommitMessage: head?.commit.message ?? null,
    lastCommitAt: head?.commit.author?.date ?? null,
    canRevertPublish,
  }
}

export type RevertResult =
  | { reverted: true; revertedTo: string }
  | { reverted: false; reason: string }

// Undo the most recent publish: force main back to the merge commit's first
// parent (the pre-publish live state). Draft is left alone — it still holds
// the published content, so the admin can fix it there and publish again.
export async function revertLastPublish(slug: string): Promise<RevertResult> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const { isPublish, parentSha } = await isPublishMergeHead(slug)
  if (!isPublish || !parentSha) {
    return {
      reverted: false,
      reason: 'The live branch tip is not a publish merge — nothing safe to revert.',
    }
  }
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${MAIN_BRANCH}`,
    sha: parentSha,
    force: true,
  })
  return { reverted: true, revertedTo: parentSha }
}

export type ChangedFile = {
  /** Path on the draft branch (the current name for a rename). */
  path: string
  /** Raw GitHub compare status: added | modified | removed | renamed | changed | copied. */
  status: string
  additions: number
  deletions: number
  /** Unified diff hunk text; null for binary blobs (images) or when GitHub omits it. */
  patch: string | null
  /** Blob sha of the file at the draft tip — the optimistic-lock token for revert. */
  blobSha: string
  /** True when no textual patch is available (image/asset). */
  isBinary: boolean
  /** Prior path when status is 'renamed'. */
  previousPath: string | null
  /** Author of the newest commit that touched this path on the draft branch. */
  author: { name: string; email: string } | null
  date: string | null
  message: string | null
}

// List every file the draft branch changed relative to live (main) — the
// unpublished changes. compareCommits gives the per-file status + diff; we
// attribute each file to the newest draft commit that touched it (who last
// edited it, and when) by walking the ahead-commits newest-first. Bounded to
// `ahead_by` getCommit calls. Mirrors getStatus()'s compareCommits usage.
export async function getDraftChanges(slug: string): Promise<{ files: ChangedFile[] }> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const cmp = await octokit.repos.compareCommits({
    owner,
    repo,
    base: MAIN_BRANCH,
    head: DRAFT_BRANCH,
  })

  // compareCommits.commits are oldest→newest; walk in reverse so the first
  // commit we see touching a path is the most recent editor (first write wins).
  const commits = cmp.data.commits ?? []
  const attribution = new Map<string, { author: { name: string; email: string }; date: string | null; message: string }>()
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i]
    const detail = await octokit.repos.getCommit({ owner, repo, ref: c.sha })
    const info = {
      author: {
        name: c.commit.author?.name ?? c.commit.committer?.name ?? '',
        email: c.commit.author?.email ?? c.commit.committer?.email ?? '',
      },
      date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
      message: c.commit.message,
    }
    for (const f of detail.data.files ?? []) {
      if (!attribution.has(f.filename)) attribution.set(f.filename, info)
    }
  }

  const files: ChangedFile[] = (cmp.data.files ?? []).map((f) => {
    const attr = attribution.get(f.filename) ?? null
    return {
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
      blobSha: f.sha,
      isBinary: f.patch == null,
      previousPath: f.previous_filename ?? null,
      author: attr?.author ?? null,
      date: attr?.date ?? null,
      message: attr?.message ?? null,
    }
  })

  return { files }
}

export type RevertFileResult = {
  reverted: true
  commitSha: string
  action: 'restored' | 'removed'
}

// Undo a single file's unpublished changes by making the draft copy match live
// (main), before anything is published. Three cases, all optimistically locked
// against the draft blob the caller last saw (expectedSha):
//   - file exists on main + draft  → restore live content onto draft (modified)
//   - file exists on main, not draft → re-create it on draft (was deleted)
//   - file absent on main            → delete it from draft (was newly added,
//                                       incl. the new-name side of a rename)
// A concurrent edit (draft sha moved) surfaces as StaleShaError → 409.
export async function revertFileToMain(
  slug: string,
  path: string,
  expectedSha: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<RevertFileResult> {
  const name = path.split('/').pop() ?? path
  const attribution = options.authorEmail ? ` (${options.authorEmail})` : ''

  let liveContent: string | null = null
  try {
    liveContent = (await readFile(slug, path, MAIN_BRANCH)).content
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
  }
  const draftSha = await currentSha(slug, path, DRAFT_BRANCH)

  if (liveContent === null) {
    // Not on live → the draft added it → undo = remove it from draft.
    if (draftSha === null) return { reverted: true, commitSha: '', action: 'removed' }
    if (expectedSha && draftSha !== expectedSha) throw new StaleShaError(path, draftSha, '')
    const res = await deleteFile(
      slug,
      path,
      DRAFT_BRANCH,
      draftSha,
      `Revert (remove) ${name} via admin${attribution}`,
      { authorName: options.authorName, authorEmail: options.authorEmail }
    )
    return { reverted: true, commitSha: res.commitSha, action: 'removed' }
  }

  // Live has the file → restore its content onto draft. Guard with the draft
  // sha only when the file is still present there; if the draft deleted it,
  // re-create without a guard (there is no draft blob to match).
  if (draftSha === null) {
    const res = await writeFile(
      slug,
      path,
      liveContent,
      DRAFT_BRANCH,
      `Revert ${name} to live via admin${attribution}`,
      { authorName: options.authorName, authorEmail: options.authorEmail }
    )
    return { reverted: true, commitSha: res.commitSha, action: 'restored' }
  }
  if (expectedSha && draftSha !== expectedSha) throw new StaleShaError(path, draftSha, '')
  const res = await writeFile(
    slug,
    path,
    liveContent,
    DRAFT_BRANCH,
    `Revert ${name} to live via admin${attribution}`,
    { expectedSha: draftSha, authorName: options.authorName, authorEmail: options.authorEmail }
  )
  return { reverted: true, commitSha: res.commitSha, action: 'restored' }
}
