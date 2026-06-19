'use client'

import { useEffect, useRef, useState } from 'react'
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

// Compact draft/save state shown as a single dotted pill instead of a sentence.
function statusPill(
  status: EditorStatus | null,
  dirtyCount: number
): { text: string; dot: string } {
  if (status === null) return { text: 'Loading…', dot: 'bg-text-muted' }
  const ahead = status.draftAhead
  if (dirtyCount > 0) {
    const prefix = ahead > 0 ? `${ahead} to publish · ` : ''
    return { text: `${prefix}${dirtyCount} unsaved`, dot: 'bg-warning' }
  }
  if (ahead > 0) return { text: `${ahead} to publish`, dot: 'bg-brand-navy' }
  return { text: 'Up to date with live', dot: 'bg-brand-cyan' }
}

function OverflowMenu({
  websiteUrl,
  status,
  publishing,
  onRollback,
}: {
  websiteUrl: string
  status: EditorStatus
  publishing: boolean
  onRollback: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const preview = previewUrl(status.repo)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemClass =
    'block w-full text-left px-3 py-2 text-xs font-heading rounded transition-colors hover:bg-surface-subtle'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
        className="rounded-pill border border-border-default text-text-secondary hover:bg-surface-subtle font-heading font-semibold text-xs px-3 py-1.5 transition-colors"
      >
        •••
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 bg-surface-card border border-border-default rounded-lg shadow-elevated z-50 p-1"
        >
          <div className="px-3 py-2">
            <div className="text-[11px] font-body text-text-secondary truncate">{websiteUrl}</div>
            <div className="text-[10px] font-mono text-text-muted truncate">{status.repo}</div>
          </div>
          <div className="border-t border-border-default my-1" />
          {preview && (
            <a
              href={preview}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              className={`${itemClass} text-brand-cyan hover:text-brand-navy`}
              onClick={() => setOpen(false)}
            >
              Preview draft ↗
            </a>
          )}
          <a
            href={status.repoUrl}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            className={`${itemClass} text-text-secondary hover:text-brand-cyan`}
            onClick={() => setOpen(false)}
          >
            Open on GitHub ↗
          </a>
          {status.canRevertPublish && (
            <>
              <div className="border-t border-border-default my-1" />
              <button
                type="button"
                role="menuitem"
                disabled={publishing}
                onClick={() => {
                  setOpen(false)
                  onRollback()
                }}
                className={`${itemClass} text-error hover:bg-error/5 disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Force the live site back to its pre-publish state. Draft keeps the changes for fixing."
              >
                Revert last publish
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
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
  onSave: () => void
  onPublish: () => void
  onRollback: () => void
}) {
  const pill = statusPill(status, dirtyCount)

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border-default bg-surface-card">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/admin/dashboard"
          className="text-text-muted hover:text-brand-cyan font-heading text-xs whitespace-nowrap"
        >
          ← Dashboard
        </Link>
        <h1 className="font-heading font-semibold text-sm text-brand-navy truncate max-w-[18rem]">
          {firmName}
        </h1>
        <span className="inline-flex items-center gap-1.5 text-xs font-body text-text-secondary whitespace-nowrap">
          <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
          {pill.text}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onSave}
          disabled={!canSave || saving}
          className="bg-brand-cyan disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed whitespace-nowrap"
          title={selectedPath ? `Save ${selectedPath}` : 'Select a file to save'}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onPublish}
          disabled={publishing || (status?.draftAhead ?? 0) === 0 || dirtyCount > 0}
          className="bg-brand-navy disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-navy-dark disabled:cursor-not-allowed whitespace-nowrap"
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
        {status && (
          <OverflowMenu
            websiteUrl={websiteUrl}
            status={status}
            publishing={publishing}
            onRollback={onRollback}
          />
        )}
      </div>
    </header>
  )
}
