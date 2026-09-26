// Pure + client-safe. Which Design Studio levers a client site's template
// honours. The template declares them in c5-template.json on the DRAFT branch
// ({ templateVersion, capabilities[] }); absent/malformed ⇒ L1 (palette,
// tokens, CSS, treatments). Effective tier = draft marker ∩ the deployed
// shell's <meta name="c5-capabilities"> (intersectWithShell, P6a). Fonts (L2+)
// and `style` (L3+) are stripped by the generator and rejected on apply below
// their tier.
import type { DesignBundle } from './bundle'
import { isPlainObject } from './input-validation'
import { DEFAULT_CAPABILITIES, type CapabilityLevel, type DesignCapabilities } from './run-types'
import type { ShellCapabilities } from './shell-capabilities'

export const TEMPLATE_MARKER_PATH = 'c5-template.json'
export const CAPABILITY_FONTS = 'fonts'
export const CAPABILITY_STYLE_AXES = 'style-axes'
export const CAPABILITY_SPECIMEN = 'specimen'

const MAX_CAPABILITIES = 20
const MAX_TOKEN_LENGTH = 40
const FONT_LOCK_NOTE = 'Fonts are locked on this site (template below L2) — kept the current typography.'
const FONT_LOCK_VIOLATION = 'Fonts are locked on this site (template below L2) — this design changes the typography.'
const STYLE_LOCK_NOTE = 'Style axes are not available on this site yet — the concept’s style settings were dropped.'
const STYLE_LOCK_VIOLATION = 'Style axes are locked on this site (template below L3) — this design sets style presets.'
const sameStyle = (a: DesignBundle['style'], b: DesignBundle['style']): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

export function capabilityLevel(caps: string[]): CapabilityLevel {
  if (!caps.includes(CAPABILITY_FONTS)) return 1
  if (!caps.includes(CAPABILITY_STYLE_AXES)) return 2
  if (!caps.includes(CAPABILITY_SPECIMEN)) return 3
  return 4
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= MAX_TOKEN_LENGTH)
    .slice(0, MAX_CAPABILITIES)
}

export function parseTemplateMarker(text: string | null): DesignCapabilities {
  if (text === null) return DEFAULT_CAPABILITIES
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return DEFAULT_CAPABILITIES
  }
  if (!isPlainObject(parsed)) return DEFAULT_CAPABILITIES
  const capabilities = cleanList(parsed.capabilities)
  const templateVersion =
    typeof parsed.templateVersion === 'string' && parsed.templateVersion.length <= MAX_TOKEN_LENGTH ? parsed.templateVersion : null
  return { level: capabilityLevel(capabilities), source: 'marker', templateVersion, capabilities }
}

// Re-read the snapshot stored in design_runs.capabilities (defensive: JSONB).
export function capabilitiesFromJson(value: unknown): DesignCapabilities {
  if (!isPlainObject(value)) return DEFAULT_CAPABILITIES
  const { level, source, templateVersion, shell } = value
  if (level !== 1 && level !== 2 && level !== 3 && level !== 4) return DEFAULT_CAPABILITIES
  if (source !== 'default' && source !== 'marker') return DEFAULT_CAPABILITIES
  const capabilities = cleanList(value.capabilities)
  if (capabilityLevel(capabilities) !== level && source === 'marker') return DEFAULT_CAPABILITIES
  return {
    level,
    source,
    templateVersion: typeof templateVersion === 'string' ? templateVersion : null,
    capabilities,
    ...(shell === 'verified' || shell === 'unverified' ? { shell } : {}),
  }
}

export const fontsUnlocked = (c: DesignCapabilities): boolean => c.level >= 2
export const styleAxesUnlocked = (c: DesignCapabilities): boolean => c.level >= 3
export const specimenUnlocked = (c: DesignCapabilities): boolean => c.level >= 4

// Effective tier: a lever unlocks only when the DRAFT template (what the next
// build ships) AND the DEPLOYED shell (what previews render on) both declare
// it. An unreachable shell keeps the draft tier, flagged 'unverified' —
// previews need the shell anyway, and the font preview uses Google Fonts.
export function intersectWithShell(draft: DesignCapabilities, shell: ShellCapabilities): DesignCapabilities {
  if (shell.status === 'unverified') return { ...draft, shell: 'unverified' }
  const capabilities = draft.capabilities.filter((c) => shell.capabilities.includes(c))
  return { ...draft, capabilities, level: capabilityLevel(capabilities), shell: 'verified' }
}

function sameTypography(a: DesignBundle['typography'], b: DesignBundle['typography']): boolean {
  return a.headingFont === b.headingFont && a.bodyFont === b.bodyFont && a.accentFont === b.accentFont
}

// Generator side: STRIP what the tier doesn't allow (the concept stays usable).
export function enforceCapabilities(
  bundle: DesignBundle,
  current: DesignBundle,
  caps: DesignCapabilities
): { bundle: DesignBundle; notes: string[] } {
  let out = bundle
  const notes: string[] = []
  if (!fontsUnlocked(caps) && !sameTypography(out.typography, current.typography)) {
    out = { ...out, typography: { ...current.typography } }
    notes.push(FONT_LOCK_NOTE)
  }
  // Mirror the fonts lever: below L3 keep whatever style the site already has
  // (a draft design.json may carry axes even when the effective tier is lower)
  // and only note when the concept actually tried to change it.
  if (!styleAxesUnlocked(caps) && !sameStyle(out.style, current.style)) {
    const { style: _dropped, ...rest } = out
    out = current.style ? { ...rest, style: { ...current.style } } : rest
    notes.push(STYLE_LOCK_NOTE)
  }
  return { bundle: out, notes }
}

// Apply side: REJECT what the tier doesn't allow (never silently rewrite a
// design the admin chose).
export function capabilityViolations(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): string[] {
  const v: string[] = []
  if (!fontsUnlocked(caps) && !sameTypography(bundle.typography, current.typography)) v.push(FONT_LOCK_VIOLATION)
  if (!styleAxesUnlocked(caps) && !sameStyle(bundle.style, current.style)) v.push(STYLE_LOCK_VIOLATION)
  return v
}
