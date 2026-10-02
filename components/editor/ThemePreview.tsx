'use client'

import { useMemo, type ReactNode } from 'react'
import { composePreviewSrcDoc, type PreviewLogos } from '@/lib/theme-preview/compose-srcdoc'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import type { PaletteRole } from '@/lib/editor/theme-edit'
import ThemeControls, { type FlagsPatch } from './ThemeControls'
import type { LayoutPresets } from '@/lib/design/layout-presets'
import type { DesignLockDto } from '@/lib/design/locks'
import { themeSourcesHtmlAttributes, type ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

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
  onChangeFlags,
  onChangeLayout,
  logos,
  logoSlot,
  locks,
}: {
  shellHtml: string
  sources: ThemeSources
  saving: boolean
  contrastWarnings: string[]
  onPreviewPalette: (role: PaletteRole, hex: string) => void
  onCommitPalette: (role: PaletteRole, hex: string) => void
  onChangeFont: (slot: 'headingFont' | 'bodyFont' | 'accentFont', font: string) => void
  onChangeFlags: (patch: FlagsPatch) => void
  onChangeLayout: (patch: LayoutPresets) => void
  // Draft logo images (data: URLs) swapped into the live shell's header/footer.
  logos?: PreviewLogos
  logoSlot?: ReactNode
  locks?: DesignLockDto[]
}) {
  const srcDoc = useMemo(
    () =>
      composePreviewSrcDoc({
        shellHtml,
        themeCss: sources.themeCss,
        overridesCss: sources.overridesCss,
        typography: sources.typography,
        // The shell carries the LIVE treatment attributes; override them with
        // the draft values so treatment toggles (and the draft's style axes)
        // preview instantly.
        htmlAttributes: themeSourcesHtmlAttributes(sources),
        logos,
      }),
    [shellHtml, sources, logos]
  )

  return (
    <div className="flex h-full flex-col">
      <ThemeControls
        palette={sources.palette}
        typography={sources.typography}
        roundness={sources.roundness}
        density={sources.density}
        visualFeel={sources.visualFeel}
        headlineStyle={sources.headlineStyle}
        eyebrowStyle={sources.eyebrowStyle}
        darkSections={sources.darkSections}
        logoSize={sources.logoSize}
        layout={sources.layout}
        layoutLock={sources.layoutLock}
        fonts={CURATED_FONTS}
        contrastWarnings={contrastWarnings}
        saving={saving}
        onPreviewPalette={onPreviewPalette}
        onCommitPalette={onCommitPalette}
        onChangeFont={onChangeFont}
        onChangeFlags={onChangeFlags}
        onChangeLayout={onChangeLayout}
        logoSlot={logoSlot}
        locks={locks}
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
