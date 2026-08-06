'use client'

import { useMemo } from 'react'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

// Live 1:1 preview: the client's REAL deployed homepage (shellHtml) re-skinned
// with the pending draft theme.css + design-overrides.css. Recomposes whenever
// the sources change (after an AI commit), giving the prompt → see-it-change loop.
export default function ThemePreview({
  shellHtml,
  sources,
}: {
  shellHtml: string
  sources: ThemeSources
}) {
  const srcDoc = useMemo(
    () =>
      composePreviewSrcDoc({
        shellHtml,
        themeCss: sources.themeCss,
        overridesCss: sources.overridesCss,
      }),
    [shellHtml, sources.themeCss, sources.overridesCss]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-default bg-surface-subtle px-4 py-2">
        <div className="flex items-center gap-1.5">
          {PALETTE_ROLES.map((role) => (
            <span
              key={role}
              title={`${role}: ${sources.palette[role]}`}
              className="h-5 w-5 rounded-full border border-border-default"
              style={{ backgroundColor: sources.palette[role] }}
            />
          ))}
        </div>
        <span className="font-body text-[11px] text-text-muted">
          roundness: {sources.roundness} · density: {sources.density} · feel: {sources.visualFeel}
        </span>
      </div>
      <iframe
        title="Theme preview"
        srcDoc={srcDoc}
        className="min-h-0 w-full flex-1 bg-white"
        // Fully sandboxed: the real-site HTML can neither run scripts nor reach
        // the parent/app. External CSS, images, and fonts still load.
        sandbox=""
      />
    </div>
  )
}
