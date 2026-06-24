'use client'

import { useEffect, useState } from 'react'
import type { FaqItem, InternalLink } from '@/lib/editor/structured-fields'

type SeoField = 'faq' | 'answer' | 'eeat' | 'links'

const inputClass =
  'w-full text-sm font-body px-3 py-2 rounded border border-border-default focus:border-brand-cyan focus:outline-none'
const labelClass = 'block text-xs font-heading text-text-secondary mb-1'
const addBtnClass =
  'rounded-pill border border-brand-navy px-3 py-1 font-heading font-semibold text-xs text-brand-navy hover:bg-brand-navy/5 transition-colors'
const removeBtnClass =
  'rounded-pill border border-error/40 px-2.5 py-1 font-heading font-semibold text-xs text-error hover:bg-error/5 transition-colors'
const genBtnClass =
  'rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 hover:bg-brand-cyan-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'

function SectionCard({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="bg-surface-card border border-border-default rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-heading font-semibold text-brand-navy">{title}</h2>
        {action}
      </div>
      <p className="text-xs font-body text-text-muted mb-3">{hint}</p>
      {children}
    </section>
  )
}

export default function StructuredContentEditor({
  sessionId,
  path,
  initialFaq,
  onFaqChange,
  initialAnswer,
  onAnswerChange,
  initialEeat,
  onEeatChange,
  initialLinks,
  onLinksChange,
}: {
  sessionId: string
  path: string
  initialFaq: FaqItem[]
  onFaqChange: (items: FaqItem[]) => void
  initialAnswer: string
  onAnswerChange: (text: string) => void
  initialEeat: string[]
  onEeatChange: (signals: string[]) => void
  initialLinks: InternalLink[]
  onLinksChange: (links: InternalLink[]) => void
}) {
  // Local editing buffer so in-progress blank rows persist in the UI; the parent
  // persists a cleaned (blank-stripped) copy to frontmatter on every change. The
  // parent remounts this component per page (key={path}) to reseed.
  const [faq, setFaq] = useState<FaqItem[]>(initialFaq)
  const [answer, setAnswer] = useState<string>(initialAnswer)
  const [eeat, setEeat] = useState<string[]>(initialEeat)
  const [links, setLinks] = useState<InternalLink[]>(initialLinks)

  const commitFaq = (next: FaqItem[]) => {
    setFaq(next)
    onFaqChange(next)
  }
  const commitAnswer = (next: string) => {
    setAnswer(next)
    onAnswerChange(next)
  }
  const commitEeat = (next: string[]) => {
    setEeat(next)
    onEeatChange(next)
  }
  const commitLinks = (next: InternalLink[]) => {
    setLinks(next)
    onLinksChange(next)
  }

  const updateFaq = (i: number, patch: Partial<FaqItem>) =>
    commitFaq(faq.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const updateLink = (i: number, patch: Partial<InternalLink>) =>
    commitLinks(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  // AI generation is admin-only, mirroring the AI content editor.
  const [isAdmin, setIsAdmin] = useState(false)
  const [generating, setGenerating] = useState<SeoField | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { role?: string }) => {
        if (!cancelled && d.role === 'admin') setIsAdmin(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const generate = async (field: SeoField, isEmpty: boolean) => {
    if (!isEmpty && !window.confirm('Replace the current content with AI-generated content?')) {
      return
    }
    setGenerating(field)
    setGenError(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/seo-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, field }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Generation failed: ${res.status}`)
      }
      const data = (await res.json()) as { field: SeoField; value: unknown }
      if (data.field === 'faq') commitFaq(data.value as FaqItem[])
      else if (data.field === 'answer') commitAnswer(data.value as string)
      else if (data.field === 'eeat') commitEeat(data.value as string[])
      else if (data.field === 'links') commitLinks(data.value as InternalLink[])
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(null)
    }
  }

  const genButton = (field: SeoField, isEmpty: boolean) =>
    isAdmin ? (
      <button
        type="button"
        onClick={() => void generate(field, isEmpty)}
        disabled={generating !== null}
        className={genBtnClass}
      >
        {generating === field ? 'Generating…' : isEmpty ? 'Generate' : 'Regenerate'}
      </button>
    ) : null

  return (
    <div className="space-y-6">
      {genError && (
        <div className="bg-warning/10 border border-warning/30 text-warning-strong font-body text-xs rounded px-3 py-2">
          {genError}
        </div>
      )}
      <SectionCard
        title="FAQ"
        hint="These questions render as the on-page FAQ accordion and as FAQPage structured data for search & AI. No code — just edit the Q&A."
        action={genButton('faq', faq.length === 0)}
      >
        <div className="space-y-3">
          {faq.length === 0 && (
            <p className="text-xs font-body text-text-muted">No FAQ entries yet.</p>
          )}
          {faq.map((item, i) => (
            <div key={i} className="border border-border-default rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-heading text-text-muted">Q&amp;A {i + 1}</span>
                <button
                  type="button"
                  onClick={() => commitFaq(faq.filter((_, idx) => idx !== i))}
                  className={removeBtnClass}
                >
                  Remove
                </button>
              </div>
              <input
                type="text"
                value={item.question}
                placeholder="Question"
                onChange={(e) => updateFaq(i, { question: e.target.value })}
                className={inputClass}
              />
              <textarea
                value={item.answer}
                placeholder="Answer"
                onChange={(e) => updateFaq(i, { answer: e.target.value })}
                className={`${inputClass} min-h-[80px] resize-y`}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => commitFaq([...faq, { question: '', answer: '' }])}
            className={addBtnClass}
          >
            + Add question
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="AIO answer"
        hint="Generated during AI content creation and shown on-page + as structured data to help AI overviews cite this page. Edit if needed."
        action={genButton('answer', answer.trim() === '')}
      >
        <textarea
          value={answer}
          placeholder="Generated during content creation — a direct answer to the page's core question."
          onChange={(e) => commitAnswer(e.target.value)}
          className={`${inputClass} min-h-[90px] resize-y`}
        />
      </SectionCard>

      <SectionCard
        title="Trust signals (E-E-A-T)"
        hint="Credentials and proof points (e.g. 'Licensed CPA, 30+ years'). Shown on-page as trust signals."
        action={genButton('eeat', eeat.length === 0)}
      >
        <div className="space-y-2">
          {eeat.map((signal, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={signal}
                placeholder="Trust signal"
                onChange={(e) => commitEeat(eeat.map((s, idx) => (idx === i ? e.target.value : s)))}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => commitEeat(eeat.filter((_, idx) => idx !== i))}
                className={removeBtnClass}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => commitEeat([...eeat, ''])} className={addBtnClass}>
            + Add signal
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Internal links"
        hint="Related pages to link to. Renders an on-page related-links block and strengthens internal SEO."
        action={genButton('links', links.length === 0)}
      >
        <div className="space-y-3">
          {links.map((link, i) => (
            <div key={i} className="border border-border-default rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-heading text-text-muted">Link {i + 1}</span>
                <button
                  type="button"
                  onClick={() => commitLinks(links.filter((_, idx) => idx !== i))}
                  className={removeBtnClass}
                >
                  Remove
                </button>
              </div>
              <div>
                <span className={labelClass}>URL</span>
                <input
                  type="text"
                  value={link.url}
                  placeholder="/services/tax"
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <span className={labelClass}>Anchor text</span>
                <input
                  type="text"
                  value={link.anchor_text}
                  placeholder="tax services"
                  onChange={(e) => updateLink(i, { anchor_text: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <span className={labelClass}>Reason (why it&apos;s relevant)</span>
                <input
                  type="text"
                  value={link.reason}
                  placeholder="Topically related service"
                  onChange={(e) => updateLink(i, { reason: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => commitLinks([...links, { url: '', anchor_text: '', reason: '' }])}
            className={addBtnClass}
          >
            + Add link
          </button>
        </div>
      </SectionCard>
    </div>
  )
}
