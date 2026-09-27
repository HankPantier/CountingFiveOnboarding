// Lint a client's content/design-overrides.css for rules that shadow what the
// template now controls (R4 F9 / I5). Advisory only — never blocks. Pure.

export interface OverridesFinding {
  kind: 'owned-shadow' | 'tailwind-selector' | 'color-literal' | 'important' | 'stale-stub'
  selector?: string
  detail: string
}

export interface OverridesLint {
  lines: number
  colorLiterals: number
  important: number
  tailwindSelectors: number
  ownedShadows: number
  staleStub: boolean
  findings: OverridesFinding[]
}

// Selector + properties the template owns (design.json style presets, the
// action-text tokens, button sizing). Overriding them fights Studio/Controls.
const OWNED: { selector: RegExp; props: RegExp; hint: string }[] = [
  { selector: /\[data-component=["']?footer["']?\]/, props: /^(background|background-color|color)$/, hint: 'footer colours come from design.json style.footer' },
  { selector: /\[data-component=["']?footer["']?\][^,]*\bimg\b/, props: /^filter$/, hint: 'the footer logo treatment follows style.footer' },
  { selector: /\.t-kicker\b/, props: /^color$/, hint: 'use var(--color-action-text)' },
  { selector: /\b(a|button)\.bg-action\b/, props: /^(padding|padding-\w+|height|min-height|border-radius)$/, hint: 'button sizing/radius come from the template + design tokens' },
  { selector: /\[data-c5=["']?headline-accent["']?\]/, props: /^color$/, hint: 'headline accent follows --color-action' },
]

const TAILWIND_CLASS = /\.(?:bg|text|border|p[xytblr]?|m[xytblr]?|w|h|min-h|max-w|flex|grid|gap|rounded|shadow|font|leading|tracking)-[\w\\/[\].-]+/
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/g

export function lintOverrides(css: string | null): OverridesLint {
  const empty: OverridesLint = { lines: 0, colorLiterals: 0, important: 0, tailwindSelectors: 0, ownedShadows: 0, staleStub: false, findings: [] }
  if (!css) return empty
  const findings: OverridesFinding[] = []
  const staleStub = /export-brief|export-design-brief/.test(css)
  if (staleStub) findings.push({ kind: 'stale-stub', detail: 'comment still points at the retired `npm run export-brief`' })
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

  let colorLiterals = 0
  let important = 0
  let tailwindSelectors = 0
  let ownedShadows = 0
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    if (selector.startsWith('@')) continue
    const body = m[2]
    if (TAILWIND_CLASS.test(selector) || /\[class\*=/.test(selector)) {
      tailwindSelectors++
      findings.push({ kind: 'tailwind-selector', selector, detail: 'keyed on a Tailwind class name — breaks silently when the template renames classes' })
    }
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const prop = decl.slice(0, i).trim().toLowerCase()
      const value = decl.slice(i + 1)
      if (prop.startsWith('--')) continue
      const lits = value.match(COLOR_LITERAL)?.length ?? 0
      if (lits) {
        colorLiterals += lits
        findings.push({ kind: 'color-literal', selector, detail: `${prop}: ${value.trim()} — won't follow a palette change` })
      }
      if (/!important/i.test(value)) important++
      for (const o of OWNED) {
        if (o.selector.test(selector) && o.props.test(prop)) {
          ownedShadows++
          findings.push({ kind: 'owned-shadow', selector, detail: `${prop} — ${o.hint}` })
        }
      }
    }
  }
  if (important) findings.push({ kind: 'important', detail: `${important} !important declaration(s)` })
  return { lines: css.split('\n').length, colorLiterals, important, tailwindSelectors, ownedShadows, staleStub, findings }
}
