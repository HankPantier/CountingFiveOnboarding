import { describe, it, expect } from 'vitest'
import { sanitizeDesignCss, type CssScope } from './css-sanitizer'

const HERO: CssScope = { kind: 'target', target: 'hero' }
const GLOBAL: CssScope = { kind: 'global' }

function ok(css: string, scope: CssScope = HERO): string {
  const r = sanitizeDesignCss(css, scope)
  if (!r.ok) throw new Error(`expected ok, got: ${r.errors.join(' | ')}`)
  return r.css
}
function errs(css: string, scope: CssScope = HERO): string {
  const r = sanitizeDesignCss(css, scope)
  if (r.ok) throw new Error(`expected rejection, got: ${r.css}`)
  return r.errors.join(' | ')
}

describe('sanitizeDesignCss — accepts', () => {
  it('a rule scoped to the target block', () => {
    expect(ok('[data-block="hero"] h1 { font-size: 3.5rem; }')).toContain('[data-block="hero"] h1')
  })
  it('a treatment-state prefix on html', () => {
    ok('html[data-headline="serif"] [data-block="hero"] h1 { letter-spacing: -0.02em; }')
  })
  it('@media / @supports / @container wrapping scoped rules', () => {
    ok('@media (min-width: 768px) { [data-block="hero"] { padding-block: 6rem; } }')
    ok('@supports (display: grid) { [data-block="hero"] { display: grid; } }')
  })
  it('nested rules under a scoped parent', () => {
    ok('[data-block="hero"] { & h1 { color: var(--color-primary); } }')
  })
  it('c5- keyframes plus an animation gated on reduced motion', () => {
    ok(
      '@keyframes c5-rise { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] h1 { animation: c5-rise .6s ease-out; } }'
    )
  })
  it('a small inline svg data url', () => {
    ok(`[data-block="hero"] { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"); }`)
  })
  it('global scope: several targets and :root custom properties', () => {
    ok(
      ':root { --c5-section-gap: 5rem; --shadow-card: 0 8px 24px rgb(0 59 113 / .12); }\n' +
        '[data-block="feature-grid"] h3 { font-weight: 600; }\n' +
        '[data-component="footer"] { border-top: 1px solid var(--color-border); }',
      GLOBAL
    )
  })
  it('a chrome component target', () => {
    ok('[data-component="navbar"] { position: sticky; top: 0; }', { kind: 'target', target: 'navbar' })
  })
  it('strips comments so managed-region markers cannot be forged', () => {
    const css = ok('/* design-studio:end */ [data-block="hero"] { color: red; }')
    expect(css).not.toContain('design-studio')
  })
})

describe('sanitizeDesignCss — rejects', () => {
  it.each([
    ['@import', '@import url("x.css");', '@import'],
    ['@apply', '[data-block="hero"] { @apply text-lg; }', '@apply'],
    ['@theme', '@theme { --color-x: red; }', '@theme'],
    ['@tailwind', '@tailwind utilities;', '@tailwind'],
    ['@layer', '@layer base { [data-block="hero"] { color: red; } }', '@layer'],
    ['@font-face', '@font-face { font-family: x; src: local(x); }', '@font-face'],
    ['non-c5 keyframes', '@keyframes spin { to { opacity: 1; } }', 'c5-'],
  ])('banned at-rule: %s', (_n, css, needle) => {
    expect(errs(css)).toContain(needle)
  })

  it.each([
    ['unscoped tag', 'h1 { color: red; }'],
    ['body', 'body { color: red; }'],
    ['universal', '* { color: red; }'],
    ['other block', '[data-block="faq-accordion"] { color: red; }'],
    ['unknown html attr', 'html[data-foo="x"] [data-block="hero"] { color: red; }'],
    ['html alone', 'html[data-headline="serif"] { color: red; }'],
    [':root in target scope', ':root { --c5-x: 1px; }'],
  ])('bad selector: %s', (_n, css) => {
    expect(errs(css)).toMatch(/selector/i)
  })

  it('rejects an unknown block even in global scope', () => {
    expect(errs('[data-block="nope"] { color: red; }', GLOBAL)).toMatch(/selector/i)
  })

  it('rejects :root properties outside the allowed custom-property prefixes', () => {
    expect(errs(':root { --color-primary: red; }', GLOBAL)).toContain('--color-primary')
    expect(errs(':root { color: red; }', GLOBAL)).toContain(':root')
  })

  it.each([
    ['display none', 'display: none'],
    ['visibility hidden', 'visibility: hidden'],
    ['low opacity', 'opacity: 0.1'],
    ['content injection', 'content: "Call now"'],
    ['fixed position', 'position: fixed'],
    ['transparent text', 'color: transparent'],
    ['tiny font px', 'font-size: 10px'],
    ['tiny font rem', 'font-size: 0.6rem'],
    ['huge z-index', 'z-index: 999'],
    ['pointer-events', 'pointer-events: none'],
    ['behavior', 'behavior: url(x.htc)'],
    ['expression', 'width: expression(alert(1))'],
  ])('hiding / injection declaration: %s', (_n, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/not allowed|too small|too high/i)
  })

  it.each([
    ['remote url', 'url("https://evil.test/x.png")'],
    ['relative url', 'url(/img/x.png)'],
    ['svg with script', `url("data:image/svg+xml,%3Csvg%3E%3Cscript%3E%3C/script%3E%3C/svg%3E")`],
    ['png data url', 'url("data:image/png;base64,AAAA")'],
  ])('bad url(): %s', (_n, u) => {
    expect(errs(`[data-block="hero"] { background-image: ${u}; }`)).toContain('url(')
  })

  it('rejects an animation not gated on prefers-reduced-motion', () => {
    expect(errs('[data-block="hero"] { animation: c5-rise 1s; }')).toContain('prefers-reduced-motion')
  })

  it('rejects more than 5 !important', () => {
    const decls = Array.from({ length: 6 }, (_, i) => `margin-top: ${i}px !important;`).join(' ')
    expect(errs(`[data-block="hero"] { ${decls} }`)).toContain('!important')
  })

  it('rejects a target fragment over 60 lines', () => {
    const decls = Array.from({ length: 70 }, (_, i) => `  --c5-x${i}: ${i}px;`).join('\n')
    expect(errs(`[data-block="hero"] {\n${decls}\n}`)).toContain('lines')
  })

  it('rejects markup', () => {
    expect(errs('[data-block="hero"] { color: red; } </style><script>')).toMatch(/markup/i)
  })

  it('rejects CSS that does not parse', () => {
    expect(errs('[data-block="hero"] { color: red;')).toMatch(/parse/i)
    expect(errs('[data-block="hero" h1 { color: red; }')).toMatch(/parse|selector/i)
  })

  it('rejects empty input', () => {
    expect(errs('   ')).toMatch(/empty/i)
  })
})
