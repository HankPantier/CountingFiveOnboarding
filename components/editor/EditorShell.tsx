'use client'

import { useCallback, useEffect, useState } from 'react'
import EditorTopBar, { type EditorStatus } from './EditorTopBar'
import FileTree, { MEDIA_VIEW, type TreeFile } from './FileTree'
import PageEditor from './PageEditor'
import NavEditor from './NavEditor'
import MediaLibrary from './MediaLibrary'
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
      if (path === MEDIA_VIEW) return // virtual view, nothing to fetch
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
        setLoaded((prev) =>
          new Map(prev).set(selectedPath, { content: data.currentContent, sha: data.currentSha })
        )
        setError(data.message ?? 'File changed remotely; latest content reloaded.')
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
      />
      {error && (
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 font-body text-xs">
          {error}
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
