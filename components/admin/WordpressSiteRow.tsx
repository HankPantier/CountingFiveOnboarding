'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WordpressSiteSummary, RegenerateSecretResponse } from '@/types/wordpress-sites'
import CopyField from './CopyField'

export default function WordpressSiteRow({
  site,
  feedBase,
}: {
  site: WordpressSiteSummary
  feedBase: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'toggle' | 'regen' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const base = feedBase || (typeof window !== 'undefined' ? window.location.origin : '')
  const feedUrl = `${base}/api/wp-feed/${site.site_key}`

  async function toggle() {
    setBusy('toggle')
    setError(null)
    try {
      const res = await fetch(`/api/admin/wordpress-sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !site.enabled }),
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to update')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function regenerate() {
    if (!confirm('Rotate this site’s secret? The old secret stops working immediately — you’ll need to update the WordPress plugin.')) return
    setBusy('regen')
    setError(null)
    try {
      const res = await fetch(`/api/admin/wordpress-sites/${site.id}/regenerate-secret`, { method: 'POST' })
      const d = (await res.json()) as RegenerateSecretResponse & { error?: string }
      if (!res.ok || d.error) {
        setError(d.error ?? 'Failed to regenerate')
        return
      }
      setNewSecret(d.secret)
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!confirm(`Delete “${site.site_key}”? WordPress posts already synced stay put; this just stops the feed.`)) return
    setBusy('delete')
    setError(null)
    try {
      const res = await fetch(`/api/admin/wordpress-sites/${site.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to delete')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(feedUrl).then(() => {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2500)
    })
  }

  const actionBtn =
    'rounded-pill border border-border-default px-3 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-all hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50'

  return (
    <>
      <tr className="border-b border-border-default last:border-0 hover:bg-surface-subtle">
        <td className="px-4 py-3 font-heading font-semibold text-text-primary">{site.site_key}</td>
        <td className="px-4 py-3 font-mono text-[12.5px] text-text-secondary">{site.github_repo}</td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${
              site.enabled ? 'bg-success/10 text-success' : 'bg-text-muted/15 text-text-muted'
            }`}
          >
            {site.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </td>
        <td className="px-4 py-3">
          <button
            onClick={copyUrl}
            title={feedUrl}
            className="max-w-[240px] truncate rounded-card border border-border-default bg-surface-subtle px-2.5 py-1.5 text-left font-mono text-[11.5px] text-text-secondary hover:border-brand-cyan"
          >
            {copiedUrl ? 'Copied!' : feedUrl}
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2">
            <button onClick={toggle} disabled={busy !== null} className={actionBtn}>
              {busy === 'toggle' ? '…' : site.enabled ? 'Disable' : 'Enable'}
            </button>
            <button onClick={regenerate} disabled={busy !== null} className={actionBtn}>
              {busy === 'regen' ? '…' : 'Regenerate secret'}
            </button>
            <button
              onClick={remove}
              disabled={busy !== null}
              className="rounded-pill border border-error/30 px-3 py-1.5 font-heading text-xs font-semibold text-error transition-all hover:bg-error/10 disabled:opacity-50"
            >
              {busy === 'delete' ? '…' : 'Delete'}
            </button>
          </div>
        </td>
      </tr>
      {(newSecret || error) && (
        <tr className="border-b border-border-default bg-surface-subtle">
          <td colSpan={5} className="px-4 py-3">
            {error && <p className="rounded-card bg-error/10 px-3 py-2 font-body text-sm text-error">{error}</p>}
            {newSecret && (
              <div className="space-y-2">
                <p className="font-body text-xs text-text-secondary">
                  New secret — copy it now and update the plugin. It won&apos;t be shown again.
                </p>
                <CopyField label="" value={newSecret} mono />
                <button
                  onClick={() => setNewSecret(null)}
                  className="font-heading text-xs font-semibold text-text-muted hover:text-text-secondary"
                >
                  Dismiss
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
