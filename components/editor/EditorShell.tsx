'use client'

import { useCallback, useEffect, useState } from 'react'
import EditorTopBar, { type EditorStatus } from './EditorTopBar'
import FileTree, { MEDIA_VIEW, RESOURCES_VIEW, ONEOFF_VIEW, type TreeFile } from './FileTree'
import PageEditor from './PageEditor'
import NavEditor from './NavEditor'
import ContentChatModal from './ContentChatModal'
import MediaLibrary from './MediaLibrary'
import ResourcesPanel from './ResourcesPanel'
import OneOffPanel from './OneOffPanel'
import { parseNavJson } from '@/lib/editor/nav-config'
import type { Move } from '@/lib/editor/nav-urls'

const NAV_PATH = 'content/nav.json'

type LoadedFile = { content: string; sha: string }

export default function EditorShell({
  sessionId,
  firmName,
  websiteUrl,
  initialPath,
}: {
  sessionId: string
  firmName: string
  websiteUrl: string
  // Optional deep-link target (e.g. a Batch Content "Open draft" link). Selected
  // once after the tree loads so the file resolves against a populated tree.
  initialPath?: string
}) {
  const [tree, setTree] = useState<TreeFile[]>([])
  const [status, setStatus] = useState<EditorStatus | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Map<string, LoadedFile>>(new Map())
  const [dirty, setDirty] = useState<Map<string, string>>(new Map())
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  // Pending page relocations emitted by NavEditor (an item's url changed via
  // nesting). Applied by the /nav route on save; reset after each nav save.
  const [navMoves, setNavMoves] = useState<Move[]>([])
  const [publishing, setPublishing] = useState(false)
  const [pageActioning, setPageActioning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<string | null>(null)
  const [conflictPrUrl, setConflictPrUrl] = useState<string | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  // Set when a save hits a sha conflict (someone else saved the same file).
  // The admin chooses explicitly: overwrite with their version, or take the
  // server's — no silent last-writer-wins.
  const [conflict, setConflict] = useState<{
    path: string
    serverSha: string
    serverContent: string
  } | null>(null)

  const refreshStatus = useCallback(async () => {
    const res = await fetch(`/api/edit/${sessionId}/status`)
    if (!res.ok) return
    setStatus((await res.json()) as EditorStatus)
  }, [sessionId])

  const refreshTree = useCallback(async () => {
    setLoadingTree(true)
    try {
      const res = await fetch(`/api/edit/${sessionId}/tree`)
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Tree load failed: ${res.status}`)
      }
      const data = (await res.json()) as { entries: TreeFile[] }
      setTree(data.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree')
    } finally {
      setLoadingTree(false)
    }
  }, [sessionId])

  useEffect(() => {
    // Standard data-loading-on-mount pattern. setState happens only after
    // the async fetches resolve; ESLint's set-state-in-effect rule still
    // flags the indirect reference inside the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshTree()
    void refreshStatus()
  }, [refreshTree, refreshStatus])

  // Warn admin when navigating away with unsaved edits.
  useEffect(() => {
    if (dirty.size === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty.size])

  // Publish/rollback results surface as a transient toast, not a permanent
  // top-bar item — auto-dismiss so the header stays uncluttered.
  useEffect(() => {
    if (!publishResult) return
    const t = setTimeout(() => setPublishResult(null), 6000)
    return () => clearTimeout(t)
  }, [publishResult])

  const select = useCallback(
    async (path: string) => {
      setError(null)
      setSelectedPath(path)
      if (path === MEDIA_VIEW || path === RESOURCES_VIEW || path === ONEOFF_VIEW) return // virtual view, nothing to fetch
      if (loaded.has(path)) return
      setLoadingFile(true)
      try {
        const res = await fetch(`/api/edit/${sessionId}/file?path=${encodeURIComponent(path)}`)
        if (!res.ok) {
          const data = (await res.json()) as { error?: string }
          throw new Error(data.error ?? `Load failed: ${res.status}`)
        }
        const blob = (await res.json()) as { path: string; content: string; sha: string }
        setLoaded((prev) => new Map(prev).set(path, { content: blob.content, sha: blob.sha }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setLoadingFile(false)
      }
    },
    [sessionId, loaded]
  )

  // Apply a deep-link target once, after the tree finishes loading so the file
  // resolves against a populated tree (a Batch Content "Open draft" link lands here).
  const [initialApplied, setInitialApplied] = useState(false)
  useEffect(() => {
    if (initialApplied || !initialPath || loadingTree) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialApplied(true)
    void select(initialPath)
  }, [initialApplied, initialPath, loadingTree, select])

  // Force-reload a file from the server, replacing the cached content + sha and
  // clearing any dirty state — used after the AI agent commits a new version.
  const reloadFile = useCallback(
    async (path: string) => {
      try {
        const res = await fetch(`/api/edit/${sessionId}/file?path=${encodeURIComponent(path)}`)
        if (!res.ok) return
        const blob = (await res.json()) as { content: string; sha: string }
        setLoaded((prev) => new Map(prev).set(path, { content: blob.content, sha: blob.sha }))
        setDirty((prev) => {
          const m = new Map(prev)
          m.delete(path)
          return m
        })
      } catch {
        /* non-fatal — a stale cache surfaces as a save conflict the admin resolves */
      }
    },
    [sessionId]
  )

  const currentContent = (): string | null => {
    if (!selectedPath) return null
    const draft = dirty.get(selectedPath)
    if (draft !== undefined) return draft
    return loaded.get(selectedPath)?.content ?? null
  }

  const onEdit = (next: string) => {
    if (!selectedPath) return
    const base = loaded.get(selectedPath)
    if (base && base.content === next) {
      setDirty((prev) => {
        const m = new Map(prev)
        m.delete(selectedPath)
        return m
      })
    } else {
      setDirty((prev) => new Map(prev).set(selectedPath, next))
    }
  }

  const save = async () => {
    if (!selectedPath) return
    const next = dirty.get(selectedPath)
    if (next === undefined) return
    const base = loaded.get(selectedPath)
    if (!base) return

    const isNavSave = selectedPath === NAV_PATH
    if (isNavSave) {
      try {
        parseNavJson(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid nav.json')
        return
      }
    }

    setSaving(true)
    setError(null)
    setPublishResult(null)
    try {
      // nav.json goes through /nav, which also relocates any page whose url
      // changed (nesting) and adds a 301. Other files use the generic writer.
      const res = isNavSave
        ? await fetch(`/api/edit/${sessionId}/nav`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: next, moves: navMoves, expectedSha: base.sha }),
          })
        : await fetch(`/api/edit/${sessionId}/files`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: selectedPath, contents: next, expectedSha: base.sha }),
          })
      if (res.status === 409) {
        const data = (await res.json()) as { currentSha: string; currentContent: string; message?: string }
        setConflict({ path: selectedPath, serverSha: data.currentSha, serverContent: data.currentContent })
        return
      }
      if (res.status === 422) {
        // A page already lives at a target URL. Surface it and keep the edits so
        // the admin can rename the colliding item and retry (no data loss).
        const data = (await res.json()) as { error?: string; collision?: { to: string } }
        setError(data.error ?? `A page already exists at ${data.collision?.to ?? 'the destination'}.`)
        return
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Save failed: ${res.status}`)
      }
      const data = (await res.json()) as { commitSha: string; blobSha: string }
      setLoaded((prev) =>
        new Map(prev).set(selectedPath, { content: next, sha: data.blobSha })
      )
      setDirty((prev) => {
        const m = new Map(prev)
        m.delete(selectedPath)
        return m
      })
      if (isNavSave) {
        setNavMoves([])
        // Pages were relocated on the draft branch — refresh the tree so the
        // moved files show at their new paths.
        await refreshTree()
      }
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    if (dirty.size > 0) {
      setError('Save all unsaved changes before publishing.')
      return
    }
    setPublishing(true)
    setError(null)
    setPublishResult(null)
    setConflictPrUrl(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/publish`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Publish failed: ${res.status}`)
      }
      const data = (await res.json()) as
        | { merged: true; mergeCommitSha: string }
        | { merged: false; prUrl: string }
      if (data.merged) {
        setPublishResult('Published to live — Vercel is deploying.')
        // Reload tree + status, since draft was reset to main.
        setLoaded(new Map())
        await refreshTree()
        await refreshStatus()
      } else {
        // A merge conflict needs manual resolution in GitHub — surface a
        // persistent, clickable link rather than a toast that auto-dismisses.
        setConflictPrUrl(data.prUrl)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const resolveConflictMine = async () => {
    if (!conflict) return
    const mine = dirty.get(conflict.path)
    if (mine === undefined) {
      setConflict(null)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const isNavConflict = conflict.path === NAV_PATH
      const res = isNavConflict
        ? await fetch(`/api/edit/${sessionId}/nav`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: mine, moves: navMoves, expectedSha: conflict.serverSha }),
          })
        : await fetch(`/api/edit/${sessionId}/files`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: conflict.path, contents: mine, expectedSha: conflict.serverSha }),
          })
      if (res.status === 409) {
        // The file moved AGAIN while the conflict bar was open — refresh the
        // conflict to the newest server state so the choice stays valid
        // (otherwise "keep mine" loops on a stale sha forever).
        const data = (await res.json()) as { currentSha: string; currentContent: string }
        setConflict({ path: conflict.path, serverSha: data.currentSha, serverContent: data.currentContent })
        return
      }
      if (res.status === 422) {
        const data = (await res.json()) as { error?: string; collision?: { to: string } }
        setError(data.error ?? `A page already exists at ${data.collision?.to ?? 'the destination'}.`)
        return
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Save failed: ${res.status}`)
      }
      const data = (await res.json()) as { commitSha: string; blobSha: string }
      setLoaded((prev) => new Map(prev).set(conflict.path, { content: mine, sha: data.blobSha }))
      setDirty((prev) => {
        const m = new Map(prev)
        m.delete(conflict.path)
        return m
      })
      setConflict(null)
      if (isNavConflict) {
        setNavMoves([])
        await refreshTree()
      }
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const resolveConflictTheirs = () => {
    if (!conflict) return
    setLoaded((prev) =>
      new Map(prev).set(conflict.path, { content: conflict.serverContent, sha: conflict.serverSha })
    )
    setDirty((prev) => {
      const m = new Map(prev)
      m.delete(conflict.path)
      return m
    })
    setConflict(null)
  }

  const rollback = async () => {
    if (
      !window.confirm(
        'Revert the last publish? The live site goes back to its previous state; your published changes stay in draft so you can fix and re-publish.'
      )
    ) {
      return
    }
    setPublishing(true)
    setError(null)
    setPublishResult(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/rollback`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Rollback failed: ${res.status}`)
      }
      setPublishResult('Live site reverted — Vercel is redeploying the previous version.')
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed')
    } finally {
      setPublishing(false)
    }
  }

  // Reload the branch's files after draft was rewritten server-side (sync/reset),
  // so the editor shows the new content instead of stale cached blobs.
  const reloadAfterDraftChange = async () => {
    setLoaded(new Map())
    setDirty(new Map())
    setNavMoves([])
    await refreshTree()
    await refreshStatus()
    if (selectedPath) await reloadFile(selectedPath)
  }

  // "Keep draft current": pull live (main) into the draft branch so publishing
  // won't conflict. Requires a clean editor (no unsaved edits) — the merge
  // rewrites files under you.
  const syncDraft = async () => {
    setDraftBusy(true)
    setError(null)
    setPublishResult(null)
    setConflictPrUrl(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Update failed: ${res.status}`)
      }
      const data = (await res.json()) as
        | { synced: true; alreadyCurrent: boolean }
        | { synced: false; reason: string }
      if (!data.synced) {
        setError(data.reason)
        return
      }
      if (data.alreadyCurrent) {
        setPublishResult('Draft is already up to date with live.')
        await refreshStatus()
      } else {
        setPublishResult('Draft updated from live — review, then publish.')
        await reloadAfterDraftChange()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setDraftBusy(false)
    }
  }

  // "Reset draft to live": discard the draft entirely and start from what's live.
  // Destructive — unpublished draft edits are lost.
  const resetDraft = async () => {
    if (
      !window.confirm(
        'Reset the draft to the live site? This DISCARDS all unpublished draft edits and starts fresh from what is currently live. This cannot be undone.'
      )
    ) {
      return
    }
    setDraftBusy(true)
    setError(null)
    setPublishResult(null)
    setConflictPrUrl(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Reset failed: ${res.status}`)
      }
      setPublishResult('Draft reset to live — start editing fresh.')
      await reloadAfterDraftChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setDraftBusy(false)
    }
  }

  // Move the selected page between live (content/pages|posts) and drafts.
  // Staged on the draft branch — goes live on the next Publish.
  const setPageState = async (action: 'draft' | 'restore') => {
    if (!selectedPath) return
    const sha = loaded.get(selectedPath)?.sha
    if (!sha) return
    const prompt =
      action === 'draft'
        ? 'Set this page to draft (remove it from the live site)?'
        : 'Restore this page to the live site?'
    if (!window.confirm(`${prompt} The change goes live when you next Publish.`)) return

    setPageActioning(true)
    setError(null)
    setPublishResult(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, expectedSha: sha, action }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Failed: ${res.status}`)
      }
      const data = (await res.json()) as { newPath: string }
      const oldPath = selectedPath
      setLoaded((prev) => {
        const m = new Map(prev)
        m.delete(oldPath)
        return m
      })
      setDirty((prev) => {
        const m = new Map(prev)
        m.delete(oldPath)
        return m
      })
      await refreshTree()
      await refreshStatus()
      await select(data.newPath)
      setPublishResult(
        action === 'draft'
          ? 'Moved to drafts — Publish to take it off the live site.'
          : 'Restored — Publish to put it back on the live site.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setPageActioning(false)
    }
  }

  const deletePage = async () => {
    if (!selectedPath) return
    const sha = loaded.get(selectedPath)?.sha
    if (!sha) return
    if (
      !window.confirm(
        'Delete this page permanently from the repo? The change goes live when you next Publish.'
      )
    ) {
      return
    }
    setPageActioning(true)
    setError(null)
    setPublishResult(null)
    try {
      const res = await fetch(
        `/api/edit/${sessionId}/page?path=${encodeURIComponent(selectedPath)}&sha=${encodeURIComponent(sha)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Delete failed: ${res.status}`)
      }
      const oldPath = selectedPath
      setSelectedPath(null)
      setLoaded((prev) => {
        const m = new Map(prev)
        m.delete(oldPath)
        return m
      })
      setDirty((prev) => {
        const m = new Map(prev)
        m.delete(oldPath)
        return m
      })
      await refreshTree()
      await refreshStatus()
      setPublishResult('Page deleted — Publish to remove it from the live site.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setPageActioning(false)
    }
  }

  const content = currentContent()
  const isNav = selectedPath === 'content/nav.json'
  const isLivePage =
    !!selectedPath &&
    (selectedPath.startsWith('content/pages/') || selectedPath.startsWith('content/posts/'))
  const isDraftPage =
    !!selectedPath && selectedPath.startsWith('content/drafts/') && selectedPath.endsWith('.md')
  const canPageAct = !!selectedPath && loaded.has(selectedPath) && !pageActioning

  return (
    <div className="flex flex-col h-screen bg-surface-default">
      <EditorTopBar
        firmName={firmName}
        websiteUrl={websiteUrl}
        status={status}
        dirtyCount={dirty.size}
        selectedPath={selectedPath}
        canSave={!!selectedPath && dirty.has(selectedPath)}
        saving={saving}
        publishing={publishing}
        draftBusy={draftBusy}
        onSave={save}
        onPublish={publish}
        onRollback={rollback}
        onSyncDraft={syncDraft}
        onResetDraft={resetDraft}
      />
      {(isLivePage || isDraftPage) && selectedPath && (
        <div className="px-6 py-2 border-b border-border-default bg-surface-default flex items-center justify-end gap-2">
          {isLivePage && (
            <ContentChatModal
              sessionId={sessionId}
              path={selectedPath}
              isDirty={dirty.has(selectedPath)}
              onSave={() => void save()}
              onEdited={() => {
                void reloadFile(selectedPath)
                void refreshStatus()
              }}
            />
          )}
          {isLivePage && (
            <button
              type="button"
              onClick={() => void setPageState('draft')}
              disabled={!canPageAct}
              className="rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading font-semibold text-xs text-brand-navy hover:bg-brand-navy/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Take this page off the live site (keeps it in Drafts)"
            >
              Set to draft
            </button>
          )}
          {isDraftPage && (
            <button
              type="button"
              onClick={() => void setPageState('restore')}
              disabled={!canPageAct}
              className="rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading font-semibold text-xs text-brand-navy hover:bg-brand-navy/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Put this page back on the live site"
            >
              Restore to live
            </button>
          )}
          <button
            type="button"
            onClick={() => void deletePage()}
            disabled={!canPageAct}
            className="rounded-pill border border-error/40 px-3.5 py-1.5 font-heading font-semibold text-xs text-error hover:bg-error/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete this page from the repo"
          >
            {pageActioning ? 'Working…' : 'Delete'}
          </button>
        </div>
      )}
      {error && (
        <div className="px-6 py-2 bg-warning/10 border-b border-warning/30 text-warning-strong font-body text-xs">
          {error}
        </div>
      )}
      {conflict && (
        <div
          role="alert"
          className="px-6 py-3 bg-warning/10 border-b border-warning/30 font-body text-xs flex items-center gap-4 flex-wrap"
        >
          <span className="text-warning-strong">
            <strong>{conflict.path.split('/').pop()}</strong> was changed on the server while you
            were editing (another admin or a fresh package). Which version should win?
          </span>
          <button
            type="button"
            onClick={() => void resolveConflictMine()}
            disabled={saving}
            className="rounded-pill border border-brand-navy px-3 py-1 font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors disabled:opacity-50"
          >
            Keep mine (overwrite server)
          </button>
          <button
            type="button"
            onClick={resolveConflictTheirs}
            disabled={saving}
            className="rounded-pill border border-border-default px-3 py-1 font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors disabled:opacity-50"
          >
            Take server version (discard mine)
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {loadingTree ? (
          <div className="w-64 border-r border-border-default p-4 text-xs text-text-muted">
            Loading files…
          </div>
        ) : (
          <FileTree
            entries={tree}
            selectedPath={selectedPath}
            dirtyPaths={new Set(dirty.keys())}
            onSelect={(p) => void select(p)}
          />
        )}
        {!selectedPath ? (
          <div className="flex-1 flex items-center justify-center text-sm font-body text-text-muted">
            Select a file from the left to begin editing.
          </div>
        ) : selectedPath === MEDIA_VIEW ? (
          <MediaLibrary sessionId={sessionId} onChanged={() => void refreshStatus()} />
        ) : selectedPath === ONEOFF_VIEW ? (
          <OneOffPanel sessionId={sessionId} />
        ) : selectedPath === RESOURCES_VIEW ? (
          <ResourcesPanel
            sessionId={sessionId}
            onOpenPost={(path) => {
              // A freshly drafted post is a new commit on draft: refresh the
              // tree + status so it appears, then open it in the editor.
              void refreshTree()
              void refreshStatus()
              void select(path)
            }}
          />
        ) : loadingFile || content === null ? (
          <div className="flex-1 flex items-center justify-center text-sm font-body text-text-muted">
            Loading {selectedPath}…
          </div>
        ) : isNav ? (
          <NavEditor
            key={`nav-${loaded.get(NAV_PATH)?.sha ?? 'new'}`}
            path={selectedPath}
            contents={content}
            onChange={onEdit}
            onMovesChange={setNavMoves}
          />
        ) : (
          <PageEditor key={selectedPath} sessionId={sessionId} path={selectedPath} contents={content} onChange={onEdit} />
        )}
      </div>
      {publishResult && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border-default border-l-4 border-l-brand-cyan bg-surface-card px-4 py-3 shadow-elevated"
        >
          <span className="text-xs font-body text-text-primary">{publishResult}</span>
          <button
            type="button"
            onClick={() => setPublishResult(null)}
            aria-label="Dismiss"
            className="ml-auto text-sm leading-none text-text-muted hover:text-brand-navy"
          >
            ×
          </button>
        </div>
      )}
      {conflictPrUrl && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border-default border-l-4 border-l-warning bg-surface-card px-4 py-3 shadow-elevated"
        >
          <div className="text-xs font-body text-text-primary">
            <p className="font-heading font-semibold text-warning-strong">Publish needs a manual merge</p>
            <p className="mt-1">
              Draft and live have conflicting changes. Resolve and merge the{' '}
              <a
                href={conflictPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-cyan underline hover:text-brand-navy"
              >
                pull request on GitHub
              </a>{' '}
              to deploy.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConflictPrUrl(null)}
            aria-label="Dismiss"
            className="ml-auto text-sm leading-none text-text-muted hover:text-brand-navy"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
