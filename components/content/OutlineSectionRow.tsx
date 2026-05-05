'use client'

type Section = { h2: string; description: string; word_count: number }

export default function OutlineSectionRow({
  section,
  onChange,
  onRemove,
}: {
  section: Section
  onChange: (updated: Section) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 group">
      <input
        type="text"
        value={section.h2}
        onChange={e => onChange({ ...section, h2: e.target.value })}
        placeholder="H2 heading"
        className="flex-1 min-w-0 px-2 py-1 text-sm font-body font-semibold bg-transparent border border-transparent hover:border-border-default focus:border-brand-cyan focus:outline-none rounded transition-colors"
      />
      <input
        type="text"
        value={section.description}
        onChange={e => onChange({ ...section, description: e.target.value })}
        placeholder="Description"
        className="flex-[2] min-w-0 px-2 py-1 text-sm font-body text-text-secondary bg-transparent border border-transparent hover:border-border-default focus:border-brand-cyan focus:outline-none rounded transition-colors"
      />
      <input
        type="number"
        value={section.word_count}
        onChange={e => onChange({ ...section, word_count: parseInt(e.target.value) || 0 })}
        className="w-16 px-2 py-1 text-sm font-mono text-text-muted bg-transparent border border-transparent hover:border-border-default focus:border-brand-cyan focus:outline-none rounded transition-colors text-center"
        min={0}
      />
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all p-1 mt-0.5"
        aria-label="Remove section"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
