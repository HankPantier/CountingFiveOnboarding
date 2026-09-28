// Pure + client-safe. Which Design Studio levers a client site's template
// honours. The template declares them in c5-template.json on the DRAFT branch
// ({ templateVersion, capabilities[] }); absent/malformed ⇒ L1 (palette,
// tokens, CSS, treatments). Effective tier = draft marker ∩ the deployed
// shell's <meta name="c5-capabilities"> (intersectWithShell, P6a). Below its
// tier a lever is held at the site's CURRENT value: the generator restores the
// current fonts (L2+) / style axes (L3+) with a note, and apply rejects only a
// bundle that would CHANGE them. A bundle with no `style` at all (pre-P6b
// versions/concepts) means "keep the current style" below L3 — keepLockedStyle
// fills it in so the replace-semantics render never wipes the site's axes.
//
// Layout presets (template 2026.09.9) are a capability FLAG, not a level:
// `layout-presets` in the effective capabilities unlocks design.json `layout`.
// Below it the site's current layout is held exactly like `style`
// (keepLockedLayout / enforceCapabilities / capabilityViolations).
//
// Effective template VERSION = min(draft marker, deployed shell's
// <meta name="c5-template-version">) — see effectiveTemplateVersion. A
// verified shell WITHOUT that meta predates 2026.09.9 (the meta shipped with
// it), so it counts as SHELL_WITHOUT_VERSION_META (2026.09.8). The Studio's
// versioned block vocabulary (brief + chat-prompt block-catalog hint) reads
// caps.templateVersion, so it follows the effective version. The content
// editor's layout picker / AI-edit hint keep the DRAFT version on purpose: page
// content is written to the draft branch and renders on the draft's template.
import type { DesignBundle } from './bundle'
import { compareTemplateVersions, isTemplateVersion } from '@/lib/content/block-catalog'
import { sameLayout } from './layout-presets'
import { isPlainObject } from './input-validation'
import { DEFAULT_CAPABILITIES, type CapabilityLevel, type DesignCapabilities } from './run-types'
import type { ShellCapabilities } from './shell-capabilities'

export const TEMPLATE_MARKER_PATH = 'c5-template.json'
export const CAPABILITY_FONTS = 'fonts'
export const CAPABILITY_STYLE_AXES = 'style-axes'
export const CAPABILITY_SPECIMEN = 'specimen'
export const CAPABILITY_LAYOUT_PRESETS = 'layout-presets'
// What a verified shell that carries no <meta name="c5-template-version">
// counts as: that meta shipped in 2026.09.9, so such a shell is ≤ 2026.09.8.
export const SHELL_WITHOUT_VERSION_META = '2026.09.8'

const MAX_CAPABILITIES = 20
const MAX_TOKEN_LENGTH = 40
const MAX_SHELL_NOTE = 400
const FONT_LOCK_NOTE = 'Fonts are locked on this site (template below L2) — kept the current typography.'
const FONT_LOCK_VIOLATION = 'Fonts are locked on this site (template below L2) — this design changes the typography.'
const STYLE_LOCK_NOTE = 'Style axes are not available on this site yet — the concept’s style settings were dropped.'
const STYLE_LOCK_VIOLATION = 'Style axes are locked on this site (template below L3) — this design sets style presets.'
const LAYOUT_LOCK_NOTE = 'Layout presets are not available on this site yet (template before 2026.09.9) — the concept’s layout settings were dropped.'
const LAYOUT_LOCK_VIOLATION = 'Layout presets are locked on this site (template before 2026.09.9) — this design sets layout presets.'
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
  const { level, source, templateVersion, shell, shellNote } = value
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
    ...(shell === 'unverified' && typeof shellNote === 'string' && shellNote.length > 0 && shellNote.length <= MAX_SHELL_NOTE
      ? { shellNote }
      : {}),
  }
}

export const fontsUnlocked = (c: DesignCapabilities): boolean => c.level >= 2
export const styleAxesUnlocked = (c: DesignCapabilities): boolean => c.level >= 3
export const specimenUnlocked = (c: DesignCapabilities): boolean => c.level >= 4
// A flag, not a level: present in the (effective) capability list or not.
export const layoutPresetsUnlocked = (c: DesignCapabilities): boolean => c.capabilities.includes(CAPABILITY_LAYOUT_PRESETS)

// min(draft, shell). An unverified shell keeps the draft's version (like the
// tier); a verified shell without the version meta counts as
// SHELL_WITHOUT_VERSION_META. No/malformed draft version stays null (the
// baseline vocabulary) — never raised by the shell.
export function effectiveTemplateVersion(draftVersion: string | null, shell: ShellCapabilities): string | null {
  if (shell.status !== 'verified' || !isTemplateVersion(draftVersion)) return draftVersion
  const shellVersion = isTemplateVersion(shell.templateVersion) ? shell.templateVersion : SHELL_WITHOUT_VERSION_META
  return compareTemplateVersions(draftVersion, shellVersion) <= 0 ? draftVersion : shellVersion
}

// Effective tier: a lever unlocks only when the DRAFT template (what the next
// build ships) AND the DEPLOYED shell (what previews render on) both declare
// it. An unreachable shell keeps the draft tier, flagged 'unverified' —
// previews need the shell anyway, and the font preview uses Google Fonts. A
// shell that answered without the Revaltus marker (the old site before DNS
// cutover) is unverified too, with its reason kept as `shellNote`.
// templateVersion becomes the EFFECTIVE version, min(draft, shell meta) — see
// effectiveTemplateVersion. The Studio brief filters its block vocabulary by it
// (brief/block-catalog.ts).
export function intersectWithShell(draft: DesignCapabilities, shell: ShellCapabilities): DesignCapabilities {
  if (shell.status === 'unverified') {
    return { ...draft, shell: 'unverified', ...(shell.reason ? { shellNote: shell.reason.slice(0, MAX_SHELL_NOTE) } : {}) }
  }
  const capabilities = draft.capabilities.filter((c) => shell.capabilities.includes(c))
  return {
    ...draft,
    capabilities,
    level: capabilityLevel(capabilities),
    templateVersion: effectiveTemplateVersion(draft.templateVersion, shell),
    shell: 'verified',
  }
}

function sameTypography(a: DesignBundle['typography'], b: DesignBundle['typography']): boolean {
  return a.headingFont === b.headingFont && a.bodyFont === b.bodyFont && a.accentFont === b.accentFont
}

// Below L3 an ABSENT bundle.style (a pre-P6b version/concept that predates
// style axes) means "keep the current style": fill it from the draft so the
// render (bundleToRepoFiles replaces design.json `style` wholesale) keeps the
// site's axes. An explicit style is left for enforce/violations to judge.
export function keepLockedStyle(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): DesignBundle {
  if (styleAxesUnlocked(caps) || bundle.style !== undefined || !current.style) return bundle
  return { ...bundle, style: { ...current.style } }
}

// Below the `layout-presets` flag an ABSENT bundle.layout (every version or
// concept that predates presets) means "keep the current layout": fill it from
// the draft so the replace-semantics render keeps design.json `layout`.
export function keepLockedLayout(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): DesignBundle {
  if (layoutPresetsUnlocked(caps) || bundle.layout !== undefined || !current.layout) return bundle
  return { ...bundle, layout: { ...current.layout } }
}

// Why the layout presets are locked, or null when the EFFECTIVE tier has them —
// worded for the half that is actually missing. An unverified shell keeps the
// draft tier, so a lock there always means the DRAFT template predates them;
// a verified shell can be the missing half while the draft already has them.
export const LAYOUT_LOCKED_DRAFT_REASON =
  'Layout presets need template 2026.09.9 or newer: this site’s draft template is older. Roll the template forward first.'
export const LAYOUT_LOCKED_SHELL_REASON =
  'Layout presets need template 2026.09.9 or newer on the deployed site too: the draft has it, but the live build is older. Publish the draft (or wait for its deploy), then reload.'
export function layoutLockedReason(read: { draft: DesignCapabilities; effective: DesignCapabilities }): string | null {
  if (layoutPresetsUnlocked(read.effective)) return null
  return layoutPresetsUnlocked(read.draft) && read.effective.shell === 'verified' ? LAYOUT_LOCKED_SHELL_REASON : LAYOUT_LOCKED_DRAFT_REASON
}

// Both holds at once — what commitDesignVersion renders and records.
export const keepLockedLevers = (bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): DesignBundle =>
  keepLockedLayout(keepLockedStyle(bundle, current, caps), current, caps)

// Generator side: hold what the tier doesn't allow at the site's current
// value (the concept stays usable).
export function enforceCapabilities(
  bundle: DesignBundle,
  current: DesignBundle,
  caps: DesignCapabilities
): { bundle: DesignBundle; notes: string[] } {
  let out = keepLockedLevers(bundle, current, caps)
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
  if (!layoutPresetsUnlocked(caps) && !sameLayout(out.layout, current.layout)) {
    const { layout: _dropped, ...rest } = out
    out = current.layout ? { ...rest, layout: { ...current.layout } } : rest
    notes.push(LAYOUT_LOCK_NOTE)
  }
  return { bundle: out, notes }
}

// Apply side: REJECT a change the tier doesn't allow (never silently rewrite a
// design the admin chose). An absent style below L3 is "keep current", not a
// change — the caller renders keepLockedStyle(bundle) so the axes survive.
export function capabilityViolations(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): string[] {
  const v: string[] = []
  if (!fontsUnlocked(caps) && !sameTypography(bundle.typography, current.typography)) v.push(FONT_LOCK_VIOLATION)
  if (!styleAxesUnlocked(caps) && !sameStyle(keepLockedStyle(bundle, current, caps).style, current.style)) v.push(STYLE_LOCK_VIOLATION)
  if (!layoutPresetsUnlocked(caps) && !sameLayout(keepLockedLayout(bundle, current, caps).layout, current.layout)) {
    v.push(LAYOUT_LOCK_VIOLATION)
  }
  return v
}
