// ---------------------------------------------------------------------------
// Seed a client site repo from counting-five-client-template.
//
// Git objects are not shared across repositories, so seeding an already-created
// repo means re-creating every template blob in the target and committing them.
// This is a one-time, ~2-calls-per-file operation (177 files today), so it runs
// from its OWN admin route with a generous maxDuration — never inline on the
// package-assembly path, which is already near its Vercel budget.
//
// Idempotent: if the target already carries the template (marker file present),
// seeding is skipped and existing files are left untouched — the deliverable's
// content/ + public/ paths are overlaid later by the normal push.
//
// Server-only: authenticates as the GitHub App installation.
// ---------------------------------------------------------------------------
import { RequestError } from '@octokit/request-error'
import { getOctokit, resolveRepo } from './app-client'
import { ensureDraftBranch, MAIN_BRANCH } from './repo-files'

// Presence of this file on the target's main branch means the repo has already
// been seeded (created from the template, or seeded by a prior run).
const SEED_MARKER_PATH = 'package.json'

// How many template blobs to copy at once. Bounded so a 177-file template can't
// burst hundreds of concurrent GitHub calls (mirrors the assembler's batching).
const BLOB_COPY_CONCURRENCY = 10

// Git tree blob modes we preserve verbatim; anything else is coerced to a
// regular file. (Submodules / directory entries are filtered out before here.)
type BlobMode = '100644' | '100755' | '120000'
function normalizeMode(mode: string | undefined): BlobMode {
  return mode === '100755' || mode === '120000' ? mode : '100644'
}

function isRequestError(err: unknown): err is RequestError {
  return err instanceof RequestError
}

export function resolveTemplateSlug(): string {
  // Fully-qualified default: the target repo slug may carry an explicit owner
  // that differs from GITHUB_ORG, so don't rely on the bare-name owner default.
  return process.env.GITHUB_TEMPLATE_REPO?.trim() || 'HankPantier/CountingFiveTemplate'
}

export type SeedResult =
  | { seeded: false; skipped: 'already-seeded'; fileCount: 0 }
  | { seeded: true; fileCount: number; commitSha: string }

// True when the target repo already contains the template marker on main.
// A missing marker, a missing main branch, or an empty repo all read as "not
// seeded" so a freshly-created empty repo qualifies for seeding.
export async function isRepoSeeded(slug: string): Promise<boolean> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  try {
    await octokit.repos.getContent({ owner, repo, path: SEED_MARKER_PATH, ref: MAIN_BRANCH })
    return true
  } catch (err) {
    if (isRequestError(err) && (err.status === 404 || err.status === 409)) return false
    throw err
  }
}

export async function seedRepoFromTemplate(
  slug: string,
  options: { authorName?: string; authorEmail?: string } = {}
): Promise<SeedResult> {
  if (await isRepoSeeded(slug)) {
    return { seeded: false, skipped: 'already-seeded', fileCount: 0 }
  }

  const octokit = getOctokit()
  const target = resolveRepo(slug)
  const template = resolveRepo(resolveTemplateSlug())

  // Read the template's default-branch tree in one recursive call.
  const templateRepo = await octokit.repos.get({ owner: template.owner, repo: template.repo })
  const templateBranch = templateRepo.data.default_branch
  const templateRef = await octokit.git.getRef({
    owner: template.owner,
    repo: template.repo,
    ref: `heads/${templateBranch}`,
  })
  const templateCommit = await octokit.git.getCommit({
    owner: template.owner,
    repo: template.repo,
    commit_sha: templateRef.data.object.sha,
  })
  const templateTree = await octokit.git.getTree({
    owner: template.owner,
    repo: template.repo,
    tree_sha: templateCommit.data.tree.sha,
    recursive: 'true',
  })
  if (templateTree.data.truncated) {
    throw new Error('Template tree is too large to seed in one pass (GitHub truncated the listing)')
  }

  const blobs = templateTree.data.tree.filter(
    (n): n is { path: string; sha: string; type: 'blob'; mode?: string } =>
      n.type === 'blob' && typeof n.path === 'string' && typeof n.sha === 'string'
  )
  if (blobs.length === 0) {
    throw new Error(`Template ${template.owner}/${template.repo} has no files to seed`)
  }

  // Re-create each template blob in the target and collect tree entries.
  const treeEntries: { path: string; mode: BlobMode; type: 'blob'; sha: string }[] = []
  for (let i = 0; i < blobs.length; i += BLOB_COPY_CONCURRENCY) {
    const batch = blobs.slice(i, i + BLOB_COPY_CONCURRENCY)
    const copied = await Promise.all(
      batch.map(async (b) => {
        const blob = await octokit.git.getBlob({
          owner: template.owner,
          repo: template.repo,
          file_sha: b.sha,
        })
        // getBlob returns 'base64' (normal) or 'utf-8'; it returns 'none' for
        // blobs >100MB, whose content can't be round-tripped this way. Guard so
        // that surfaces as a clear, file-named error instead of a cryptic
        // "Unknown encoding" crash mid-batch.
        if (blob.data.encoding !== 'base64' && blob.data.encoding !== 'utf-8') {
          throw new Error(`Cannot seed ${b.path}: unsupported blob encoding "${blob.data.encoding}"`)
        }
        // Normalize to base64 (getBlob wraps base64 at 60 cols) before re-upload.
        const content = Buffer.from(blob.data.content, blob.data.encoding).toString('base64')
        const created = await octokit.git.createBlob({
          owner: target.owner,
          repo: target.repo,
          content,
          encoding: 'base64',
        })
        return { path: b.path, mode: normalizeMode(b.mode), type: 'blob' as const, sha: created.data.sha }
      })
    )
    treeEntries.push(...copied)
  }

  // Determine whether main already exists (repo created with a README) so we
  // overlay onto it, or is empty (no commits) so we create the first commit.
  let baseTreeSha: string | undefined
  let parents: string[] = []
  try {
    const mainRef = await octokit.git.getRef({ owner: target.owner, repo: target.repo, ref: `heads/${MAIN_BRANCH}` })
    const mainCommit = await octokit.git.getCommit({
      owner: target.owner,
      repo: target.repo,
      commit_sha: mainRef.data.object.sha,
    })
    baseTreeSha = mainCommit.data.tree.sha
    parents = [mainRef.data.object.sha]
  } catch (err) {
    if (!isRequestError(err) || (err.status !== 404 && err.status !== 409)) throw err
  }

  const newTree = await octokit.git.createTree({
    owner: target.owner,
    repo: target.repo,
    tree: treeEntries,
    ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
  })
  const commit = await octokit.git.createCommit({
    owner: target.owner,
    repo: target.repo,
    message: `Seed site from ${template.owner}/${template.repo}`,
    tree: newTree.data.sha,
    parents,
    ...(options.authorName && options.authorEmail
      ? { author: { name: options.authorName, email: options.authorEmail } }
      : {}),
  })

  if (parents.length > 0) {
    await octokit.git.updateRef({
      owner: target.owner,
      repo: target.repo,
      ref: `heads/${MAIN_BRANCH}`,
      sha: commit.data.sha,
    })
  } else {
    await octokit.git.createRef({
      owner: target.owner,
      repo: target.repo,
      ref: `refs/heads/${MAIN_BRANCH}`,
      sha: commit.data.sha,
    })
  }

  // The editor and the assembly push both work off the draft branch — make sure
  // it exists now that main does.
  await ensureDraftBranch(slug)

  return { seeded: true, fileCount: treeEntries.length, commitSha: commit.data.sha }
}
