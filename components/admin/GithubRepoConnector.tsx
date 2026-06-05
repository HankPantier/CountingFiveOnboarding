'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const SLUG_HINT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/

export default function GithubRepoConnector({
  contentJobId,
  initialRepo,
  defaultOrg,
}: {
  contentJobId: string
  initialRepo: string | null
  defaultOrg: string | null
}) {
  const router = useRouter()
  const [current, setCurrent] = useState<string | null>(initialRepo)
  const [editing, setEditing] = useState<boolean>(initialRepo === null)
  const [draft, setDraft] = useState<string>(initialRepo ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoUrl = (slug: string): string => {
    return slug.includes('/')
      ? `https://github.com/${slug}`
      : defaultOrg
        ? `https://github.com/${defaultOrg}/${slug}`
        : `https://github.com/${slug}`
  }

  const save = async (nextValue: string | null) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/github-repo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubRepo: nextValue }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? `Request failed: ${res.status}`)
      }
      const data = (await res.json()) as { githubRepo: string | null }
      setCurrent(data.githubRepo)
      setDraft(data.githubRepo ?? '')
      setEditing(data.githubRepo === null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const slug = draft.trim()
    if (!slug) {
      setError('Enter a repo slug')
      return
    }
    if (!SLUG_HINT_RE.test(slug)) {
      setError('Use the form "acmetax-site" or "countingfive/acmetax-site".')
      return
    }
    void save(slug)
  }

  const isDirty = draft.trim() !== (current ?? '')

  return (
    <section className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-heading font-semibold text-brand-navy">
          GitHub repo (for the in-admin editor)
        </h2>
        {current && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-heading text-text-muted hover:text-brand-cyan transition-colors"
          >
            Change
          </button>
        )}
      </div>

      {current && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-sm font-body text-text-primary">
            <span className="font-mono">{current}</span>
            <a
              href={repoUrl(current)}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-heading text-brand-cyan hover:text-brand-navy"
            >
              Open on GitHub ↗
            </a>
          </div>
          <p className="text-xs font-body text-text-muted">
            The Edit content button on the dashboard is enabled once the
            content job reaches phase 6 and this slug is set.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-2">
          <label className="block text-xs font-heading text-text-secondary">
            Repo slug
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={defaultOrg ? `e.g. acmetax-site (under ${defaultOrg}) or owner/name` : 'e.g. owner/name'}
              disabled={busy}
              className="flex-1 text-sm font-mono px-3 py-2 rounded border border-border-default focus:border-brand-cyan focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !isDirty}
              className="bg-brand-cyan disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed"
            >
              {busy ? 'Saving…' : current ? 'Update' : 'Connect'}
            </button>
            {current && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Disconnect ${current}? Editing will be disabled until reconnected.`)) {
                    void save(null)
                  }
                }}
                disabled={busy}
                className="text-xs font-heading text-text-muted hover:text-error transition-colors disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
            {current && !isDirty && editing && (
              <button
                type="button"
                onClick={() => { setEditing(false); setError(null); setDraft(current) }}
                className="text-xs font-heading text-text-muted hover:text-brand-navy transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs font-body text-text-muted">
            Bare slug like <code className="font-mono">acmetax-site</code> defaults to <code className="font-mono">{defaultOrg ?? 'GITHUB_ORG'}</code>; otherwise use <code className="font-mono">owner/name</code>.
          </p>
          {error && <p className="text-xs font-body text-error">{error}</p>}
        </form>
      )}
    </section>
  )
}
