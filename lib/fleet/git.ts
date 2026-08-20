import { RequestError } from '@octokit/request-error'
import { getOctokit, resolveRepo } from '@/lib/github/app-client'
import { MAIN_BRANCH } from '@/lib/github/repo-files'

// The dedicated, non-live branch a fleet rollout stages onto. Kept separate from
// the editor's `draft` branch so a rollout never clobbers a client's in-flight
// content edits, and so promoting a rollout never publishes unrelated draft work.
export const SYNC_BRANCH = 'template-sync'

// Merge message stamped on a fleet promote — mirrors repo-files' publish marker
// so revertLastFleetPublish can recognise (and only ever undo) our own merge.
export const FLEET_MERGE_MESSAGE = 'Fleet rollout: publish template-sync to live'

function isRequestError(err: unknown): err is RequestError {
  return err instanceof RequestError
}

// Force-(re)create the template-sync branch at the client's current main HEAD, so
// each stage starts from the live tree. Overwrites any prior, un-promoted sync
// branch (that content was never live).
export async function resetSyncBranchToMain(slug: string): Promise<string> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const main = await octokit.git.getRef({ owner, repo, ref: `heads/${MAIN_BRANCH}` })
  const sha = main.data.object.sha
  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${SYNC_BRANCH}` })
    await octokit.git.updateRef({ owner, repo, ref: `heads/${SYNC_BRANCH}`, sha, force: true })
  } catch (err) {
    if (!isRequestError(err) || err.status !== 404) throw err
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${SYNC_BRANCH}`, sha })
  }
  return sha
}

export interface BranchCompare {
  ahead: number
  behind: number
  headSha: string | null
  headMessage: string | null
  headAt: string | null
}

// How far template-sync is ahead of / behind main. ahead=0 → nothing staged.
export async function compareSyncToMain(slug: string): Promise<BranchCompare> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const cmp = await octokit.repos.compareCommits({
    owner,
    repo,
    base: MAIN_BRANCH,
    head: SYNC_BRANCH,
  })
  const head = cmp.data.commits.at(-1)
  return {
    ahead: cmp.data.ahead_by,
    behind: cmp.data.behind_by,
    headSha: head?.sha ?? null,
    headMessage: head?.commit.message ?? null,
    headAt: head?.commit.author?.date ?? null,
  }
}

export type FleetMergeResult =
  | { merged: true; mergeCommitSha: string; nothingToDo: boolean }
  | { merged: false; prUrl: string }

async function ensureSyncPr(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string
): Promise<string> {
  const head = `${owner}:${SYNC_BRANCH}`
  const existing = await octokit.pulls.list({ owner, repo, base: MAIN_BRANCH, head, state: 'open' })
  if (existing.data.length > 0) return existing.data[0].html_url
  try {
    const pr = await octokit.pulls.create({
      owner,
      repo,
      head: SYNC_BRANCH,
      base: MAIN_BRANCH,
      title: 'Fleet rollout (manual resolve required)',
      body: 'A fleet rollout hit a conflict between `template-sync` and `main`. Resolve here and merge to deploy.',
    })
    return pr.data.html_url
  } catch (err) {
    if (isRequestError(err) && err.status === 422) {
      const retry = await octokit.pulls.list({ owner, repo, base: MAIN_BRANCH, head, state: 'open' })
      if (retry.data.length > 0) return retry.data[0].html_url
    }
    throw err
  }
}

// Promote the staged rollout: merge template-sync into main (fast-forward/clean).
// On conflict, open (or reuse) a PR for manual resolution rather than forcing.
export async function mergeSyncToMain(slug: string): Promise<FleetMergeResult> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const cmp = await octokit.repos.compareCommits({ owner, repo, base: MAIN_BRANCH, head: SYNC_BRANCH })
  if (cmp.data.ahead_by === 0) return { merged: true, mergeCommitSha: '', nothingToDo: true }
  try {
    const res = await octokit.repos.merge({
      owner,
      repo,
      base: MAIN_BRANCH,
      head: SYNC_BRANCH,
      commit_message: FLEET_MERGE_MESSAGE,
    })
    return { merged: true, mergeCommitSha: res.data.sha, nothingToDo: false }
  } catch (err) {
    if (!isRequestError(err) || err.status !== 409) throw err
    return { merged: false, prUrl: await ensureSyncPr(octokit, owner, repo) }
  }
}

export type FleetRevertResult =
  | { reverted: true; revertedTo: string }
  | { reverted: false; reason: string }

// Undo the most recent fleet promote: force main back to the merge commit's first
// parent (the pre-rollout live state). Only acts when main's HEAD is exactly our
// two-parent fleet merge, so it can never blow away unrelated commits.
export async function revertLastFleetPublish(slug: string): Promise<FleetRevertResult> {
  const octokit = getOctokit()
  const { owner, repo } = resolveRepo(slug)
  const head = await octokit.repos.getCommit({ owner, repo, ref: MAIN_BRANCH })
  const isFleetMerge =
    head.data.parents.length === 2 && head.data.commit.message.startsWith(FLEET_MERGE_MESSAGE)
  const parentSha = head.data.parents[0]?.sha ?? null
  if (!isFleetMerge || !parentSha) {
    return { reverted: false, reason: 'Live tip is not a fleet-rollout merge — nothing safe to revert.' }
  }
  await octokit.git.updateRef({ owner, repo, ref: `heads/${MAIN_BRANCH}`, sha: parentSha, force: true })
  return { reverted: true, revertedTo: parentSha }
}
