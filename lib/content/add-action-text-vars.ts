import { deriveActionTextColors, type ActionTextColors } from './theme-css-generator'

// Rollout helper for template 2026.09.4 (small-text action colour). Inserts
// ONLY the --color-action-text / --color-action-on-primary lines into a client's
// EXISTING src/styles/theme.css, computed from the palette values that file
// already carries — never regenerating the rest, because regenerating from
// brand.json would also sync a stale palette (e.g. bblcpa's theme.css lags its
// brand.json) and visibly change the site. The inserted lines (and comments)
// are byte-identical to what generateThemeCss emits, so a later full
// regeneration doesn't move them. Idempotent: a file that already has the
// tokens is returned unchanged. Pure; never throws (errors are returned).

export type AddActionTextVarsResult =
  | { status: 'added'; css: string; colors: ActionTextColors; darkBlock: boolean }
  | { status: 'unchanged'; css: string }
  | { status: 'error'; error: string }

const HEX = /^#[0-9a-fA-F]{6}$/

function token(css: string, name: string): string | null {
  const m = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'))
  return m ? m[1].trim() : null
}

const LIGHT_ANCHOR = /^( *)--color-action-foreground: [^;\n]+;\n/gm

export function addActionTextVars(css: string): AddActionTextVarsResult {
  if (/--color-action-text\s*:/.test(css) || /--color-action-on-primary\s*:/.test(css)) {
    return { status: 'unchanged', css }
  }
  const values = {
    action: token(css, '--color-action'),
    primary: token(css, '--color-primary-hex'),
    nearWhite: token(css, '--color-near-white'),
    nearBlack: token(css, '--color-near-black'),
  }
  for (const [role, v] of Object.entries(values)) {
    if (!v || !HEX.test(v)) return { status: 'error', error: `theme.css has no #rrggbb value for palette.${role}` }
  }
  const palette = values as { action: string; primary: string; nearWhite: string; nearBlack: string }
  const colors = deriveActionTextColors(palette)

  const anchors = css.match(LIGHT_ANCHOR)
  if (!anchors || anchors.length === 0) return { status: 'error', error: 'theme.css has no --color-action-foreground line to anchor on' }

  let out = css.replace(
    LIGHT_ANCHOR,
    (line, indent: string) =>
      `${line}${indent}/* Action colour for SMALL text, AA-corrected (lightness only) against the\n` +
      `${indent} * page background / the primary surface. Equal to --color-action when the\n` +
      `${indent} * raw colour already passes. */\n` +
      `${indent}--color-action-text: ${colors.actionText};\n` +
      `${indent}--color-action-on-primary: ${colors.actionOnPrimary};\n`
  )

  // The .dark block (absent in pre-dark-mode theme.css files): append before its
  // closing brace, matching the generator's placement (last declarations).
  const dark = out.match(/^\.dark \{\n[\s\S]*?^\}/m)
  let darkBlock = false
  if (dark && dark.index !== undefined) {
    const block = dark[0]
    const patched = block.replace(
      /\n\}$/,
      `\n  /* Small action text re-corrected for the dark neutral surfaces. */\n  --color-action-text: ${colors.darkActionText};\n}`
    )
    out = out.slice(0, dark.index) + patched + out.slice(dark.index + block.length)
    darkBlock = true
  }
  return { status: 'added', css: out, colors, darkBlock }
}
