'use client'

import { useState } from 'react'
import { ICON_COMPONENTS, ICON_GROUPS } from '@/lib/editor/icon-catalog'
import type { IconItemRef } from '@/lib/editor/icon-items'

// One row per icon-bearing item: current icon (as rendered on the site, incl.
// the CheckCircle default and Square unknown-name fallback), item title, and
// a picker popover with search across the curated 64-icon catalog.
export default function IconPickerControl({
  item,
  onChange,
}: {
  item: IconItemRef
  onChange: (newIcon: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const effectiveName = item.icon ?? 'CheckCircle'
  const Current = ICON_COMPONENTS[effectiveName] ?? ICON_COMPONENTS.Square
  const unknown = item.icon !== null && !ICON_COMPONENTS[item.icon]

  const q = query.trim().toLowerCase()
  const groups = ICON_GROUPS.map((g) => ({
    ...g,
    names: q ? g.names.filter((n) => n.toLowerCase().includes(q)) : g.names,
  })).filter((g) => g.names.length > 0)

  return (
    <div className="rounded border border-border-default bg-surface-default p-2">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-brand-cyan/10 flex items-center justify-center shrink-0">
          <Current className="w-[18px] h-[18px] text-brand-navy" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-body text-text-primary truncate">{item.title}</div>
          <div className="text-[10px] font-mono text-text-muted truncate">
            {item.icon ?? 'CheckCircle (default)'}
            {unknown && <span className="text-error"> — unknown name, site shows a square</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
        >
          {open ? 'Close' : 'Change'}
        </button>
      </div>

      {open && (
        <div className="mt-2 border-t border-border-default pt-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons…"
            aria-label="Search icons"
            autoFocus
            className="w-full mb-2 rounded-pill border border-border-default px-3 py-1.5 text-xs font-body focus:border-brand-cyan focus:outline-none"
          />
          <div className="max-h-56 overflow-y-auto space-y-2">
            {groups.length === 0 ? (
              <p className="text-xs font-body text-text-muted px-1">No icons match.</p>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <div className="text-[10px] font-heading font-semibold uppercase tracking-wide text-text-muted px-1 mb-1">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {group.names.map((name) => {
                      const IconComp = ICON_COMPONENTS[name]
                      const selected = name === effectiveName
                      return (
                        <button
                          key={name}
                          type="button"
                          title={name}
                          aria-label={name}
                          aria-pressed={selected}
                          onClick={() => {
                            onChange(name)
                            setOpen(false)
                            setQuery('')
                          }}
                          className={`flex items-center justify-center rounded p-1.5 transition-colors ${
                            selected
                              ? 'bg-brand-cyan/15 ring-1 ring-brand-cyan'
                              : 'hover:bg-surface-subtle'
                          }`}
                        >
                          <IconComp aria-hidden="true" className="w-4 h-4 text-brand-navy" strokeWidth={1.75} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
