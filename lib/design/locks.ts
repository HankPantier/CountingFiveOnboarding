// Pure + client-safe. Design locks (migration 085): an admin freezes an AREA
// (one CSS target — a data-block / data-component type, site-wide) or a
// site-wide LEVER. Enforcement lives server-side (lock-enforce.ts); this is
// the shared vocabulary for the chat tools, the API and the UI.
import type { DesignBundle } from './bundle'
import { CSS_TARGETS, isCssTarget, type CssTarget } from './css-targets'
import { LAYOUT_PRESETS, LAYOUT_PRESET_NAMES, type LayoutPresetName } from './layout-presets'

export const BASE_LEVERS = ['palette', 'fonts', 'tokens', 'treatments', 'style'] as const
export type BaseLever = (typeof BASE_LEVERS)[number]
export type LeverKey = BaseLever | `layout:${LayoutPresetName}`
export const LEVER_KEYS: readonly LeverKey[] = [...BASE_LEVERS, ...LAYOUT_PRESET_NAMES.map((p) => `layout:${p}` as const)]

export type LockKind = 'area' | 'lever'

// What an area lock froze (lock-pins.ts captures it from the draft theme).
export type LockSnapshot = {
  vars: Record<string, string>
  darkVars: Record<string, string>
  fonts: { heading: string; body: string; accent: string; display: 'heading' | 'accent' }
}

export type DesignLock =
  | { kind: 'area'; key: CssTarget; label: string; snapshot: LockSnapshot | null }
  | { kind: 'lever'; key: LeverKey; label: string; snapshot: null }

export type LockChange =
  | { op: 'lock'; areas: CssTarget[]; levers: LeverKey[]; label?: string }
  | { op: 'unlock'; keys: { kind: LockKind; key: string }[] }

// The client-facing row (no snapshot).
export type DesignLockDto = { kind: LockKind; key: string; label: string; createdAt: string }

export function isLeverKey(s: string): s is LeverKey {
  return (LEVER_KEYS as readonly string[]).includes(s)
}

const LEVER_LABELS: Record<BaseLever, string> = {
  palette: 'Palette',
  fonts: 'Fonts',
  tokens: 'Shape & spacing',
  treatments: 'Treatments',
  style: 'Style presets',
}

const PRESET_LABELS: Record<LayoutPresetName, string> = {
  cards: 'Card grid layout',
  ctaBanner: 'CTA banner layout',
  faq: 'FAQ layout',
  team: 'Team layout',
  testimonials: 'Testimonials layout',
}

export function targetLabel(target: CssTarget): string {
  const words = target.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function leverLabel(key: LeverKey): string {
  if (key.startsWith('layout:')) return PRESET_LABELS[key.slice('layout:'.length) as LayoutPresetName]
  return LEVER_LABELS[key as BaseLever]
}

export function defaultLockLabel(kind: LockKind, key: string): string {
  if (kind === 'area' && isCssTarget(key)) return targetLabel(key)
  if (kind === 'lever' && isLeverKey(key)) return leverLabel(key)
  return key
}

// Anything with a kind + key: a DesignLock, a row, or the client DTO.
type LockLike = { kind: LockKind | string; key: string }

export const lockedTargets = (locks: readonly LockLike[]): CssTarget[] =>
  locks.flatMap((l) => (l.kind === 'area' && isCssTarget(l.key) ? [l.key] : []))

// A layout preset is locked when it is locked itself OR it restyles a locked
// area (e.g. `cards` re-lays out service-cards).
export function lockedPresets(locks: readonly LockLike[]): LayoutPresetName[] {
  const targets = new Set<string>(lockedTargets(locks))
  return LAYOUT_PRESET_NAMES.filter(
    (p) =>
      locks.some((l) => l.kind === 'lever' && l.key === `layout:${p}`) ||
      (LAYOUT_PRESETS[p].blocks as readonly string[]).some((b) => targets.has(b))
  )
}

export function isLeverLocked(locks: readonly LockLike[], lever: BaseLever): boolean {
  return locks.some((l) => l.kind === 'lever' && l.key === lever)
}

export const LOCKABLE_AREAS: readonly CssTarget[] = CSS_TARGETS

export function lockedError(label: string): string {
  return `${label} is locked — nothing was changed. Ask the user whether to unlock it before changing it.`
}

// A bundle as a model should see it: without the platform's lock pins
// (css.locks) and pinned fonts, which no model authors.
export function withoutLockPins<B extends Pick<DesignBundle, 'css' | 'typography'>>(b: B): B {
  const { locks: _pins, ...css } = b.css
  const { pinnedFonts: _fonts, ...typography } = b.typography
  return { ...b, css, typography }
}

export type ControlsChange = {
  palette: boolean
  fonts: boolean
  treatments: boolean
  layoutBefore: Partial<Record<LayoutPresetName, string>> | undefined
  layoutAfter: Partial<Record<LayoutPresetName, string>> | undefined
}

// The Controls pickers' refusal (theme PATCH → 422): the names of the locks a
// direct edit would break, or [] when it touches nothing locked.
export function controlsLockViolations(locks: readonly (LockLike & { label: string })[], change: ControlsChange): string[] {
  const out: string[] = []
  const lever = (key: BaseLever) => locks.find((l) => l.kind === 'lever' && l.key === key)
  const hit = (on: boolean, key: BaseLever) => {
    const l = on ? lever(key) : undefined
    if (l) out.push(l.label || leverLabel(key))
  }
  hit(change.palette, 'palette')
  hit(change.fonts, 'fonts')
  hit(change.treatments, 'treatments')
  for (const p of lockedPresets(locks)) {
    if ((change.layoutBefore?.[p] ?? 'default') !== (change.layoutAfter?.[p] ?? 'default')) out.push(leverLabel(`layout:${p}`))
  }
  return out
}

export function controlsLockedError(names: string[]): string {
  return `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} locked in the design chat — unlock ${names.length === 1 ? 'it' : 'them'} there (or with the lock chip) first.`
}
