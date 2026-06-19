'use client'

import type { FaqItem, InternalLink } from '@/lib/editor/structured-fields'

const inputClass =
  'w-full text-sm font-body px-3 py-2 rounded border border-border-default focus:border-brand-cyan focus:outline-none'
const labelClass = 'block text-xs font-heading text-text-secondary mb-1'
const addBtnClass =
  'rounded-pill border border-brand-navy px-3 py-1 font-heading font-semibold text-xs text-brand-navy hover:bg-brand-navy/5 transition-colors'
const removeBtnClass =
  'rounded-pill border border-error/40 px-2.5 py-1 font-heading font-semibold text-xs text-error hover:bg-error/5 transition-colors'

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-surface-card border border-border-default rounded-lg p-4">
      <h2 className="text-sm font-heading font-semibold text-brand-navy mb-1">{title}</h2>
      <p className="text-xs font-body text-text-muted mb-3">{hint}</p>
      {children}
    </section>
  )
}

export default function StructuredContentEditor({
  faq,
  onFaqChange,
  answer,
  onAnswerChange,
  eeat,
  onEeatChange,
  links,
  onLinksChange,
}: {
  faq: FaqItem[]
  onFaqChange: (items: FaqItem[]) => void
  answer: string
  onAnswerChange: (text: string) => void
  eeat: string[]
  onEeatChange: (signals: string[]) => void
  links: InternalLink[]
  onLinksChange: (links: InternalLink[]) => void
}) {
  const updateFaq = (i: number, patch: Partial<FaqItem>) =>
    onFaqChange(faq.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const updateLink = (i: number, patch: Partial<InternalLink>) =>
    onLinksChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-6">
      <SectionCard
        title="FAQ"
        hint="These questions render as the on-page FAQ accordion and as FAQPage structured data for search & AI. No code — just edit the Q&A."
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
                  onClick={() => onFaqChange(faq.filter((_, idx) => idx !== i))}
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
            onClick={() => onFaqChange([...faq, { question: '', answer: '' }])}
            className={addBtnClass}
          >
            + Add question
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="AIO answer"
        hint="A short, direct answer shown on-page and emitted as structured data to help AI overviews cite this page."
      >
        <textarea
          value={answer}
          placeholder="One or two sentences that directly answer the page's core question."
          onChange={(e) => onAnswerChange(e.target.value)}
          className={`${inputClass} min-h-[90px] resize-y`}
        />
      </SectionCard>

      <SectionCard
        title="Trust signals (E-E-A-T)"
        hint="Credentials and proof points (e.g. 'Licensed CPA, 30+ years'). Shown on-page as trust signals."
      >
        <div className="space-y-2">
          {eeat.map((signal, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={signal}
                placeholder="Trust signal"
                onChange={(e) => onEeatChange(eeat.map((s, idx) => (idx === i ? e.target.value : s)))}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => onEeatChange(eeat.filter((_, idx) => idx !== i))}
                className={removeBtnClass}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onEeatChange([...eeat, ''])} className={addBtnClass}>
            + Add signal
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Internal links"
        hint="Related pages to link to. Renders an on-page related-links block and strengthens internal SEO."
      >
        <div className="space-y-3">
          {links.map((link, i) => (
            <div key={i} className="border border-border-default rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-heading text-text-muted">Link {i + 1}</span>
                <button
                  type="button"
                  onClick={() => onLinksChange(links.filter((_, idx) => idx !== i))}
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
            onClick={() => onLinksChange([...links, { url: '', anchor_text: '', reason: '' }])}
            className={addBtnClass}
          >
            + Add link
          </button>
        </div>
      </SectionCard>
    </div>
  )
}
