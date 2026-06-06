'use client'

import Link from 'next/link'

export type EditorStatus = {
  draftAhead: number
  draftBehind: number
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitAt: string | null
  canRevertPublish: boolean
  repo: string
  repoUrl: string
}

// Vercel's stable branch-preview URL: {project}-git-{branch}-{team}.vercel.app.
// Assumes the Vercel project name matches the repo name (our convention).
// Hidden when the team slug env var isn't configured.
function previewUrl(repo: string): string | null {
  const team = process.env.NEXT_PUBLIC_VERCEL_TEAM_SLUG
  if (!team) return null
  const name = repo.split('/').pop()
  if (!name) return null
  return `https://${name}-git-draft-${team}.vercel.app`
}

export default function EditorTopBar({
  firmName,
  websiteUrl,
  status,
  dirtyCount,
  selectedPath,
  canSave,
  saving,
  publishing,
  publishResult,
  onSave,
  onPublish,
  onRollback,
}: {
  firmName: string
  websiteUrl: string
  status: EditorStatus | null
  dirtyCount: number
  selectedPath: string | null
  canSave: boolean
  saving: boolean
  publishing: boolean
  publishResult: string | null
  onSave: () => void
  onPublish: () => void
  onRollback: () => void
}) {
  const aheadLabel =
    status === null
      ? 'Loading…'
      : status.draftAhead === 0 && dirtyCount === 0
        ? 'Up to date with live'
        : `${status.draftAhead} commit${status.draftAhead === 1 ? '' : 's'} on draft · ${dirtyCount} unsaved`

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border-default bg-surface-card">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/admin/dashboard"
          className="text-text-muted hover:text-brand-cyan font-heading text-xs whitespace-nowrap"
        >
          ← Dashboard
        </Link>
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="font-heading font-semibold text-sm text-brand-navy truncate max-w-[16rem]">
            {firmName}
          </h1>
          <span aria-hidden className="text-text-muted hidden md:inline">·</span>
          <span className="text-xs font-body text-text-muted truncate hidden md:inline max-w-[14rem]">
            {websiteUrl}
          </span>
          {status && (
            <>
              <span aria-hidden className="text-text-muted hidden lg:inline">·</span>
              <span className="font-mono text-[10px] text-text-muted truncate hidden lg:inline max-w-[14rem]">
                {status.repo}
              </span>
            </>
          )}
        </div>
        <span className="text-xs font-body text-text-muted whitespace-nowrap hidden sm:inline">
          {aheadLabel}
        </span>
        {publishResult && (
          <span className="text-xs font-body text-success bg-success/10 px-2 py-0.5 rounded">
            {publishResult}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {status && previewUrl(status.repo) && (
          <a
            href={previewUrl(status.repo)!}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-heading text-brand-cyan hover:text-brand-navy whitespace-nowrap"
          >
            Preview draft ↗
          </a>
        )}
        {status && (
          <a
            href={status.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-heading text-text-muted hover:text-brand-cyan"
          >
            Open on GitHub ↗
          </a>
        )}
        <button
          onClick={onSave}
          disabled={!canSave || saving}
          className="bg-brand-cyan disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed"
          title={selectedPath ? `Save ${selectedPath}` : 'Select a file to save'}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status?.canRevertPublish && (
          <button
            onClick={onRollback}
            disabled={publishing}
            className="border border-error/40 text-error font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-error/5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            title="Force the live site back to its pre-publish state. Draft keeps the changes for fixing."
          >
            Revert last publish
          </button>
        )}
        <button
          onClick={onPublish}
          disabled={publishing || (status?.draftAhead ?? 0) === 0 || dirtyCount > 0}
          className="bg-brand-navy disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-brand-navy-dark disabled:cursor-not-allowed"
          title={
            dirtyCount > 0
              ? 'Save your unsaved changes first'
              : (status?.draftAhead ?? 0) === 0
                ? 'Nothing new to publish'
                : 'Deploy your saved draft changes to the live site'
          }
        >
          {publishing ? 'Publishing…' : 'Publish to live'}
        </button>
      </div>
    </header>
  )
}
