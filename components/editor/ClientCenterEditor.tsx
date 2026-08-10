'use client'

import { useEffect, useState } from 'react'
import type { ClientCenterJson, ClientCenterGroup, ClientPortalLink } from '@/types/client-center'

const EMPTY: ClientCenterJson = { enabled: false, label: 'Client Center', groups: [] }

function inputClass(empty: boolean): string {
  return `w-full text-xs font-body px-2.5 py-1.5 rounded border bg-surface-card focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-all ${
    empty ? 'border-error/50' : 'border-border-default'
  }`
}

// A link needs a label + url to be worth shipping; a group needs a title. Used
// to gate Save so we never write a half-filled entry the template must skip.
function isComplete(config: ClientCenterJson): boolean {
  return config.groups.every(
    (g) =>
      g.title.trim() !== '' &&
      g.links.every((l) => l.label.trim() !== '' && l.url.trim() !== '')
  )
}

export default function ClientCenterEditor({
  sessionId,
  onSaved,
}: {
  sessionId: string
  onSaved?: () => void
}) {
  const [config, setConfig] = useState<ClientCenterJson>(EMPTY)
  const [sha, setSha] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/edit/${sessionId}/client-center`)
        if (!res.ok) {
          const d = (await res.json()) as { error?: string }
          throw new Error(d.error ?? `Load failed: ${res.status}`)
        }
        const d = (await res.json()) as { config: ClientCenterJson; sha: string | null }
        if (cancelled) return
        setConfig(d.config)
        setSha(d.sha)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const patch = (next: Partial<ClientCenterJson>) => {
    setConfig((prev) => ({ ...prev, ...next }))
    setDirty(true)
    setMessage(null)
  }

  const updateGroup = (gi: number, next: Partial<ClientCenterGroup>) =>
    patch({ groups: config.groups.map((g, i) => (i === gi ? { ...g, ...next } : g)) })

  const updateLink = (gi: number, li: number, next: Partial<ClientPortalLink>) =>
    updateGroup(gi, {
      links: config.groups[gi].links.map((l, i) => (i === li ? { ...l, ...next } : l)),
    })

  const addGroup = () =>
    patch({ groups: [...config.groups, { title: '', links: [{ label: '', url: '' }] }] })

  const removeGroup = (gi: number) =>
    patch({ groups: config.groups.filter((_, i) => i !== gi) })

  const addLink = (gi: number) =>
    updateGroup(gi, { links: [...config.groups[gi].links, { label: '', url: '' }] })

  const removeLink = (gi: number, li: number) =>
    updateGroup(gi, { links: config.groups[gi].links.filter((_, i) => i !== li) })

  async function save() {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/client-center`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, expectedSha: sha }),
      })
      if (res.status === 409) {
        setError('This file changed on the server. Reload the editor to continue.')
        return
      }
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? `Save failed: ${res.status}`)
      }
      const d = (await res.json()) as { config: ClientCenterJson; sha: string }
      setConfig(d.config)
      setSha(d.sha)
      setDirty(false)
      setMessage('Saved to draft — Publish to push it live.')
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm font-body text-text-muted">
        Loading Client Center…
      </div>
    )
  }

  const complete = isComplete(config)

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div>
          <div className="text-xs font-heading text-text-muted">Editing</div>
          <div className="font-heading font-semibold text-brand-navy text-lg">Client Center</div>
          <p className="text-[11px] font-body text-text-muted mt-1">
            Links to the external portals your clients use (QuickBooks, secure file upload, payroll,
            bill-pay, remote support). They appear in a “Client Center” button in the site header that
            opens a modal. Never store portal passwords here — links only.
          </p>
        </div>

        <section className="bg-surface-card border border-border-default rounded-lg p-4 space-y-3">
          <label className="flex items-center gap-2 text-xs font-body text-text-secondary">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              className="accent-brand-cyan"
            />
            Show the Client Center button on the site
          </label>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <label className="text-[11px] font-heading text-text-muted col-span-2">Button label</label>
            <input
              type="text"
              value={config.label}
              placeholder="Client Center"
              aria-label="Button label"
              onChange={(e) => patch({ label: e.target.value })}
              className={inputClass(config.label.trim() === '')}
            />
          </div>
        </section>

        {config.groups.map((group, gi) => (
          <section key={gi} className="bg-surface-card border border-border-default rounded-lg">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default">
              <input
                type="text"
                value={group.title}
                placeholder="Group title (e.g. Documents)"
                aria-label="Group title"
                onChange={(e) => updateGroup(gi, { title: e.target.value })}
                className={`${inputClass(group.title.trim() === '')} font-heading font-semibold max-w-xs`}
              />
              <button
                type="button"
                onClick={() => removeGroup(gi)}
                aria-label={`Remove group ${group.title || 'untitled'}`}
                className="ml-auto text-xs font-heading font-semibold text-text-muted hover:text-error transition-colors"
              >
                Remove group
              </button>
            </div>
            <div className="p-4 space-y-3">
              {group.links.map((link, li) => (
                <div key={li} className="flex items-start gap-2">
                  <div className="flex-1 grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={link.label}
                      placeholder="Link label (e.g. ShareFile)"
                      aria-label="Link label"
                      onChange={(e) => updateLink(gi, li, { label: e.target.value })}
                      className={inputClass(link.label.trim() === '')}
                    />
                    <input
                      type="text"
                      value={link.url}
                      placeholder="https://…"
                      aria-label="Link URL"
                      onChange={(e) => updateLink(gi, li, { url: e.target.value })}
                      className={`${inputClass(link.url.trim() === '')} font-mono`}
                    />
                    <input
                      type="text"
                      value={link.description ?? ''}
                      placeholder="Short description (optional)"
                      aria-label="Link description"
                      onChange={(e) => updateLink(gi, li, { description: e.target.value })}
                      className={`${inputClass(false)} sm:col-span-2`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLink(gi, li)}
                    aria-label={`Remove link ${link.label || 'untitled'}`}
                    className="mt-1 w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-error transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addLink(gi)}
                className="text-[11px] font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
              >
                + Add link
              </button>
            </div>
          </section>
        ))}

        <button
          type="button"
          onClick={addGroup}
          className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
        >
          + Add group
        </button>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty || !complete}
            title={!complete ? 'Fill in every group title and link label + URL first' : undefined}
            className="rounded-pill bg-brand-navy px-4 py-1.5 font-heading font-semibold text-xs text-white hover:bg-brand-navy-dark transition-colors disabled:bg-surface-subtle disabled:text-text-muted disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {message && <span className="text-xs font-body text-success">{message}</span>}
          {error && <span className="text-xs font-body text-error">{error}</span>}
        </div>
      </div>
    </div>
  )
}
