'use client'

import { useCallback, useEffect, useState } from 'react'
import EditorTopBar, { type EditorStatus } from './EditorTopBar'
import FileTree, { MEDIA_VIEW, RESOURCES_VIEW, ONEOFF_VIEW, type TreeFile } from './FileTree'
import PageEditor from './PageEditor'
import NavEditor from './NavEditor'
import MediaLibrary from './MediaLibrary'
import ResourcesPanel from './ResourcesPanel'
import OneOffPanel from './OneOffPanel'
import { parseNavJson } from '@/lib/editor/nav-config'

type LoadedFile = { content: string; sha: string }

export default function EditorShell({
  sessionId,
  firmName,
  websiteUrl,
}: {
  sessionId: string
  firmName: string
  websiteUrl: string
}) {
  const [tree, setTree] = useState<TreeFile[]>([])
  const [status, setStatus] = useState<EditorStatus | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Map<string, LoadedFile>>(new Map())
  const [dirty, setDirty] = useState<Map<string, string>>(new Map())
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<string | null>(null)
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

    if (selectedPath === 'content/nav.json') {
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
      const res = await fetch(`/api/edit/${sessionId}/files`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedPath,
          contents: next,
          expectedSha: base.sha,
        }),
      })
      if (res.status === 409) {
        const data = (await res.json()) as { currentSha: string; currentContent: string; message?: string }
        setConflict({ path: selectedPath, serverSha: data.currentSha, serverContent: data.currentContent })
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
        setPublishResult(`Conflict — review at ${data.prUrl}`)
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
      const res = await fetch(`/api/edit/${sessionId}/files`, {
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

  const content = currentContent()
  const isNav = selectedPath === 'content/nav.json'

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
        publishResult={publishResult}
        onSave={save}
        onPublish={publish}
        onRollback={rollback}
      />
      {error && (
        <div className="px-6 py-2 bg-warning/10 border-b border-warning/30 text-warning font-body text-xs">
          {error}
        </div>
      )}
      {conflict && (
        <div
          role="alert"
          className="px-6 py-3 bg-warning/10 border-b border-warning/30 font-body text-xs flex items-center gap-4 flex-wrap"
        >
          <span className="text-warning">
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
          <NavEditor path={selectedPath} contents={content} onChange={onEdit} />
        ) : (
          <PageEditor sessionId={sessionId} path={selectedPath} contents={content} onChange={onEdit} />
        )}
      </div>
    </div>
  )
}
