import { RequestError } from '@octokit/request-error'
import { getOctokit, resolveRepo } from './app-client'

export const DRAFT_BRANCH = 'draft'
export const MAIN_BRANCH = 'main'

export type TreeEntry = {
  path: string
  sha: string
  type: 'blob' | 'tree'
}

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
    (n): n is { path: string; sha: string; type: 'blob' | 'tree' } =>
      typeof n.path === 'string' &&
      typeof n.sha === 'string' &&
      (n.type === 'blob' || n.type === 'tree')
  )
  return filtered
    .filter((n) => !prefix || n.path.startsWith(prefix))
    .map((n) => ({ path: n.path, sha: n.sha, type: n.type }))
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

// Returns { merged: true } on fast-forward / clean merge,
// or { merged: false, prUrl } if a PR had to be opened due to conflict.
export type MergeResult =
  | { merged: true; mergeCommitSha: string }
  | { merged: false; prUrl: string }

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
    // Conflict — open a PR so the admin can resolve in GitHub's UI.
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
    return { merged: false, prUrl: pr.data.html_url }
  }
}

// Force-update draft branch to point at main's HEAD. Used after a successful
// publish so the next round of edits starts from a clean base.
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

export type RepoStatus = {
  draftAhead: number
  draftBehind: number
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitAt: string | null
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
  return {
    draftAhead: cmp.data.ahead_by,
    draftBehind: cmp.data.behind_by,
    lastCommitSha: head?.sha ?? null,
    lastCommitMessage: head?.commit.message ?? null,
    lastCommitAt: head?.commit.author?.date ?? null,
  }
}
