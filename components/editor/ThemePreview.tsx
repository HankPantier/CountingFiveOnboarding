'use client'

import { useMemo } from 'react'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import type { PaletteRole } from '@/lib/editor/theme-edit'
import ThemeControls from './ThemeControls'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

// Live 1:1 preview: the client's REAL deployed homepage (shellHtml) re-skinned
// with the pending draft theme.css + design-overrides.css. The controls bar lets
// an admin click a swatch to pick a color or choose a font per slot — previews
// update instantly, and commit to the draft (+ MBP) via the parent's handlers.
export default function ThemePreview({
  shellHtml,
  sources,
  saving,
  contrastWarnings,
  onPreviewPalette,
  onCommitPalette,
  onChangeFont,
}: {
  shellHtml: string
  sources: ThemeSources
  saving: boolean
  contrastWarnings: string[]
  onPreviewPalette: (role: PaletteRole, hex: string) => void
  onCommitPalette: (role: PaletteRole, hex: string) => void
  onChangeFont: (slot: 'headingFont' | 'bodyFont' | 'accentFont', font: string) => void
}) {
  const srcDoc = useMemo(
    () =>
      composePreviewSrcDoc({
        shellHtml,
        themeCss: sources.themeCss,
        overridesCss: sources.overridesCss,
        typography: sources.typography,
      }),
    [shellHtml, sources.themeCss, sources.overridesCss, sources.typography]
  )

  return (
    <div className="flex h-full flex-col">
      <ThemeControls
        palette={sources.palette}
        typography={sources.typography}
        roundness={sources.roundness}
        density={sources.density}
        visualFeel={sources.visualFeel}
        fonts={CURATED_FONTS}
        contrastWarnings={contrastWarnings}
        saving={saving}
        onPreviewPalette={onPreviewPalette}
        onCommitPalette={onCommitPalette}
        onChangeFont={onChangeFont}
      />
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
