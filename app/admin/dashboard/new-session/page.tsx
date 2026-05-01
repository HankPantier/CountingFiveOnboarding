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

type Step = 'upload' | 'summary' | 'review' | 'created'

function SummarySection({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-text-muted font-body uppercase tracking-wider">{label}</p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm font-body text-text-primary">
            <span className="text-brand-cyan shrink-0 mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function NewSessionPage() {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsePreview | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [clientUrl, setClientUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [gapsExpanded, setGapsExpanded] = useState(false)

  async function handleFileSelect(selectedFile: File) {
    setFile(selectedFile)
    setParsed(null)
    setError('')
    setAdditionalNotes('')
    setStep('upload')
    setLoading(true)
    try {
      const text = await selectedFile.text()
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
      setStep('summary')
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
      const schemaWithNotes: SessionSchema = {
        ...parsed.schemaData,
        additional: {
          otherDetails: additionalNotes.trim(),
          uploadedFiles: parsed.schemaData.additional?.uploadedFiles ?? [],
        },
      }
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl,
          mfpContent: parsed.rawContent,
          schemaData: schemaWithNotes,
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
      setStep('created')
    } catch {
      setError('Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'created' && clientUrl) {
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
              onClick={() => {
                navigator.clipboard.writeText(clientUrl).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }).catch(() => {
                  const el = document.createElement('textarea')
                  el.value = clientUrl
                  document.body.appendChild(el)
                  el.select()
                  document.execCommand('copy')
                  document.body.removeChild(el)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
              className="bg-brand-navy text-text-inverse font-heading font-semibold text-sm px-4 py-2 rounded-pill transition-all hover:bg-brand-navy-dark whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <Link href="/admin/dashboard" className="inline-block mt-6 text-sm text-brand-cyan font-body hover:underline">
          ← Back to dashboard
        </Link>
      </main>
    )
  }

  const schema = parsed?.schemaData

  return (
    <main className="p-8 max-w-3xl">
      <Link href="/admin/dashboard" className="text-sm text-brand-cyan font-body hover:underline inline-block mb-6">
        ← Dashboard
      </Link>

      <h1 className="text-2xl font-heading font-bold text-brand-navy">New Client Session</h1>
      <p className="text-text-secondary font-body mt-1 mb-8">
        Upload the client&apos;s Master Firm Profile to begin.
      </p>

      {/* Dropzone — prominent when empty, compact after parsing */}
      <div className="mb-8">
        <label className={`flex items-center justify-center w-full border-2 border-dashed rounded-card cursor-pointer transition-all ${
          loading
            ? 'h-16 border-brand-cyan/40 bg-brand-cyan/5'
            : step !== 'upload'
            ? 'h-12 border-border-default bg-surface-subtle hover:border-brand-cyan'
            : 'h-28 border-border-default bg-surface-subtle hover:border-brand-cyan'
        } ${loading ? 'cursor-default' : ''}`}>
          <span className="text-text-muted font-body text-sm text-center px-4">
            {loading
              ? 'Parsing MFP…'
              : file
              ? `${file.name} — click to change`
              : 'Click to select .md file'}
          </span>
          <input
            type="file"
            accept=".md"
            className="hidden"
            disabled={loading}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void handleFileSelect(f)
            }}
          />
        </label>
      </div>

      {error && (
        <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card font-body mb-6">{error}</p>
      )}

      {parsed && schema && (
        <>
          {/* Structured Summary Card */}
          <div className="bg-surface-card rounded-card shadow-subtle p-8 space-y-6">

            {step === 'review' && (
              <p className="text-xs font-semibold text-brand-cyan font-body uppercase tracking-wider pb-2 border-b border-border-default">
                Review before creating
              </p>
            )}

            {/* Firm Identity */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-muted font-body uppercase tracking-wider">Firm</p>
              <div className="space-y-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-lg font-heading font-bold text-brand-navy">
                    {schema.business?.name ?? parsed.businessName}
                  </span>
                  {schema.business?.tagline && (
                    <span className="text-sm font-body text-text-secondary">— {schema.business.tagline}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted font-body w-16 shrink-0">Website</span>
                  {step === 'summary' ? (
                    <input
                      type="url"
                      value={websiteUrl}
                      onChange={e => setWebsiteUrl(e.target.value)}
                      className="flex-1 border border-border-default rounded-card px-3 py-1.5 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
                    />
                  ) : (
                    <span className="text-sm font-body text-text-primary">{websiteUrl}</span>
                  )}
                </div>
                {schema.business?.foundingYear && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted font-body w-16 shrink-0">Founded</span>
                    <span className="text-sm font-body text-text-primary">{schema.business.foundingYear}</span>
                  </div>
                )}
              </div>
            </div>

            {schema.locations && schema.locations.length > 0 && (
              <>
                <div className="border-t border-border-default" />
                <SummarySection
                  label={`Locations (${schema.locations.length})`}
                  items={schema.locations.map(l =>
                    [l.name, l.city && l.state ? `${l.city}, ${l.state}` : l.city ?? l.state].filter(Boolean).join(' — ')
                  )}
                />
              </>
            )}

            {schema.team && schema.team.length > 0 && (
              <>
                <div className="border-t border-border-default" />
                <SummarySection
                  label={`Team (${schema.team.length})`}
                  items={schema.team.map(m => m.title ? `${m.name} — ${m.title}` : m.name)}
                />
              </>
            )}

            {schema.services && schema.services.length > 0 && (
              <>
                <div className="border-t border-border-default" />
                <SummarySection
                  label={`Services (${schema.services.length})`}
                  items={schema.services.map(s => s.name)}
                />
              </>
            )}

            {schema.niches && schema.niches.length > 0 && (
              <>
                <div className="border-t border-border-default" />
                <SummarySection
                  label={`Industries (${schema.niches.length})`}
                  items={schema.niches.map(n => n.name)}
                />
              </>
            )}

            {((schema.culture?.socialMediaChannels?.length ?? 0) > 0 ||
              (schema.business?.affiliations?.length ?? 0) > 0) && (
              <>
                <div className="border-t border-border-default" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-text-muted font-body uppercase tracking-wider">Digital</p>
                  {schema.culture?.socialMediaChannels && schema.culture.socialMediaChannels.length > 0 && (
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-text-muted font-body w-20 shrink-0 pt-0.5">Social</span>
                      <span className="text-sm font-body text-text-primary">
                        {schema.culture.socialMediaChannels.join(', ')}
                      </span>
                    </div>
                  )}
                  {schema.business?.affiliations && schema.business.affiliations.length > 0 && (
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-text-muted font-body w-20 shrink-0 pt-0.5">Affiliations</span>
                      <span className="text-sm font-body text-text-primary">
                        {schema.business.affiliations.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="border-t border-border-default" />

            {/* Gap list */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setGapsExpanded(x => !x)}
                className="w-full flex items-center justify-between group"
              >
                <p className="text-xs font-semibold text-text-muted font-body uppercase tracking-wider">
                  Gaps to collect ({parsed.gapCount})
                </p>
                <span className="text-xs text-brand-cyan font-body group-hover:underline">
                  {gapsExpanded ? 'Hide' : 'Show'}
                </span>
              </button>

              {gapsExpanded && (
                <div className="space-y-4 pt-1">
                  {[
                    { heading: 'To confirm with client', items: parsed.gapList.filter(g => g.phase === 3) },
                    { heading: 'Tier 1 — always asked', items: parsed.gapList.filter(g => g.phase === 4 && g.tier === 1) },
                    { heading: 'Tier 2 — ask if time allows', items: parsed.gapList.filter(g => g.phase === 4 && g.tier === 2) },
                    { heading: 'Tier 3 — may skip', items: parsed.gapList.filter(g => g.phase === 4 && g.tier === 3) },
                  ].map(group => group.items.length > 0 && (
                    <div key={group.heading} className="space-y-1.5">
                      <p className="text-xs text-text-muted font-body font-semibold">{group.heading}</p>
                      <ul className="space-y-1">
                        {group.items.map(gap => (
                          <li key={gap.field} className="flex items-start gap-2 text-sm font-body text-text-secondary">
                            <span className="text-border-default shrink-0 mt-0.5">–</span>
                            <span>{gap.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Additional Notes — editable in summary, read-only in review */}
            <div className="border-t border-border-default" />
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-text-muted font-body uppercase tracking-wider">
                Additional Notes
              </label>
              {step === 'summary' ? (
                <textarea
                  value={additionalNotes}
                  onChange={e => setAdditionalNotes(e.target.value)}
                  placeholder="Anything the team should know before the client conversation — preferences, context, or anything the MFP didn't capture."
                  rows={4}
                  className="w-full border border-border-default rounded-card px-3 py-2.5 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors resize-none placeholder:text-text-muted"
                />
              ) : additionalNotes.trim() ? (
                <p className="text-sm font-body text-text-primary whitespace-pre-wrap">{additionalNotes.trim()}</p>
              ) : (
                <p className="text-sm font-body text-text-muted italic">None</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center gap-6">
            {step === 'summary' && (
              <button
                onClick={() => setStep('review')}
                disabled={!websiteUrl.trim()}
                className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-8 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save &amp; Review
              </button>
            )}
            {step === 'review' && (
              <>
                <button
                  onClick={() => void handleCreate()}
                  disabled={loading}
                  className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-8 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating…' : 'Create Session'}
                </button>
                <button
                  onClick={() => setStep('summary')}
                  disabled={loading}
                  className="text-sm text-brand-cyan font-body hover:underline"
                >
                  ← Back to edit
                </button>
              </>
            )}
          </div>

          {error && (
            <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card font-body mt-4">{error}</p>
          )}
        </>
      )}
    </main>
  )
}
