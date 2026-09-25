// Pure + client-safe. Which Design Studio levers a client site's template
// honours. The template declares them in c5-template.json on the DRAFT branch
// ({ templateVersion, capabilities[] }); absent/malformed ⇒ L1 (palette,
// tokens, CSS, treatments). The spec's intersection with the deployed shell's
// <meta name="c5-capabilities"> is deferred to T1 (the template doesn't emit it
// yet). DesignBundle has no `style` field until P6b, so a model-emitted style
// key is always stripped by the concept validator (hasStyleField).
import type { DesignBundle } from './bundle'
import { isPlainObject } from './input-validation'
import { DEFAULT_CAPABILITIES, type CapabilityLevel, type DesignCapabilities } from './run-types'

export const TEMPLATE_MARKER_PATH = 'c5-template.json'
export const CAPABILITY_FONTS = 'fonts'
export const CAPABILITY_STYLE_AXES = 'style-axes'
export const CAPABILITY_SPECIMEN = 'specimen'

const MAX_CAPABILITIES = 20
const MAX_TOKEN_LENGTH = 40
const FONT_LOCK_NOTE = 'Fonts are locked on this site (template below L2) — kept the current typography.'
const FONT_LOCK_VIOLATION = 'Fonts are locked on this site (template below L2) — this design changes the typography.'

function levelFor(caps: string[]): CapabilityLevel {
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
  return { level: levelFor(capabilities), source: 'marker', templateVersion, capabilities }
}

// Re-read the snapshot stored in design_runs.capabilities (defensive: JSONB).
export function capabilitiesFromJson(value: unknown): DesignCapabilities {
  if (!isPlainObject(value)) return DEFAULT_CAPABILITIES
  const { level, source, templateVersion } = value
  if (level !== 1 && level !== 2 && level !== 3 && level !== 4) return DEFAULT_CAPABILITIES
  if (source !== 'default' && source !== 'marker') return DEFAULT_CAPABILITIES
  const capabilities = cleanList(value.capabilities)
  if (levelFor(capabilities) !== level && source === 'marker') return DEFAULT_CAPABILITIES
  return {
    level,
    source,
    templateVersion: typeof templateVersion === 'string' ? templateVersion : null,
    capabilities,
  }
}

export const fontsUnlocked = (c: DesignCapabilities): boolean => c.level >= 2
export const styleAxesUnlocked = (c: DesignCapabilities): boolean => c.level >= 3

export function hasStyleField(raw: unknown): boolean {
  return isPlainObject(raw) && 'style' in raw
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
  if (fontsUnlocked(caps) || sameTypography(bundle.typography, current.typography)) return { bundle, notes: [] }
  return { bundle: { ...bundle, typography: { ...current.typography } }, notes: [FONT_LOCK_NOTE] }
}

// Apply side: REJECT what the tier doesn't allow (never silently rewrite a
// design the admin chose).
export function capabilityViolations(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): string[] {
  if (!fontsUnlocked(caps) && !sameTypography(bundle.typography, current.typography)) return [FONT_LOCK_VIOLATION]
  return []
}
