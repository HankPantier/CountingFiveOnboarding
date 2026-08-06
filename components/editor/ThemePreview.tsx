'use client'

import { useMemo } from 'react'
import { buildPreviewSrcDoc } from '@/lib/theme-preview/build-srcdoc'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

// Read-only live preview of the client's theme, rendered in an isolated iframe.
// Rebuilds whenever `sources` changes (i.e. after the AI commits an edit), giving
// the prompt → see-it-change loop.
export default function ThemePreview({ sources }: { sources: ThemeSources }) {
  const srcDoc = useMemo(
    () => buildPreviewSrcDoc({ themeCss: sources.themeCss, overridesCss: sources.overridesCss }),
    [sources.themeCss, sources.overridesCss]
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
        // The preview is our own generated markup (no client input in an
        // executable position); allow-same-origin is omitted so the frame is
        // fully sandboxed. No scripts run inside it.
        sandbox=""
      />
    </div>
  )
}
