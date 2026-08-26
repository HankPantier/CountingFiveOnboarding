'use client'

import { useState } from 'react'
import type { FaqItem } from '@/lib/editor/structured-fields'

// Inline Q&A editor for a faq-accordion block. FAQ's live source of truth is
// frontmatter `faq_block`, so this does NOT edit the body segment directly —
// it routes changes to PageEditor's onFaqChange, which dual-writes frontmatter
// AND the on-page accordion. A local buffer keeps in-progress blank rows.

const fieldInput =
  'w-full text-sm font-body px-3 py-2 rounded border border-border-default focus:border-brand-cyan focus:outline-none'
const fieldTextarea = `${fieldInput} resize-y min-h-[64px]`
const fieldLabel = 'block text-[11px] font-heading text-text-secondary mb-1'
const addBtn =
  'rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading font-semibold text-xs text-brand-navy hover:bg-brand-navy/5 transition-colors'
const removeBtn =
  'ml-auto text-[11px] font-heading font-semibold text-error hover:opacity-80 transition-opacity'

export default function FaqInlineEditor({
  heading,
  items,
  onChange,
}: {
  heading: string
  items: FaqItem[]
  onChange: (items: FaqItem[]) => void
}) {
  const [faq, setFaq] = useState<FaqItem[]>(items)

  const commit = (next: FaqItem[]) => {
    setFaq(next)
    onChange(next)
  }
  const update = (i: number, patch: Partial<FaqItem>) =>
    commit(faq.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  return (
    <div className="my-4 rounded-lg border border-border-default bg-surface-subtle/40 p-3">
      {heading && (
        <h3 className="mb-2 font-heading font-semibold text-base text-brand-navy">{heading}</h3>
      )}
      <div className="space-y-3">
        {faq.map((item, i) => (
          <div key={i} className="rounded-md border border-border-default bg-surface-card p-3 space-y-2">
            <label className="block">
              <span className={fieldLabel}>Question</span>
              <input
                type="text"
                value={item.question}
                onChange={(e) => update(i, { question: e.target.value })}
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>Answer</span>
              <textarea
                value={item.answer}
                onChange={(e) => update(i, { answer: e.target.value })}
                className={fieldTextarea}
              />
            </label>
            <div className="flex">
              <button
                type="button"
                onClick={() => commit(faq.filter((_, idx) => idx !== i))}
                className={removeBtn}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => commit([...faq, { question: '', answer: '' }])}
          className={addBtn}
        >
          + Add question
        </button>
      </div>
    </div>
  )
}
