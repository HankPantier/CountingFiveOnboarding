'use client'

import { useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { PALETTE_ROLES, type PaletteRole } from '@/lib/editor/theme-edit'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

const ROLE_LABELS: Record<PaletteRole, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  complementary: 'Complementary',
  action: 'Action',
  nearBlack: 'Text',
  nearWhite: 'Background',
}

const FONT_SLOTS: { key: 'headingFont' | 'bodyFont' | 'accentFont'; label: string }[] = [
  { key: 'headingFont', label: 'Headings' },
  { key: 'bodyFont', label: 'Body' },
  { key: 'accentFont', label: 'Accent' },
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// One palette swatch + its click-to-open color-picker popover. Dragging previews
// live (onPreview); closing the popover commits (onCommit) the final color.
function Swatch({
  role,
  hex,
  saving,
  onPreview,
  onCommit,
}: {
  role: PaletteRole
  hex: string
  saving: boolean
  onPreview: (role: PaletteRole, hex: string) => void
  onCommit: (role: PaletteRole, hex: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(hex)
  const ref = useRef<HTMLDivElement>(null)
  const committedRef = useRef(hex) // last value we told the server about

  // Keep the local draft in sync when the source value changes (e.g. reload).
  useEffect(() => {
    if (!open) {
      setDraft(hex)
      committedRef.current = hex
    }
  }, [hex, open])

  // Commit on close (click-outside / Escape) if the color actually changed.
  useEffect(() => {
    if (!open) return
    const close = () => {
      setOpen(false)
      if (HEX_RE.test(draft) && draft.toLowerCase() !== committedRef.current.toLowerCase()) {
        committedRef.current = draft
        onCommit(role, draft.toLowerCase())
      }
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, draft, role, onCommit])

  const preview = (next: string) => {
    setDraft(next)
    if (HEX_RE.test(next)) onPreview(role, next.toLowerCase())
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={`${ROLE_LABELS[role]}: ${hex}`}
        aria-label={`Edit ${ROLE_LABELS[role]} color`}
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 rounded-full border border-border-default shadow-subtle transition-transform hover:scale-110"
        style={{ backgroundColor: hex }}
      />
      {open && (
        <div className="absolute left-0 top-8 z-50 rounded-lg border border-border-default bg-surface-card p-3 shadow-elevated">
          <div className="mb-2 font-heading text-[11px] font-semibold text-brand-navy">
            {ROLE_LABELS[role]}
          </div>
          <HexColorPicker color={draft} onChange={preview} />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => preview(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
              spellCheck={false}
              className="w-24 rounded border border-border-default px-2 py-1 font-mono text-xs focus:border-brand-cyan focus:outline-none"
            />
            {saving && <span className="font-body text-[11px] text-text-muted">saving…</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// The Theme Studio direct controls: click-to-edit palette swatches + per-slot
// font selectors. Colors preview live and commit on picker close; font changes
// commit immediately. Both persist to the draft branch and update the MBP.
export default function ThemeControls({
  palette,
  typography,
  roundness,
  density,
  visualFeel,
  fonts,
  contrastWarnings,
  saving,
  onPreviewPalette,
  onCommitPalette,
  onChangeFont,
}: {
  palette: ThemeSources['palette']
  typography: ThemeSources['typography']
  roundness: ThemeSources['roundness']
  density: ThemeSources['density']
  visualFeel: ThemeSources['visualFeel']
  fonts: readonly string[]
  contrastWarnings: string[]
  saving: boolean
  onPreviewPalette: (role: PaletteRole, hex: string) => void
  onCommitPalette: (role: PaletteRole, hex: string) => void
  onChangeFont: (slot: 'headingFont' | 'bodyFont' | 'accentFont', font: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border-default bg-surface-subtle px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="font-heading text-[11px] font-semibold text-text-secondary">Colors</span>
          <div className="flex items-center gap-1.5">
            {PALETTE_ROLES.map((role) => (
              <Swatch
                key={role}
                role={role}
                hex={palette?.[role] ?? '#000000'}
                saving={saving}
                onPreview={onPreviewPalette}
                onCommit={onCommitPalette}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-heading text-[11px] font-semibold text-text-secondary">Fonts</span>
          {FONT_SLOTS.map(({ key, label }) => {
            // Legacy design.json can omit a font slot (e.g. accentFont). Guard so
            // a missing value renders a blank <select> instead of crashing.
            const current = typography?.[key] ?? ''
            return (
              <label key={key} className="flex items-center gap-1.5">
                <span className="font-body text-[11px] text-text-muted">{label}</span>
                <select
                  value={current}
                  disabled={saving}
                  onChange={(e) => onChangeFont(key, e.target.value)}
                  className="rounded border border-border-default bg-surface-card px-2 py-1 font-body text-xs focus:border-brand-cyan focus:outline-none disabled:opacity-50"
                >
                  {/* The current font may be outside the curated list (legacy) — keep it selectable. */}
                  {current && !fonts.includes(current) && <option value={current}>{current}</option>}
                  {fonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>

        <span className="font-body text-[11px] text-text-muted">
          roundness: {roundness} · density: {density} · feel: {visualFeel}
        </span>
      </div>

      {contrastWarnings.length > 0 && (
        <p className="font-body text-[11px] text-warning-strong">
          Contrast: {contrastWarnings.join(' · ')}
        </p>
      )}
    </div>
  )
}
