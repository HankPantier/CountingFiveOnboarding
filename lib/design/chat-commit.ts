// Server-only (via the workspace). Committing the design chat's working copy:
// the chat render gate (Task 7), then THE shared commit path
// (commitDesignVersion, injected so tests can fake it) with source 'chat',
// removeLegacy false, syncMbp false (an interactive AI session never mirrors
// into schema_data), the stale guard on the blobs the workspace was built on
// (turn start, or its last commit's applied blobs — so a second commit in the
// same turn builds on the first), and skip-if-unchanged. finishTurnCommit is
// the end-of-turn auto-commit: whatever is still staged when the model stops
// is saved — unless the stream failed (then it is discarded, never
// half-committed) — and the outcome is streamed as a data-design-commit part.
import type { CommitOutput, DesignCommitData } from './chat-types'
import { chatCommitGate, chatGateMessage } from './chat-gate'
import type { ChatWorkspace } from './chat-workspace'
import type { CommitTarget, CommitVersionArgs, CommitVersionResult } from './commit-version'

export type CommitVersionFn = (args: CommitVersionArgs) => Promise<CommitVersionResult>

export const STAGED_DISCARDED_ERROR = 'The reply was interrupted, so its staged changes were discarded — nothing from this turn’s unsaved edits reached the draft.'
export const COMMIT_FAILED_ERROR = 'Saving the changes failed — nothing was committed. Try again.'

export async function commitWorkspace(
  ws: ChatWorkspace,
  args: { summary: string; target: CommitTarget; commitVersion: CommitVersionFn }
): Promise<CommitOutput> {
  if (!ws.isStaged()) return { ok: true, unchanged: true }
  const preview = ws.currentPreview()
  const gate = chatCommitGate(preview)
  if (!gate.ok) return { ok: false, error: chatGateMessage(gate.failures), failures: gate.failures }

  const summary = (args.summary.trim() || ws.pendingSummary() || 'theme update').slice(0, 300)
  const result = await args.commitVersion({
    target: args.target,
    bundle: ws.bundle(),
    source: 'chat',
    removeLegacy: false,
    syncMbp: false,
    summary: `Chat: ${summary}`,
    commitMessage: `Design Studio chat: ${summary} (${args.target.adminEmail ?? 'admin'})`,
    screenshots: preview?.shots ?? [],
    expectedShas: ws.draftShas(),
    skipIfUnchanged: true,
  })
  if (!result.ok) return { ok: false, error: result.error }
  // The FULL applied_blobs map becomes the base (and sha guard) of the next commit.
  ws.markCommitted(result.appliedBlobs, result.version?.id ?? null)
  if (!result.version) return { ok: true, unchanged: true }
  return { ok: true, versionId: result.version.id, versionNo: result.version.version_no, changedPaths: result.changedPaths, warnings: gate.warnings }
}

export type TurnCommitOutcome = DesignCommitData | { status: 'none' }

export async function finishTurnCommit(
  ws: ChatWorkspace,
  commit: (summary: string) => Promise<CommitOutput>,
  streamFailed: boolean
): Promise<TurnCommitOutcome> {
  if (!ws.isStaged()) return { status: 'none' }
  if (streamFailed) return { status: 'blocked', error: STAGED_DISCARDED_ERROR, failures: [] }
  try {
    const out = await commit(ws.pendingSummary())
    if (!out.ok) return { status: 'blocked', error: out.error, failures: out.failures ?? [] }
    if ('unchanged' in out) return { status: 'none' }
    return { status: 'committed', versionId: out.versionId, versionNo: out.versionNo, changedPaths: out.changedPaths, warnings: out.warnings, auto: true }
  } catch (err) {
    console.error('[design-chat] auto-commit failed', err)
    return { status: 'blocked', error: COMMIT_FAILED_ERROR, failures: [] }
  }
}
