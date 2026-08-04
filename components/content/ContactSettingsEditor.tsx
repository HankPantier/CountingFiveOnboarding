'use client'

import { useState } from 'react'
import type { BookingProvider, SiteSettings } from '@/lib/content/site-settings'

const inputCls =
  'w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none'
const labelCls = 'block text-xs font-heading font-semibold text-text-secondary mb-1'
const cardCls = 'border border-border-default bg-surface-card rounded-xl p-4 space-y-3'
const primaryBtn =
  'bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed'

export default function ContactSettingsEditor({
  sessionId,
  initial,
  published = false,
}: {
  sessionId: string
  initial: SiteSettings
  published?: boolean
}) {
  const [provider, setProvider] = useState<BookingProvider>(initial.bookingProvider)
  const [url, setUrl] = useState(initial.bookingUrl)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/site-settings/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingProvider: provider, bookingUrl: url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      setProvider(data.bookingProvider as BookingProvider)
      setUrl(data.bookingUrl as string)
      if (data.published && data.synced) {
        setMessage({ kind: 'ok', text: 'Saved & pushed to draft — click "Publish to live" in the content editor to deploy.' })
      } else if (data.published && data.syncError) {
        setMessage({ kind: 'err', text: `Saved, but pushing to the site failed: ${data.syncError}` })
      } else {
        setMessage({ kind: 'ok', text: 'Saved.' })
      }
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {published && (
        <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-xs font-body text-text-secondary">
          This client is live. Saving pushes the booking setting to the site&rsquo;s <span className="font-semibold">draft</span> branch —
          then open the content editor and click <span className="font-semibold">Publish to live</span> to deploy it.
        </div>
      )}

      <div className={cardCls}>
        <div>
          <h2 className="text-sm font-heading font-semibold text-brand-navy">Book a call</h2>
          <p className="text-xs font-body text-text-muted mt-0.5">
            Powers the &ldquo;Book a call&rdquo; option in the site&rsquo;s contact drawer. With no scheduling link,
            the drawer falls back to the firm&rsquo;s phone number automatically.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Scheduling tool</label>
            <select value={provider} onChange={e => setProvider(e.target.value as BookingProvider)} className={inputCls}>
              <option value="none">None (use phone)</option>
              <option value="calendly">Calendly (embedded)</option>
              <option value="iframe">Other (iframe)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Scheduling URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://calendly.com/firm/discovery-call"
              disabled={provider === 'none'}
              className={inputCls}
            />
          </div>
        </div>
        {provider !== 'none' && url && !/^https:\/\//.test(url.trim()) && (
          <p className="text-xs font-body text-error">Enter a full https:// URL, or set the tool to &ldquo;None&rdquo;.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {message && (
          <span className={`text-xs font-body ${message.kind === 'ok' ? 'text-success' : 'text-error'}`}>{message.text}</span>
        )}
        <button onClick={save} disabled={saving} className={primaryBtn}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
