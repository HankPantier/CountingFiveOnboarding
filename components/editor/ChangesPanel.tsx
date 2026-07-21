'use client'

import { useCallback, useEffect, useState } from 'react'

// One changed file from GET /api/edit/[id]/changes — mirrors ChangedFile in
// lib/github/repo-files.ts.
type ChangedFile = {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string | null
  blobSha: string
  isBinary: boolean
  previousPath: string | null
  author: { name: string; email: string } | null
  date: string | null
  message: string | null
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// GitHub compare status → display label + pill styling (mirrors the admin
// StatusPill conventions). 'changed'/'copied' fold into the closest verb.
function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'added':
      return { label: 'Added', cls: 'bg-success/10 text-success' }
    case 'removed':
      return { label: 'Deleted', cls: 'bg-error/10 text-error' }
    case 'renamed':
      return { label: 'Renamed', cls: 'bg-brand-cyan/10 text-brand-cyan-dark' }
    case 'modified':
    case 'changed':
    case 'copied':
    default:
      return { label: 'Edited', cls: 'bg-brand-navy/10 text-brand-navy' }
  }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

// Render a unified-diff patch (hunks only — GitHub omits the file preamble).
function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n')
  return (
    <pre className="mt-2 overflow-x-auto rounded border border-border-default bg-surface-default p-2 text-[11px] leading-relaxed font-mono">
      {lines.map((line, i) => {
        const first = line[0]
        const cls =
          first === '+'
            ? 'text-success bg-success/5'
            : first === '-'
              ? 'text-error bg-error/5'
              : first === '@'
                ? 'text-info/70'
                : 'text-text-secondary'
        return (
          <div key={i} className={`whitespace-pre ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export default function ChangesPanel({
  sessionId,
  draftBusy,
  onReverted,
  onDiscardAll,
}: {
  sessionId: string
  draftBusy: boolean
  // Called after a single file is reverted, so the parent drops its cached
  // copy (loaded/dirty) and refreshes the tree + publish status.
  onReverted: (path: string) => void | Promise<void>
  // Runs the parent's "Reset draft to live" flow (confirm + reload). Resolves
  // when done so the panel can refetch its (now empty) list.
  onDiscardAll: () => Promise<void>
}) {
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [revertingPath, setRevertingPath] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/edit/${sessionId}/changes`)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load changes: ${res.status}`)
    }
    const data = (await res.json()) as { files: ChangedFile[] }
    setFiles(data.files)
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load changes'))
      .finally(() => setLoading(false))
  }, [refresh])

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const revert = async (file: ChangedFile) => {
    if (
      !window.confirm(
        `Undo the unpublished changes to ${fileName(file.path)}? It goes back to the live version. This does not affect the live site until you publish.`
      )
    ) {
      return
    }
    setRevertingPath(file.path)
    setError(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/revert-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, expectedSha: file.blobSha }),
      })
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        setError(data.message ?? 'This file changed on the server. Refreshing the list.')
        await refresh()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Undo failed: ${res.status}`)
      }
      await onReverted(file.path)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed')
    } finally {
      setRevertingPath(null)
    }
  }

  const discardAll = async () => {
    setError(null)
    try {
      await onDiscardAll()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discard failed')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-brand-navy">Unpublished changes</h2>
          <p className="mt-0.5 text-xs font-body text-text-muted">
            Edits saved to your draft that haven’t been published to the live site yet. Undo any of
            them here before you publish.
          </p>
        </div>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => void discardAll()}
            disabled={draftBusy}
            className="shrink-0 rounded-pill border border-error/40 px-3.5 py-1.5 font-heading font-semibold text-xs text-error hover:bg-error/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Discard all unpublished draft edits and start fresh from the live site."
          >
            {draftBusy ? 'Discarding…' : 'Discard all'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-body text-warning-strong">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm font-body text-text-muted">Loading changes…</p>
      ) : files.length === 0 ? (
        <p className="text-sm font-body text-text-muted">
          No unpublished changes — your draft matches the live site.
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => {
            const badge = statusBadge(file.status)
            const isOpen = expanded.has(file.path)
            const who = file.author?.name || file.author?.email || 'unknown'
            return (
              <li
                key={file.path}
                className="rounded-lg border border-border-default bg-surface-card"
              >
                <div className="flex items-center gap-3 p-3">
                  <span
                    className={`inline-flex shrink-0 items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-body text-text-primary" title={file.path}>
                      {fileName(file.path)}
                    </div>
                    <div className="mt-0.5 text-[11px] font-body text-text-muted">
                      {who}
                      {file.date && ` · ${relativeTime(file.date)}`}
                      {file.previousPath && ` · from ${fileName(file.previousPath)}`}
                    </div>
                  </div>
                  {!file.isBinary && file.patch && (
                    <button
                      type="button"
                      onClick={() => toggle(file.path)}
                      aria-expanded={isOpen}
                      className="shrink-0 text-[11px] font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors"
                    >
                      {isOpen ? 'Hide diff' : 'View diff'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void revert(file)}
                    disabled={revertingPath === file.path || draftBusy}
                    className="shrink-0 rounded-pill border border-brand-navy px-3 py-1 font-heading font-semibold text-[11px] text-brand-navy hover:bg-brand-navy/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Revert this file to the live version"
                  >
                    {revertingPath === file.path ? 'Undoing…' : 'Undo'}
                  </button>
                </div>
                {isOpen && !file.isBinary && file.patch && (
                  <div className="border-t border-border-default px-3 pb-3">
                    <DiffView patch={file.patch} />
                  </div>
                )}
                {file.isBinary && (
                  <div className="border-t border-border-default px-3 py-2 text-[11px] font-body text-text-muted">
                    Asset changed — no text preview.
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
