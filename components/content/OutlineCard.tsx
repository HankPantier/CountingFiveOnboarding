'use client'

import { useState } from 'react'
import OutlineSectionRow from './OutlineSectionRow'
import type { Json } from '@/types/database'

type Section = { h2: string; description: string; word_count: number }
type Cta = { text: string; url: string }

type Outline = {
  id: string
  page_url: string
  page_title: string
  h1: string | null
  sections: Json
  target_keyword: string | null
  admin_approved: boolean
  admin_notes: string | null
  cta: Json | null
  content_job_id: string
}

export default function OutlineCard({
  outline,
  contentJobId,
  onUpdate,
}: {
  outline: Outline
  contentJobId: string
  onUpdate: (updated: Outline) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const sections = (outline.sections as Section[]) ?? []
  const totalWords = sections.reduce((sum, s) => sum + (s.word_count || 0), 0)

  const statusBadge = outline.admin_approved
    ? { label: 'Approved', cls: 'bg-green-50 text-green-700' }
    : outline.h1
      ? { label: 'Pending', cls: 'bg-amber-50 text-amber-700' }
      : { label: 'Generating...', cls: 'bg-blue-50 text-blue-700' }

  const saveEdits = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/outlines/${outline.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          h1: outline.h1,
          sections: outline.sections,
          admin_notes: outline.admin_notes,
          cta: outline.cta,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        onUpdate(data.outline)
      }
    } finally {
      setSaving(false)
    }
  }

  const cta = (outline.cta as Cta | null) ?? null
  const updateCta = (next: Cta | null) => {
    onUpdate({ ...outline, cta: next as unknown as Json })
  }

  const approve = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/outlines/${outline.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_approved: true }),
      })
      if (res.ok) {
        const data = await res.json()
        onUpdate(data.outline)
      }
    } finally {
      setSaving(false)
    }
  }

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/outlines/${outline.id}/regenerate`, {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        onUpdate(data.outline)
      }
    } finally {
      setRegenerating(false)
    }
  }

  const updateSection = (index: number, updated: Section) => {
    const newSections = [...sections]
    newSections[index] = updated
    onUpdate({ ...outline, sections: newSections as unknown as Json })
  }

  const removeSection = (index: number) => {
    onUpdate({ ...outline, sections: sections.filter((_, i) => i !== index) as unknown as Json })
  }

  const addSection = () => {
    onUpdate({
      ...outline,
      sections: [...sections, { h2: '', description: '', word_count: 150 }] as unknown as Json,
    })
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${outline.admin_approved ? 'border-green-200' : 'border-border-default'}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-subtle transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <div className="text-left min-w-0">
            <div className="text-sm font-heading font-semibold text-text-primary truncate">{outline.page_title}</div>
            <div className="text-xs font-mono text-text-muted">{outline.page_url}</div>
          </div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold flex-shrink-0 ml-2 ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
      </button>

      {expanded && outline.h1 && (
        <div className="px-4 pb-4 pt-2 border-t border-border-default space-y-3">
          {/* H1 */}
          <div>
            <label className="text-xs font-heading font-semibold text-text-secondary">H1</label>
            <input
              type="text"
              value={outline.h1 ?? ''}
              onChange={e => onUpdate({ ...outline, h1: e.target.value })}
              className="w-full mt-1 px-3 py-2 text-sm font-body bg-surface-subtle border border-border-default rounded focus:border-brand-cyan focus:outline-none"
            />
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-heading font-semibold text-text-secondary">Sections</label>
              <span className="text-xs font-mono text-text-muted">{totalWords} words total</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-text-muted font-heading">
              <span className="flex-1">H2</span>
              <span className="flex-[2]">Description</span>
              <span className="w-16 text-center">Words</span>
              <span className="w-6" />
            </div>
            {sections.map((section, i) => (
              <OutlineSectionRow
                key={i}
                section={section}
                onChange={updated => updateSection(i, updated)}
                onRemove={() => removeSection(i)}
              />
            ))}
            <button
              type="button"
              onClick={addSection}
              className="text-sm font-body text-brand-cyan hover:text-brand-navy transition-colors px-2 py-1"
            >
              + Add Section
            </button>
          </div>

          {/* Keyword */}
          <div className="text-xs font-body text-text-muted">
            Target keyword: <span className="font-mono">{outline.target_keyword ?? '—'}</span>
          </div>

          {/* CTA */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-heading font-semibold text-text-secondary">Call to Action</label>
              {cta && (
                <button
                  type="button"
                  onClick={() => updateCta(null)}
                  className="text-xs font-body text-text-muted hover:text-red-600 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cta?.text ?? ''}
                onChange={e => updateCta({ text: e.target.value, url: cta?.url ?? '/contact' })}
                placeholder="Schedule a consultation"
                className="flex-1 px-3 py-2 text-sm font-body bg-surface-subtle border border-border-default rounded focus:border-brand-cyan focus:outline-none"
              />
              <input
                type="text"
                value={cta?.url ?? ''}
                onChange={e => updateCta({ text: cta?.text ?? '', url: e.target.value })}
                placeholder="/contact"
                className="w-40 px-3 py-2 text-sm font-mono bg-surface-subtle border border-border-default rounded focus:border-brand-cyan focus:outline-none"
              />
            </div>
            <p className="mt-1 text-xs font-body text-text-muted">
              Closes every page. Leave empty for the default ("Schedule a consultation" → /contact).
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-heading font-semibold text-text-secondary">Notes</label>
            <textarea
              value={outline.admin_notes ?? ''}
              onChange={e => onUpdate({ ...outline, admin_notes: e.target.value })}
              rows={2}
              className="w-full mt-1 px-3 py-2 text-sm font-body bg-surface-subtle border border-border-default rounded focus:border-brand-cyan focus:outline-none resize-none"
              placeholder="Notes for the copywriter..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!outline.admin_approved && (
              <button
                onClick={approve}
                disabled={saving}
                className="bg-green-600 text-white font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Approve'}
              </button>
            )}
            <button
              onClick={saveEdits}
              disabled={saving}
              className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50"
            >
              Save Edits
            </button>
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50"
            >
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
