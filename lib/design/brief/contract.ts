// Pure. The capability-filtered token + selector + output contract (ported
// from export-design-brief's design-system.md, plus the sanitizer's rules so
// the model writes CSS that passes). Byte-stable per capability tier: it may
// depend on `caps` ONLY through fontsUnlocked().
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import { CHROME_COMPONENTS, CSS_TARGETS, TREATMENT_STATE_ATTRS } from '../css-targets'
import { fontsUnlocked } from '../capabilities'
import type { DesignCapabilities } from '../run-types'

export const TOKEN_CONTRACT = `TOKEN CONTRACT (theme.css is regenerated from your palette + tokens; never restate it)
- Colour variables: --color-primary(-foreground), --color-secondary(-foreground), --color-accent(-foreground) (from complementary), --color-background, --color-foreground, --color-muted(-foreground), --color-card(-foreground), --color-border, --color-input, --color-ring (from action), --color-action / --color-action-foreground, --color-primary-hex, --color-near-black, --color-near-white, --color-complementary.
- Spacing --c5-space-xs … --c5-space-2xl; radius --radius-sm/md/lg/pill and --radius; fonts --font-heading, --font-body, --font-accent.
- Type scale --type-display, --type-h1 … --type-h4, --type-body-lg, --type-small, --type-caption, --tracking-display, --tracking-tight; utilities .t-display, .t-h1 … .t-h4, .t-body-lg, .t-small, .t-kicker.
- Composition utilities: .font-accent, .u-card, .u-card-interactive, .u-frame, .u-icon-square; motion/overlay tokens --duration-base, --overlay-soft, --overlay-medium.
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
- Never emit a "style" field (style axes are not available to you).`
}

export const CSS_RULES_SECTION = `CSS RULES (enforced by a strict sanitizer — a violating concept is rejected)
- Block targets: ${CSS_TARGETS.filter((t) => !(CHROME_COMPONENTS as readonly string[]).includes(t)).join(', ')} (selector [data-block="<id>"]); chrome targets: ${CHROME_COMPONENTS.join(', ')} (selector [data-component="<id>"]).
- css.blocks.<id> may ONLY contain selectors that start with that target's own attribute selector, optionally prefixed by an html state: html[${TREATMENT_STATE_ATTRS.join(']/html[')}] (values: data-headline="sans|serif", data-eyebrow="standard|mono").
- css.global may target any of the above, plus :root custom properties named --c5-*, --type-*, --tracking-*, --shadow-*, --overlay-*, --duration-* (never --color-* or --font-*).
- EVERY selector, in css.global and every css.blocks.<id> alike, MUST START with one of those scopes: [data-block="<id>"], [data-component="<id>"], or :root (for custom properties only). Never write a bare class or element selector — not .u-card, not .u-card-interactive:hover, not .t-kicker, not h2 — and never invent a new utility class. The composition utilities named in the TOKEN CONTRACT (.u-card, .u-card-interactive, .u-frame, .u-icon-square, .t-display, .t-h1…, .t-kicker, etc.) already exist in theme.css — reference them in markup if the block catalog does so, but do NOT write a rule whose selector IS one of them; style the effect you want through the scoped [data-block]/[data-component] selector instead.
- No CSS escapes (backslashes, \\) anywhere in the output — not in a selector, not in a content string, not in a property value. If you need a literal character, use the plain character itself.
- Limits: css.global ≤ 16 KB / 400 lines; each block ≤ 4 KB / 60 lines; at most 5 !important in total.
- Allowed at-rules: @media, @supports, @container, and @keyframes named c5-* used only inside @media (prefers-reduced-motion: no-preference), ≤ 2s, no infinite or fill modes.
- Forbidden: @import, @apply, @theme, @font-face, @layer; ~ or + combinators; display:none, visibility:hidden, opacity < 0.2, transparent text, content text; font-size below 12px; position sticky/fixed except on the navbar; the font shorthand; color-mix(); theme(); url() except a small inline data:image/svg+xml.
- Prefer the colour variables over raw hex inside CSS.`

const OUTPUT_FORMAT = `OUTPUT FORMAT
Return ONLY this JSON (no prose, no markdown fences):
{"concepts":[{"name":"…","tagline":"…","rationale":"…","moves":["…"],"palette":{"primary":"#…","secondary":"#…","complementary":"#…","action":"#…","nearBlack":"#…","nearWhite":"#…"},"typography":{"headingFont":"…","bodyFont":"…","accentFont":"…"},"tokens":{"roundness":"…","density":"…","visualFeel":"…","spacing":{"xs":"…","sm":"…","md":"…","lg":"…","xl":"…","2xl":"…"},"radius":{"none":"…","sm":"…","md":"…","lg":"…","pill":"…"}},"treatments":{"headlineStyle":"…","eyebrowStyle":"…","darkSections":false},"css":{"global":"…","blocks":{"hero":"…"}}}]}
name ≤ 60 chars, tagline ≤ 160, rationale ≤ 2000, at most 6 moves of ≤ 200 chars each.`

export function buildContract(caps: DesignCapabilities): string {
  return [TOKEN_CONTRACT, leversSection(caps), CSS_RULES_SECTION, OUTPUT_FORMAT].join('\n\n')
}

// One-line restatement of the two rules concepts most often break (Concept-3
// lesson, P3 E2E). The concept task, the critic and the revise prompt all
// import THIS — never copy the wording.
export const CSS_RULES_REMINDER =
  'CSS reminder: every selector must START with [data-block="<id>"], [data-component="<id>"] or :root (custom properties only) — never a bare class or element selector — and the CSS must contain no backslashes (no CSS escapes).'
