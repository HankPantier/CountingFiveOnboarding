// Pure. The capability-filtered token + selector + output contract (ported
// from export-design-brief's design-system.md, plus the sanitizer's rules so
// the model writes CSS that passes). Byte-stable per capability tier: it may
// depend on `caps` ONLY through fontsUnlocked(), styleAxesUnlocked() and
// layoutPresetsUnlocked() (the 2026.09.9 flag — below it every line here is
// byte-identical to the pre-preset contract).
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import { CHROME_COMPONENTS, CSS_TARGETS, TREATMENT_STATE_ATTRS } from '../css-targets'
import { fontsUnlocked, layoutPresetsUnlocked, styleAxesUnlocked } from '../capabilities'
import { styleAxesSummary } from '../style-axes'
import { layoutPresetsSummary } from '../layout-presets'
import type { DesignCapabilities } from '../run-types'

export const TOKEN_CONTRACT = `TOKEN CONTRACT (theme.css is regenerated from your palette + tokens; never restate it)
- Colour variables: --color-primary(-foreground), --color-secondary(-foreground), --color-accent(-foreground) (from complementary), --color-background, --color-foreground, --color-muted(-foreground), --color-card(-foreground), --color-border, --color-input, --color-ring (from action), --color-action / --color-action-foreground, --color-primary-hex, --color-near-black, --color-near-white, --color-complementary.
- Small action-coloured text (.t-kicker kickers, card dates, badges) is auto-corrected for contrast: theme.css derives --color-action-text (canvas) and --color-action-on-primary (on bg-primary) at 4.5:1 from your action, so action may be a bold, vivid colour. On template 2026.09.5+ the headline accent word, primary-band stat figures and the pricing-calculator estimate read the same corrected token (identical to the raw action wherever it already passes); icons and fills keep the raw --color-action.
- Spacing --c5-space-xs … --c5-space-2xl; radius --radius-sm/md/lg/pill and --radius; fonts --font-heading, --font-body, --font-accent.
- Type scale --type-display, --type-h1 … --type-h4, --type-body-lg, --type-small, --type-caption, --tracking-display, --tracking-tight; utilities .t-display, .t-h1 … .t-h4, .t-body-lg, .t-small, .t-kicker.
- Composition utilities: .font-accent, .u-card, .u-card-interactive, .u-frame, .u-icon-square; motion/overlay tokens --duration-base, --overlay-soft, --overlay-medium.
- Image grade: the duotone wash on framed images reads --c5-media-grade-opacity (default 0.24) and --c5-media-grade-fill (default linear-gradient(150deg, var(--color-primary) 0%, var(--color-action) 130%)); set them on :root in css.global for a stronger or re-tinted grade instead of restyling the images.
- Buttons: the CTA uses --color-action; secondary = primary-tint fill; tertiary = action outline.`

function leversSection(caps: DesignCapabilities): string {
  const typography = fontsUnlocked(caps)
    ? `- typography: { headingFont, bodyFont, accentFont } — each MUST be one of: ${CURATED_FONTS.join(', ')}. Keep the grotesk-display + serif-accent contrast.`
    : '- typography: LOCKED on this site — copy headingFont, bodyFont and accentFont EXACTLY from the current design. Express type personality through the type-scale custom properties, tracking and treatments instead.'
  return `LEVERS YOU CONTROL (per concept)
- palette: { ${PALETTE_ROLES.join(', ')} } — six #rrggbb hex values (primary = structure, secondary = soft surface, complementary = accent surfaces, action = the CTA, nearBlack = body text, nearWhite = canvas).
${typography}
- tokens: { roundness: sharp | soft | pill, density: tight | balanced | airy, visualFeel: classic | modern | editorial, spacing: { xs, sm, md, lg, xl, 2xl }, radius: { none, sm, md, lg, pill } } — spacing/radius values are CSS lengths like "16px" or "1.5rem".
- treatments: { headlineStyle: sans | serif, eyebrowStyle: standard | mono, darkSections: true | false }.
- css: { global?: string, blocks: { <target>: string } } — scoped CSS, see the rules below.
${styleLever(caps)}${layoutLever(caps)}`
}

// Only when the EFFECTIVE tier has `layout-presets`. Nothing is added below
// it (not even a "never emit" line) so the L1–L4 prefixes stay byte-identical.
function layoutLever(caps: DesignCapabilities): string {
  if (!layoutPresetsUnlocked(caps)) return ''
  return `
- layout (optional): site-wide LAYOUT PRESETS — { <preset>: <value> }; omit a preset (or use "default") to keep the default structure. Presets:
${layoutPresetsSummary('  - layout.')}
  A preset restructures every section of its family that has no explicit per-section layout; ink card bands keep theirs. When a preset is set, css.blocks.<id> may also be prefixed by it, e.g. html[data-c5-layout-cards="list"] [data-block="service-cards"] … (attribute = data-c5-layout-<kebab preset>).`
}

// The one sanctioned exception to the art direction's "Restyle only" rule —
// added only when the layout lever is (ART_DIRECTION itself never changes).
export const LAYOUT_PRESETS_EXCEPTION = `LAYOUT PRESETS — the one sanctioned exception to "Restyle only"
- The layout presets are template-built, accessible alternative structures, not new markup. You may use them to restructure when it serves THIS firm's concept (e.g. services as a list for a firm with a few deep offerings, a featured testimonial for a firm with one strong client story); name the preset in a move.
- Inside a block's own css.blocks.<id> you may also re-grid its existing items within the CSS rules below (grid-template-columns, column spans, flex-direction, gap, alignment). Never hide an item, never change the markup, never move content out of its block.
- Use \`order\` ONLY to swap a block's media and its text (image left ↔ right), on the [data-c5-slot="media"] or [data-c5-slot="body"] element — any other \`order\` is rejected. Never reorder headings, cards, questions or quotes — the visual order must match the reading order.`

function styleLever(caps: DesignCapabilities): string {
  if (!styleAxesUnlocked(caps)) return '- Never emit a "style" field (style axes are not available to you).'
  return `- style (optional): template style presets — { <axis>: <value> }; omit an axis (or use "default") to keep the default look. Prefer a preset over hand CSS for the same effect. Axes:
${styleAxesSummary()}
  nav=inverted makes the bar the primary colour: a dark logo sits on a light plate there, and a light logo (brand.json logo.tone "light") sits directly on the bar, so either stays legible — it is safe to use.
  When an axis is set, css.blocks.<id> may also be prefixed by it, e.g. html[data-c5-cards="flat"] [data-block="service-cards"] … (attribute = data-c5-<kebab axis>).`
}

export const CSS_RULES_SECTION = `CSS RULES (enforced by a strict sanitizer — a violating concept is rejected)
- Block targets: ${CSS_TARGETS.filter((t) => !(CHROME_COMPONENTS as readonly string[]).includes(t)).join(', ')} (selector [data-block="<id>"]); chrome targets: ${CHROME_COMPONENTS.join(', ')} (selector [data-component="<id>"]).
- css.blocks.<id> may ONLY contain selectors that start with that target's own attribute selector, optionally prefixed by an html state: html[${TREATMENT_STATE_ATTRS.join(']/html[')}] (values: data-headline="sans|serif", data-eyebrow="standard|mono").
- css.global may target any of the above, plus :root custom properties named --c5-*, --type-*, --tracking-*, --shadow-*, --overlay-*, --duration-* (never --color-* or --font-*).
- EVERY selector, in css.global and every css.blocks.<id> alike, MUST START with one of those scopes: [data-block="<id>"], [data-component="<id>"], or :root (for custom properties only). Never write a bare class or element selector — not .u-card, not .u-card-interactive:hover, not .t-kicker, not h2 — and never invent a new utility class. The composition utilities named in the TOKEN CONTRACT (.u-card, .u-card-interactive, .u-frame, .u-icon-square, .t-display, .t-h1…, .t-kicker, etc.) already exist in theme.css — reference them in markup if the block catalog does so, but do NOT write a rule whose selector IS one of them; style the effect you want through the scoped [data-block]/[data-component] selector instead.
- No CSS escapes (backslashes, \\) anywhere in the output — not in a selector, not in a content string, not in a property value. If you need a literal character, use the plain character itself.
- Limits: css.global ≤ 16 KB / 400 lines; each block ≤ 4 KB / 60 lines; at most 5 !important in total.
- Allowed at-rules: @media, @supports, @container, and @keyframes named c5-*. Animation only inside @media (prefers-reduced-motion: no-preference): duration ≤ 2s, delay ≤ 1s, iteration count 1; no infinite, steps(), var() or forwards/backwards/both fill modes; only cubic-bezier()/linear() functions (and view()/scroll() timelines).
- Forbidden (the sanitizer rejects the whole concept): @import, @apply, @theme, @font-face, @layer; ~ or + combinators; display:none; visibility:hidden/collapse; content-visibility:hidden; zoom; scale below 0.2; opacity below 0.2 or not a plain number; filter/backdrop-filter opacity(); pointer-events:none except on a ::before/::after pseudo-element, and var() in pointer-events; text colour that is transparent, color-mix(), relative (from …) or alpha below 0.2; content other than "", none or counter(); quoted list-style markers; font-size other than a px/rem/em length ≥ 12px / 0.75rem, a % ≥ 75, var(), clamp() with such a minimum, or a keyword (no calc(), min(), max() or vw); z-index above 50 or not a plain integer; position sticky/fixed except on the navbar; the font shorthand; theme(), --spacing(), --alpha(), image(), image-set(), src(); url() except a small inline data:image/svg+xml; viewport units (vw, vh, vmin, vmax) in a horizontal offset (left, right, inset, inset-inline, margin, margin-inline), in a horizontal translate (translateX(), translate()'s first value, the translate property), or in width / min-width / padding-inline / padding-left / padding-right outside min() / clamp(); a negative horizontal offset or margin (left, right, inset-inline, margin-left / right / inline) or text-indent beyond -200px / -12.5rem / -50% — vertical negative margins stay allowed (a full-bleed band is a box-shadow spread or clip-path, which never widen the page).
- Prefer the colour variables over raw hex inside CSS.`

function outputFormat(caps: DesignCapabilities): string {
  const style = (styleAxesUnlocked(caps) ? ',"style":{"cards":"…"}' : '') + (layoutPresetsUnlocked(caps) ? ',"layout":{"cards":"…"}' : '')
  return `OUTPUT FORMAT
Return ONLY this JSON (no prose, no markdown fences):
{"concepts":[{"name":"…","tagline":"…","rationale":"…","moves":["…"],"palette":{"primary":"#…","secondary":"#…","complementary":"#…","action":"#…","nearBlack":"#…","nearWhite":"#…"},"typography":{"headingFont":"…","bodyFont":"…","accentFont":"…"},"tokens":{"roundness":"…","density":"…","visualFeel":"…","spacing":{"xs":"…","sm":"…","md":"…","lg":"…","xl":"…","2xl":"…"},"radius":{"none":"…","sm":"…","md":"…","lg":"…","pill":"…"}},"treatments":{"headlineStyle":"…","eyebrowStyle":"…","darkSections":false}${style},"css":{"global":"…","blocks":{"hero":"…"}}}]}
name ≤ 60 chars, tagline ≤ 160, rationale ≤ 2000, at most 6 moves of ≤ 200 chars each.`
}

export function buildContract(caps: DesignCapabilities): string {
  return [
    TOKEN_CONTRACT,
    leversSection(caps),
    ...(layoutPresetsUnlocked(caps) ? [LAYOUT_PRESETS_EXCEPTION] : []),
    CSS_RULES_SECTION,
    outputFormat(caps),
  ].join('\n\n')
}

// One-line restatement of the two rules concepts most often break (Concept-3
// lesson, P3 E2E). The concept task, the critic and the revise prompt all
// import THIS — never copy the wording.
export const CSS_RULES_REMINDER =
  'CSS reminder: every selector must START with [data-block="<id>"], [data-component="<id>"] or :root (custom properties only) — never a bare class or element selector — and the CSS must contain no backslashes (no CSS escapes).'
