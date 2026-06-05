'use client'

import Link from 'next/link'

export type EditorStatus = {
  draftAhead: number
  draftBehind: number
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitAt: string | null
  repo: string
  repoUrl: string
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
        <div className="flex flex-col min-w-0">
          <h1 className="font-heading font-semibold text-sm text-brand-navy truncate">
            {firmName}
          </h1>
          <div className="flex items-center gap-2 text-xs font-body text-text-muted truncate">
            <span className="truncate">{websiteUrl}</span>
            {status && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono text-[10px] text-text-muted truncate">
                  {status.repo}
                </span>
              </>
            )}
          </div>
        </div>
        <span className="text-xs font-body text-text-muted whitespace-nowrap">{aheadLabel}</span>
        {publishResult && (
          <span className="text-xs font-body text-success bg-success/10 px-2 py-0.5 rounded">
            {publishResult}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
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
        <button
          onClick={onPublish}
          disabled={publishing || (status?.draftAhead ?? 0) === 0 || dirtyCount > 0}
          className="bg-brand-navy disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-brand-navy-dark disabled:cursor-not-allowed"
          title={
            dirtyCount > 0
              ? 'Save your unsaved changes first'
              : (status?.draftAhead ?? 0) === 0
                ? 'Nothing new to publish'
                : 'Merge draft into main and trigger a production deploy'
          }
        >
          {publishing ? 'Publishing…' : 'Publish to live'}
        </button>
      </div>
    </header>
  )
}
