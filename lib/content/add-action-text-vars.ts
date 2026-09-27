import {
  deriveDarkActionTextTokens,
  deriveLightActionTextTokens,
  hslTokensToHex,
  type DarkActionTextTokens,
  type LightActionTextTokens,
} from './theme-css-generator'

// Rollout helper for template 2026.09.4 (small-text action colour). Inserts
// ONLY the action-text token lines into a client's EXISTING
// src/styles/theme.css — never regenerating the rest, because regenerating
// from brand.json would also sync a stale palette (e.g. bblcpa's theme.css
// lags its brand.json) and visibly change the site.
//
// The tokens are computed from the surfaces THAT FILE actually renders: its
// own --color-background / --color-muted / --color-card / --color-primary
// hsl() lines (and --color-ink, else --color-near-black, for Section ink), and
// the .dark block's background / muted / card — not re-derived from palette
// hexes with today's ensureContrast, which may not be what produced the file.
// For a file the current generator produced, the result is byte-identical to
// generateThemeCss. Idempotent; pure; never throws (errors are returned).

export type AddActionTextVarsResult =
  | { status: 'added'; css: string; light: LightActionTextTokens; dark: DarkActionTextTokens | null }
  | { status: 'unchanged'; css: string }
  | { status: 'error'; error: string }

const HEX = /^#[0-9a-fA-F]{6}$/

function rawToken(block: string, name: string): string | null {
  const m = block.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'))
  return m ? m[1].trim() : null
}

// A token's painted colour: a #rrggbb as-is, an hsl(h s% l%) via the same
// 8-bit conversion the generator uses.
function paintedToken(block: string, name: string): string | null {
  const v = rawToken(block, name)
  if (!v) return null
  if (HEX.test(v)) return v
  if (/^hsl\(/.test(v)) {
    try {
      return hslTokensToHex(v)
    } catch {
      return null
    }
  }
  return null
}

const LIGHT_ANCHOR = /^( *)--color-action-foreground: [^;\n]+;\n/gm
const DARK_BLOCK = /^\.dark \{\n[\s\S]*?^\}/m

export function addActionTextVars(css: string): AddActionTextVarsResult {
  if (/--color-action-text-canvas\s*:/.test(css)) return { status: 'unchanged', css }
  if (/--color-action-(text|on-primary|on-ink|text-tint)\s*:/.test(css)) {
    return { status: 'error', error: 'theme.css has a partial action-text token set — remove it or regenerate before patching' }
  }

  const darkMatch = css.match(DARK_BLOCK)
  // Light-mode values come from the first definition (the @theme block — :root
  // repeats the same values), never from .dark.
  const lightCss = darkMatch && darkMatch.index !== undefined ? css.slice(0, darkMatch.index) : css

  const action = rawToken(lightCss, '--color-action')
  if (!action || !HEX.test(action)) return { status: 'error', error: 'theme.css has no #rrggbb --color-action' }

  const lightNames = { background: '--color-background', muted: '--color-muted', card: '--color-card', primary: '--color-primary' } as const
  const lightSurfaces: Record<string, string> = {}
  for (const [key, name] of Object.entries(lightNames)) {
    const v = paintedToken(lightCss, name)
    if (!v) return { status: 'error', error: `theme.css has no readable ${name} (hsl() or #rrggbb)` }
    lightSurfaces[key] = v
  }
  // Section bg="ink" paints var(--color-ink, var(--color-near-black)).
  const ink = paintedToken(lightCss, '--color-ink') ?? paintedToken(lightCss, '--color-near-black')
  if (!ink) return { status: 'error', error: 'theme.css has no readable --color-ink or --color-near-black' }

  const light = deriveLightActionTextTokens(action, {
    background: lightSurfaces.background,
    muted: lightSurfaces.muted,
    card: lightSurfaces.card,
    primary: lightSurfaces.primary,
    ink,
  })

  const anchors = css.match(LIGHT_ANCHOR)
  if (!anchors || anchors.length === 0) return { status: 'error', error: 'theme.css has no --color-action-foreground line to anchor on' }

  let dark: DarkActionTextTokens | null = null
  if (darkMatch) {
    const d = { background: paintedToken(darkMatch[0], '--color-background'), muted: paintedToken(darkMatch[0], '--color-muted'), card: paintedToken(darkMatch[0], '--color-card') }
    if (!d.background || !d.muted || !d.card) return { status: 'error', error: 'theme.css .dark block lacks readable background / muted / card' }
    dark = deriveDarkActionTextTokens(action, { background: d.background, muted: d.muted, card: d.card })
  }

  let out = css.replace(
    LIGHT_ANCHOR,
    (line, indent: string) =>
      `${line}${indent}/* Action colour for SMALL text, AA-corrected (lightness only) against the\n` +
      `${indent} * rendered surfaces it sits on: -text on the canvas (background, muted,\n` +
      `${indent} * card), -text-tint on the 10-15% action-tint badges, -on-primary / -on-ink\n` +
      `${indent} * in those sections (globals.css re-scopes -text there; -text-canvas keeps\n` +
      `${indent} * the canvas value for light cards inside them). Each equals --color-action\n` +
      `${indent} * when the raw colour already passes. */\n` +
      `${indent}--color-action-text: ${light.actionText};\n` +
      `${indent}--color-action-text-canvas: ${light.actionText};\n` +
      `${indent}--color-action-text-tint: ${light.actionTextTint};\n` +
      `${indent}--color-action-on-primary: ${light.actionOnPrimary};\n` +
      `${indent}--color-action-on-ink: ${light.actionOnInk};\n`
  )

  if (dark) {
    const m = out.match(DARK_BLOCK)!
    const patched = m[0].replace(
      /\n\}$/,
      `\n  /* Small action text re-corrected for the dark neutral surfaces. */\n` +
        `  --color-action-text: ${dark.actionText};\n` +
        `  --color-action-text-canvas: ${dark.actionText};\n` +
        `  --color-action-text-tint: ${dark.actionTextTint};\n}`
    )
    out = out.slice(0, m.index) + patched + out.slice(m.index! + m[0].length)
  }
  return { status: 'added', css: out, light, dark }
}
