'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CreateWordpressSiteResponse } from '@/types/wordpress-sites'
import CopyField from './CopyField'

const PILL = 'rounded-pill px-3.5 py-1.5 font-heading text-xs font-semibold transition-all'

export default function AddWordpressSiteDialog({ feedBase }: { feedBase: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${PILL} bg-brand-cyan text-text-inverse shadow-cyan-base hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow`}
      >
        Add site
      </button>
      {open && <AddDialog feedBase={feedBase} onClose={() => setOpen(false)} />}
    </>
  )
}

function AddDialog({ feedBase, onClose }: { feedBase: string; onClose: () => void }) {
  const router = useRouter()
  const [siteKey, setSiteKey] = useState('')
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateWordpressSiteResponse | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/wordpress-sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_key: siteKey, github_repo: repo }),
      })
      const data = (await res.json()) as CreateWordpressSiteResponse & { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed to add site')
        return
      }
      setCreated(data)
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  function done() {
    router.refresh()
    onClose()
  }

  const inputCls =
    'w-full rounded-card border border-border-default px-3 py-2 font-body text-sm text-text-primary transition-colors focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/15'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
      <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border-default bg-surface-card p-6 shadow-subtle">
        {created ? (
          <>
            <h2 className="font-heading text-lg font-bold text-brand-navy">Site added</h2>
            <p className="mt-1 font-body text-sm text-text-secondary">
              Copy the secret now — it won&apos;t be shown again. Paste both into the Revaltus Blog
              Sync plugin on the WordPress site.
            </p>
            <div className="mt-4 space-y-3">
              <CopyField label="Feed URL" value={created.feedUrl} />
              <CopyField label="Secret (shown once)" value={created.secret} mono />
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={done} className={`${PILL} bg-brand-cyan text-text-inverse hover:bg-brand-cyan-dark`}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-heading text-lg font-bold text-brand-navy">Add WordPress site</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block font-heading text-xs font-semibold text-text-secondary">Site key</label>
                <input
                  className={inputCls}
                  value={siteKey}
                  onChange={(e) => setSiteKey(e.target.value)}
                  placeholder="acmetax"
                  autoFocus
                />
                <p className="mt-1 font-body text-[11px] text-text-muted">URL slug — lowercase letters, numbers, hyphens. Used in the feed URL.</p>
              </div>
              <div>
                <label className="mb-1 block font-heading text-xs font-semibold text-text-secondary">GitHub repo</label>
                <input
                  className={inputCls}
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="acmetax-site  (or owner/acmetax-site)"
                />
                <p className="mt-1 font-body text-[11px] text-text-muted">The client&apos;s content repo. Posts are read from its <code>main</code> branch.</p>
              </div>
              {feedBase && siteKey && (
                <p className="font-body text-[11px] text-text-muted">
                  Feed will be: <span className="font-mono text-text-secondary">{feedBase}/api/wp-feed/{siteKey}</span>
                </p>
              )}
              {error && <p className="rounded-card bg-error/10 px-3 py-2 font-body text-sm text-error">{error}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={onClose} className={`${PILL} border border-border-default text-text-secondary hover:bg-surface-subtle`}>
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !siteKey || !repo}
                className={`${PILL} bg-brand-cyan text-text-inverse hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:bg-text-muted`}
              >
                {busy ? 'Adding…' : 'Add site'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
