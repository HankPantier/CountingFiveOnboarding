'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

interface ParsePreview {
  websiteUrl: string
  businessName: string
  teamCount: number
  servicesCount: number
  gapCount: number
  schemaData: SessionSchema
  gapList: GapItem[]
  rawContent: string
}

export default function NewSessionPage() {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsePreview | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [clientUrl, setClientUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleParse() {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const text = await file.text()
      const res = await fetch('/api/sessions/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfpContent: text }),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        setError(err.error ?? 'Parse failed')
        return
      }
      const data = await res.json() as ParsePreview
      setParsed(data)
      setWebsiteUrl(data.websiteUrl)
    } catch {
      setError('Failed to parse MFP file')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!parsed) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl,
          mfpContent: parsed.rawContent,
          schemaData: parsed.schemaData,
          gapList: parsed.gapList,
        }),
      })
      const data = await res.json() as { sessionId?: string; error?: string }
      if (data.error) {
        setError(data.error)
        return
      }
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
      setClientUrl(`${appUrl}/session/${data.sessionId}`)
    } catch {
      setError('Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  if (clientUrl) {
    return (
      <main className="p-8 max-w-2xl">
        <h1 className="text-2xl font-heading font-bold text-brand-navy">Session Created</h1>
        <p className="text-text-secondary font-body mt-1 mb-6">
          Share this link with the client to begin onboarding.
        </p>
        <div className="bg-surface-card rounded-card shadow-subtle p-6">
          <p className="text-sm font-semibold text-text-secondary font-body mb-2">Client URL</p>
          <div className="flex items-center gap-3">
            <code className="text-sm font-body text-text-primary bg-surface-subtle border border-border-default rounded-card px-3 py-2 flex-1 truncate">
              {clientUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(clientUrl)}
              className="bg-brand-navy text-text-inverse font-heading font-semibold text-sm px-4 py-2 rounded-pill transition-all hover:bg-brand-navy-dark whitespace-nowrap"
            >
              Copy
            </button>
          </div>
        </div>
        <Link
          href="/admin/dashboard"
          className="inline-block mt-6 text-sm text-brand-cyan font-body hover:underline"
        >
          ← Back to dashboard
        </Link>
      </main>
    )
  }

  return (
    <main className="p-8">
      <Link
        href="/admin/dashboard"
        className="text-sm text-brand-cyan font-body hover:underline inline-block mb-6"
      >
        ← Dashboard
      </Link>

      <h1 className="text-2xl font-heading font-bold text-brand-navy">New Client Session</h1>
      <p className="text-text-secondary font-body mt-1 mb-8">
        Upload the client&apos;s Master Firm Profile to begin.
      </p>

      <div className="max-w-2xl bg-surface-card rounded-card shadow-subtle p-8 space-y-6">
        <div>
          <label className="block text-sm font-semibold text-text-secondary font-body mb-2">
            MFP File
          </label>
          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border-default rounded-card cursor-pointer bg-surface-subtle hover:border-brand-cyan transition-colors">
            <span className="text-text-muted font-body text-sm text-center px-4">
              {file ? file.name : 'Click to select .md file'}
            </span>
            <input
              type="file"
              accept=".md"
              className="hidden"
              onChange={e => {
                setParsed(null)
                setError('')
                setFile(e.target.files?.[0] ?? null)
              }}
            />
          </label>
        </div>

        {error && (
          <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card font-body">{error}</p>
        )}

        {file && !parsed && (
          <button
            onClick={handleParse}
            disabled={loading}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Parsing…' : 'Parse MFP'}
          </button>
        )}

        {parsed && (
          <div className="space-y-5">
            <div className="bg-surface-subtle rounded-card p-5 space-y-3">
              <p className="text-xs font-semibold text-text-muted font-body uppercase tracking-wider">
                Extracted Data
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm font-body">
                <div>
                  <span className="text-text-muted block">Firm</span>
                  <span className="text-text-primary font-semibold">{parsed.businessName}</span>
                </div>
                <div>
                  <span className="text-text-muted block">Team</span>
                  <span className="text-text-primary font-semibold">{parsed.teamCount} members</span>
                </div>
                <div>
                  <span className="text-text-muted block">Services</span>
                  <span className="text-text-primary font-semibold">{parsed.servicesCount}</span>
                </div>
                <div>
                  <span className="text-text-muted block">Gap items</span>
                  <span className="text-text-primary font-semibold">{parsed.gapCount}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-text-secondary font-body mb-1">
                Website URL
              </label>
              <input
                type="url"
                value={websiteUrl}
                onChange={e => setWebsiteUrl(e.target.value)}
                className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={loading || !websiteUrl.trim()}
              className="w-full bg-brand-cyan text-text-inverse font-heading font-semibold text-sm py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Session…' : 'Create Session'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
