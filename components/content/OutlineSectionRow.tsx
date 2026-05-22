'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Section = { h2: string; description: string; word_count: number }

export default function OutlineSectionRow({
  id,
  index,
  section,
  onChange,
  onRemove,
}: {
  id: string
  index: number
  section: Section
  onChange: (updated: Section) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
  } as const

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border border-border-default bg-surface-subtle/40 rounded-lg p-3 space-y-2 ${
        isDragging ? 'shadow-lg ring-1 ring-brand-cyan' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="text-text-muted hover:text-brand-cyan transition-colors cursor-grab active:cursor-grabbing touch-none p-1 -ml-1"
            aria-label={`Drag section ${index + 1} to reorder`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
            </svg>
          </button>
          <span className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wide">
            Section {index + 1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-body text-text-muted">Words</label>
          <input
            type="number"
            value={section.word_count}
            onChange={e => onChange({ ...section, word_count: parseInt(e.target.value) || 0 })}
            className="w-20 px-2 py-1 text-sm font-mono text-text-secondary bg-white border border-border-default focus:border-brand-cyan focus:outline-none rounded text-center"
            min={0}
          />
          <button
            type="button"
            onClick={onRemove}
            className="text-text-muted hover:text-error transition-colors p-1"
            aria-label="Remove section"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs font-heading font-semibold text-text-secondary">H2</label>
        <input
          type="text"
          value={section.h2}
          onChange={e => onChange({ ...section, h2: e.target.value })}
          placeholder="H2 heading"
          className="w-full mt-1 px-3 py-2 text-sm font-body font-semibold bg-white border border-border-default focus:border-brand-cyan focus:outline-none rounded"
        />
      </div>

      <div>
        <label className="text-xs font-heading font-semibold text-text-secondary">Description</label>
        <textarea
          value={section.description}
          onChange={e => onChange({ ...section, description: e.target.value })}
          placeholder="What this section covers"
          rows={3}
          className="w-full mt-1 px-3 py-2 text-sm font-body text-text-secondary bg-white border border-border-default focus:border-brand-cyan focus:outline-none rounded resize-y min-h-[5rem]"
        />
      </div>
    </div>
  )
}
