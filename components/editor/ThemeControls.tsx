'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HexColorPicker } from 'react-colorful'
import { PALETTE_ROLES, type PaletteRole } from '@/lib/editor/theme-edit'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'
import { LAYOUT_PRESETS, LAYOUT_PRESET_NAMES, type LayoutPresetName, type LayoutPresets } from '@/lib/design/layout-presets'
import { Lock } from 'lucide-react'
import { isLeverLocked, lockedPresets, type DesignLockDto } from '@/lib/design/locks'

const LOCKED_TITLE = 'Locked in the design chat — unlock it there (or with its lock chip) to change it.'

function LockedMark() {
  return <Lock aria-label="Locked" className="h-3 w-3 text-brand-navy" />
}

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

// Site-wide layout presets (template 2026.09.9) — one select per preset.
const LAYOUT_PRESET_LABELS: Record<LayoutPresetName, string> = {
  cards: 'Card grids',
  ctaBanner: 'CTA banner',
  faq: 'FAQ',
  team: 'Team',
  testimonials: 'Testimonials',
}
const LAYOUT_VALUE_LABELS: Record<string, string> = {
  default: 'Default',
  list: 'List',
  centered: 'Centred',
  split: 'Split',
  featured: 'Featured',
}

// One palette swatch + its click-to-open color-picker popover. Dragging previews
// live (onPreview); closing the popover commits (onCommit) the final color.
function Swatch({
  role,
  hex,
  saving,
  locked,
  onPreview,
  onCommit,
}: {
  role: PaletteRole
  hex: string
  saving: boolean
  locked: boolean
  onPreview: (role: PaletteRole, hex: string) => void
  onCommit: (role: PaletteRole, hex: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(hex)
  const ref = useRef<HTMLDivElement>(null)
  const committedRef = useRef(hex) // last value we told the server about

  // `draft` is only read while the popover is open, so seed it from the current
  // source color at open time (an event handler — no setState-in-effect). This
  // also captures the baseline we diff against to decide whether to commit.
  const toggle = () => {
    if (!open) {
      setDraft(hex)
      committedRef.current = hex
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

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
        title={locked ? `${ROLE_LABELS[role]}: ${hex} — ${LOCKED_TITLE}` : `${ROLE_LABELS[role]}: ${hex}`}
        aria-label={`Edit ${ROLE_LABELS[role]} color`}
        onClick={toggle}
        disabled={locked}
        className="h-6 w-6 rounded-full border border-border-default shadow-subtle transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
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
              aria-label={`${ROLE_LABELS[role]} hex color value`}
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
export type FlagsPatch = {
  headlineStyle?: ThemeSources['headlineStyle']
  eyebrowStyle?: ThemeSources['eyebrowStyle']
  darkSections?: boolean
  logoSize?: ThemeSources['logoSize']
}

export default function ThemeControls({
  palette,
  typography,
  roundness,
  density,
  visualFeel,
  headlineStyle,
  eyebrowStyle,
  darkSections,
  logoSize,
  layout,
  layoutLock,
  fonts,
  contrastWarnings,
  saving,
  onPreviewPalette,
  onCommitPalette,
  onChangeFont,
  onChangeFlags,
  onChangeLayout,
  logoSlot,
  locks = [],
}: {
  palette: ThemeSources['palette']
  typography: ThemeSources['typography']
  roundness: ThemeSources['roundness']
  density: ThemeSources['density']
  visualFeel: ThemeSources['visualFeel']
  headlineStyle: ThemeSources['headlineStyle']
  eyebrowStyle: ThemeSources['eyebrowStyle']
  darkSections: boolean
  logoSize: ThemeSources['logoSize']
  layout: ThemeSources['layout']
  // Why the layout presets are disabled (the effective tier lacks
  // `layout-presets`), or null when available. undefined ⇒ unknown ⇒ disabled.
  layoutLock: string | null | undefined
  fonts: readonly string[]
  contrastWarnings: string[]
  saving: boolean
  onPreviewPalette: (role: PaletteRole, hex: string) => void
  onCommitPalette: (role: PaletteRole, hex: string) => void
  onChangeFont: (slot: 'headingFont' | 'bodyFont' | 'accentFont', font: string) => void
  onChangeFlags: (patch: FlagsPatch) => void
  onChangeLayout: (patch: LayoutPresets) => void
  // The logo upload slots (LogoControls), rendered beside Logo size.
  logoSlot?: ReactNode
  // Design locks (the design chat's lock chips): locked levers are disabled.
  locks?: DesignLockDto[]
}) {
  const paletteLocked = isLeverLocked(locks, 'palette')
  const fontsLocked = isLeverLocked(locks, 'fonts')
  const treatmentsLocked = isLeverLocked(locks, 'treatments')
  const presetsLocked = new Set<string>(lockedPresets(locks))
  const layoutDisabledReason = layoutLock === null ? null : (layoutLock ?? 'Checking this site’s template…')
  return (
    <div className="flex flex-col gap-2 border-b border-border-default bg-surface-subtle px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-heading text-[11px] font-semibold text-text-secondary" title={paletteLocked ? LOCKED_TITLE : undefined}>
            Colors{paletteLocked && <LockedMark />}
          </span>
          <div className="flex items-center gap-1.5">
            {PALETTE_ROLES.map((role) => (
              <Swatch
                key={role}
                role={role}
                hex={palette?.[role] ?? '#000000'}
                saving={saving}
                locked={paletteLocked}
                onPreview={onPreviewPalette}
                onCommit={onCommitPalette}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 font-heading text-[11px] font-semibold text-text-secondary" title={fontsLocked ? LOCKED_TITLE : undefined}>
            Fonts{fontsLocked && <LockedMark />}
          </span>
          {FONT_SLOTS.map(({ key, label }) => {
            // Legacy design.json can omit a font slot (e.g. accentFont). Guard so
            // a missing value renders a blank <select> instead of crashing.
            const current = typography?.[key] ?? ''
            return (
              <label key={key} className="flex items-center gap-1.5">
                <span className="font-body text-[11px] text-text-muted">{label}</span>
                <select
                  value={current}
                  disabled={saving || fontsLocked}
                  title={fontsLocked ? LOCKED_TITLE : undefined}
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

        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 font-heading text-[11px] font-semibold text-text-secondary" title={treatmentsLocked ? LOCKED_TITLE : undefined}>
            Treatments{treatmentsLocked && <LockedMark />}
          </span>
          <label className="flex items-center gap-1.5">
            <span className="font-body text-[11px] text-text-muted">Headlines</span>
            <select
              value={headlineStyle}
              disabled={saving || treatmentsLocked}
              onChange={(e) => onChangeFlags({ headlineStyle: e.target.value as ThemeSources['headlineStyle'] })}
              className="rounded border border-border-default bg-surface-card px-2 py-1 font-body text-xs focus:border-brand-cyan focus:outline-none disabled:opacity-50"
            >
              <option value="sans">Sans</option>
              <option value="serif">Serif</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-body text-[11px] text-text-muted">Eyebrows</span>
            <select
              value={eyebrowStyle}
              disabled={saving || treatmentsLocked}
              onChange={(e) => onChangeFlags({ eyebrowStyle: e.target.value as ThemeSources['eyebrowStyle'] })}
              className="rounded border border-border-default bg-surface-card px-2 py-1 font-body text-xs focus:border-brand-cyan focus:outline-none disabled:opacity-50"
            >
              <option value="standard">Standard</option>
              <option value="mono">Mono</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={darkSections}
              disabled={saving || treatmentsLocked}
              onChange={(e) => onChangeFlags({ darkSections: e.target.checked })}
              className="h-3.5 w-3.5 accent-brand-cyan disabled:opacity-50"
            />
            <span className="font-body text-[11px] text-text-muted">Dark sections</span>
          </label>
        </div>

        {logoSlot}

        {/* design.json logo.size (template 2026.09.8): header 44px desktop / 40px
            phone, footer 40px — for stacked or two-line lockups. */}
        <label className="flex items-center gap-1.5">
          <span className="font-heading text-[11px] font-semibold text-text-secondary">Logo size</span>
          <select
            value={logoSize}
            disabled={saving}
            onChange={(e) => onChangeFlags({ logoSize: e.target.value as ThemeSources['logoSize'] })}
            className="rounded border border-border-default bg-surface-card px-2 py-1 font-body text-xs focus:border-brand-cyan focus:outline-none disabled:opacity-50"
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
          </select>
        </label>

        {/* design.json layout presets (template 2026.09.9): each restructures a
            whole block family site-wide; a section's own layout variant wins.
            Admin-only (the Theme Studio is); disabled below the capability. */}
        <div className="flex flex-wrap items-center gap-3" title={layoutDisabledReason ?? undefined}>
          <span className="font-heading text-[11px] font-semibold text-text-secondary">Layout</span>
          {LAYOUT_PRESET_NAMES.map((name) => (
            <label key={name} className="flex items-center gap-1.5" title={presetsLocked.has(name) ? LOCKED_TITLE : undefined}>
              <span className="flex items-center gap-1 font-body text-[11px] text-text-muted">
                {LAYOUT_PRESET_LABELS[name]}
                {presetsLocked.has(name) && <LockedMark />}
              </span>
              <select
                value={layout?.[name] ?? 'default'}
                disabled={saving || layoutDisabledReason !== null || presetsLocked.has(name)}
                aria-describedby={layoutDisabledReason !== null ? 'theme-layout-lock' : undefined}
                onChange={(e) => onChangeLayout({ [name]: e.target.value } as LayoutPresets)}
                className="rounded border border-border-default bg-surface-card px-2 py-1 font-body text-xs focus:border-brand-cyan focus:outline-none disabled:opacity-50"
              >
                {(LAYOUT_PRESETS[name].values as readonly string[]).map((v) => (
                  <option key={v} value={v}>
                    {LAYOUT_VALUE_LABELS[v] ?? v}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {layoutDisabledReason !== null && (
            <span id="theme-layout-lock" className="font-body text-[11px] text-text-muted">
              {layoutDisabledReason}
            </span>
          )}
        </div>

        <span className="font-body text-[11px] text-text-muted">
          roundness: {roundness} · density: {density} · feel: {visualFeel}
        </span>
      </div>

      <p className="font-body text-[11px] text-text-muted">
        Headline and eyebrow treatments and the logo size preview here when the deployed site&rsquo;s template supports them (logo size: template 2026.09.8+; layout presets: 2026.09.9+). Dark sections apply only after the site rebuilds.
      </p>

      {contrastWarnings.length > 0 && (
        <p className="font-body text-[11px] text-warning-strong">
          Contrast: {contrastWarnings.join(' · ')}
        </p>
      )}
    </div>
  )
}
