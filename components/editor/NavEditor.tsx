'use client'

import { useMemo } from 'react'
import { parseNavJson } from '@/lib/editor/nav-config'

export default function NavEditor({
  path,
  contents,
  onChange,
}: {
  path: string
  contents: string
  onChange: (next: string) => void
}) {
  const error = useMemo(() => {
    try {
      parseNavJson(contents)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON'
    }
  }, [contents])

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div>
          <div className="text-xs font-heading text-text-muted">Editing</div>
          <div className="font-heading font-semibold text-brand-navy text-lg">{path}</div>
        </div>
        <section className="bg-surface-card border border-border-default rounded-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
            <h2 className="text-sm font-heading font-semibold text-brand-navy">
              nav.json
            </h2>
            {error ? (
              <span className="text-xs font-body text-error">{error}</span>
            ) : (
              <span className="text-xs font-body text-green-700">Valid</span>
            )}
          </div>
          <textarea
            value={contents}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[480px] text-sm font-mono px-4 py-3 outline-none resize-y"
          />
        </section>
        <p className="text-xs font-body text-text-muted">
          Shape: <code>{`{ primary: [{ label, url, children? }], cta?: { label, url } }`}</code>.
          A drag-and-drop UI is planned for a follow-up.
        </p>
      </div>
    </div>
  )
}
