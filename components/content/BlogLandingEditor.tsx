'use client'

import { useState } from 'react'
import type { BlogConfig } from '@/lib/content/blog-config'

const inputCls =
  'w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none'
const labelCls = 'block text-xs font-heading font-semibold text-text-secondary mb-1'
const cardCls = 'border border-border-default bg-surface-card rounded-xl p-4 space-y-3'
const primaryBtn =
  'bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed'

const PATH_RE = /^\/[A-Za-z0-9-]+$/

export default function BlogLandingEditor({
  sessionId,
  initial,
  hasRepo,
}: {
  sessionId: string
  initial: BlogConfig
  hasRepo: boolean
}) {
  const [label, setLabel] = useState(initial.label)
  const [path, setPath] = useState(initial.path)
  const [title, setTitle] = useState(initial.title)
  const [intro, setIntro] = useState(initial.intro)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const pathValid = PATH_RE.test(path.trim())

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/blog-settings/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, path, title, intro }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      setLabel(data.label as string)
      setPath(data.path as string)
      setTitle(data.title as string)
      setIntro(data.intro as string)
      setMessage({
        kind: 'ok',
        text: 'Saved & pushed to draft — click "Publish to live" in the content editor to deploy.',
      })
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div>
          <h2 className="text-sm font-heading font-semibold text-brand-navy">Blog landing</h2>
          <p className="text-xs font-body text-text-muted mt-0.5">
            Controls the section that lists articles, blogs, and case studies — its name, URL, and intro.
            The default is <span className="font-semibold">Resources</span> at <span className="font-semibold">/resources</span>.
          </p>
        </div>

        {!hasRepo ? (
          <p className="text-xs font-body text-text-muted">
            This site isn&rsquo;t provisioned yet. The blog landing can be set once the site&rsquo;s repo exists.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Section name</label>
                <input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="Resources"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>URL path</label>
                <input
                  value={path}
                  onChange={e => setPath(e.target.value)}
                  placeholder="/resources"
                  className={inputCls}
                />
              </div>
            </div>
            {!pathValid && (
              <p className="text-xs font-body text-error">
                Use a single path segment like <span className="font-semibold">/insights</span> (letters, numbers, hyphens).
              </p>
            )}
            <div>
              <label className={labelCls}>Page heading (optional — defaults to the name)</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={label || 'Resources'}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Intro paragraph</label>
              <textarea
                value={intro}
                onChange={e => setIntro(e.target.value)}
                rows={2}
                placeholder="Practical advice and seasonal updates from our team."
                className={inputCls}
              />
            </div>
          </>
        )}
      </div>

      {hasRepo && (
        <div className="flex items-center justify-end gap-3">
          {message && (
            <span className={`text-xs font-body ${message.kind === 'ok' ? 'text-success' : 'text-error'}`}>
              {message.text}
            </span>
          )}
          <button onClick={save} disabled={saving || !pathValid} className={primaryBtn}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
