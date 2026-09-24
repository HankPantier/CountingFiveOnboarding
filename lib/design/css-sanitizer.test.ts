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

// Regression tests for task-3-findings-r1.md (task review round 1) — every
// bypass the review found accepted must now be rejected (or, for the forged
// comment-in-raws case, accepted but stripped so the marker can't survive).
describe('sanitizeDesignCss — round 1 findings (bypasses closed)', () => {
  it.each([
    ['comment hiding in a declaration raw', '[data-block="hero"] { color: red /* /theme-editor:hero */; }', '/theme-editor:hero'],
    ['comment hiding in a selector raw', '[data-block="hero"] /* theme-editor:faq-accordion */ h1 { color: red; }', 'theme-editor:faq-accordion'],
    ['comment hiding in an at-rule raw', '@media /* theme-editor:faq-accordion */ (min-width:1px) { [data-block="hero"] { color: red; } }', 'theme-editor:faq-accordion'],
  ])('strips a forged managed-region marker hidden in raws: %s', (_label, css, marker) => {
    const out = ok(css)
    expect(out).not.toContain(marker)
    expect(out).not.toContain('/*')
    expect(out).not.toContain('*/')
  })

  it.each([
    ['top-level sibling combinator (~)', '[data-block="hero"] ~ [data-block="faq-accordion"] { color: red; }'],
    ['nested sibling combinator (~)', '[data-block="hero"] { & ~ * { color: red; } }'],
    ['top-level adjacent-sibling combinator (+)', '[data-block="hero"] + [data-block="faq-accordion"] { color: red; }'],
  ])('rejects the ~ / + combinator: %s', (_label, css) => {
    expect(errs(css)).toMatch(/combinator/i)
  })

  it('rejects a nested rule under :root even in global scope', () => {
    expect(errs(':root { h1, body { color: red; } }', GLOBAL)).toMatch(/root/i)
  })

  it.each([
    ['display none via escaped n', 'display: n\\one'],
    ['display property name escaped', 'displ\\ay: none'],
    ['position fixed via escape', 'position: fix\\ed'],
    ['escaped url() bypass', 'background-image: \\75 rl(https://evil.test/x.png)'],
  ])('rejects any backslash escape: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toContain('escapes')
  })

  it.each([
    ['unitless zero', 'font-size: 0'],
    ['unitless number', 'font-size: 10'],
    ['calc()', 'font-size: calc(1px)'],
  ])('rejects a font-size hiding bypass: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/not allowed/i)
  })

  it('rejects a font-size percentage below 75%', () => {
    expect(errs('[data-block="hero"] { font-size: 50%; }')).toMatch(/too small/i)
  })

  it('accepts font-size keywords/functions it cannot statically evaluate', () => {
    ok('[data-block="hero"] { font-size: clamp(1rem, 2vw, 3rem); }')
    ok('[data-block="hero"] { font-size: var(--x); }')
    ok('[data-block="hero"] { font-size: 100%; }')
  })

  it('rejects opacity set via calc()/var() outside keyframes', () => {
    expect(errs('[data-block="hero"] { opacity: calc(0); }')).toMatch(/plain number or percentage/i)
    expect(errs('[data-block="hero"] { opacity: var(--x); }')).toMatch(/plain number or percentage/i)
  })

  it.each([
    ['modern rgb zero alpha', 'color: rgb(0 0 0 / 0)'],
    ['modern hsl zero alpha percent', 'color: hsl(200 50% 50% / 0%)'],
    ['legacy rgba zero alpha', 'color: rgba(0,0,0,0)'],
    ['legacy hsla zero alpha', 'color: hsla(0,0%,0%,0)'],
    ['webkit text fill color zero alpha', '-webkit-text-fill-color: rgba(0,0,0,0)'],
  ])('rejects a zero-alpha color hiding trick: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/hides text/i)
  })

  it('accepts a fully-opaque color (not a false positive)', () => {
    ok('[data-block="hero"] { color: rgb(0 0 0 / 100%); }')
    ok('[data-block="hero"] { color: rgba(10, 20, 30, 1); }')
  })

  it('rejects animation forwards/both fill modes (can hide content permanently)', () => {
    expect(
      errs(
        '@keyframes c5-h { to { opacity: 0; } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h 1ms forwards; } }'
      )
    ).toContain('fill mode')
    expect(errs('[data-block="hero"] { animation-fill-mode: both; }')).toContain('fill mode')
  })

  it('rejects content unless the whole value is a plain literal or counter()', () => {
    expect(errs('[data-block="hero"] { content: counter(x) "Call now 555"; }')).toContain('content')
  })

  it('accepts a bare counter() content value', () => {
    ok('[data-block="hero"] { content: counter(x); }')
  })

  it('rejects injected text via list-style / list-style-type', () => {
    expect(errs('[data-block="hero"] { list-style-type: "CALL NOW "; }')).toMatch(/list marker/i)
    expect(errs('[data-block="hero"] { list-style: "CALL NOW "; }')).toMatch(/list marker/i)
  })

  it.each([
    ['image-set()', 'background-image: image-set("https://evil.test/x.png" 1x)'],
    ['-webkit-image-set()', 'background-image: -webkit-image-set("https://evil.test/x.png" 1x)'],
    ['src()', 'background: src("https://evil.test/x.png")'],
    ['image()', 'background: image("https://evil.test/x.png")'],
  ])('rejects the remote-fetch function %s even without url()', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/remote fetch/i)
  })

  it.each([
    ['theme() in a declaration value', 'color: theme(--color-nope)'],
    ['--theme() in a declaration value', 'color: --theme(--color-nope)'],
    ['--spacing() in a declaration value', 'margin: --spacing(4)'],
    ['--alpha() in a declaration value', 'color: --alpha(red 50%)'],
  ])('rejects the Tailwind-only function: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/tailwind-only/i)
  })

  it('rejects theme()/--spacing()/--alpha() in at-rule params too', () => {
    expect(errs('@media (min-width: theme(--breakpoint-sm)) { [data-block="hero"] { color: red; } }')).toMatch(/tailwind-only/i)
  })

  it('rejects a reduced-motion gate with `not` or a comma (always-true escape)', () => {
    expect(errs('@media not (prefers-reduced-motion: no-preference) { [data-block="hero"] h1 { animation: c5-r 1s; } }')).toContain(
      'prefers-reduced-motion'
    )
    expect(
      errs(
        '@media (prefers-reduced-motion: no-preference), (max-width: 10px) { [data-block="hero"] h1 { animation: c5-r 1s; } }'
      )
    ).toContain('prefers-reduced-motion')
  })

  it('accepts a nested @media inside a rule (declaration has an ancestor rule, just not a direct parent)', () => {
    const out = ok('[data-block="hero"] { @media (min-width: 768px) { color: red; } }')
    expect(out).toContain('color: red')
  })

  it('accepts animation: none / animation-name: none without a reduced-motion gate', () => {
    ok('[data-block="hero"] { animation-name: none; }')
    ok('[data-block="hero"] { animation: none; }')
  })

  it('names only the matching attribute in the "must be scoped to" clause (not both)', () => {
    const blockErr = errs('[data-component="hero"] { color: red; }', HERO)
    const blockScopedTo = blockErr.split('must be scoped to')[1]
    expect(blockScopedTo).toContain('[data-block="hero"]')
    expect(blockScopedTo).not.toContain('data-component')

    const componentErr = errs('[data-block="navbar"] { color: red; }', { kind: 'target', target: 'navbar' })
    const componentScopedTo = componentErr.split('must be scoped to')[1]
    expect(componentScopedTo).toContain('[data-component="navbar"]')
    expect(componentScopedTo).not.toContain('data-block')
  })

  it('rejects [data-block="navbar"] even though "navbar" matches the scope target string', () => {
    expect(errs('[data-block="navbar"] { color: red; }', { kind: 'target', target: 'navbar' })).toMatch(/selector/i)
  })

  it('rejects a non-from/to/percentage keyframe step selector', () => {
    expect(errs('@keyframes c5-x { 0% { opacity: 0; } foo { opacity: 1; } }')).toMatch(/keyframe selector/i)
  })

  it('accepts a comma-separated percentage list keyframe step', () => {
    ok(
      '@keyframes c5-p { 0%, 50% { opacity: .5; } 100% { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-p 1s; } }'
    )
  })
})

// Regression tests for task-3-findings-r2.md (task review round 2) — remaining
// bypass variants plus one regression from round 1's nested-@media relaxation.
describe('sanitizeDesignCss — round 2 findings (bypasses closed)', () => {
  it.each([
    ['mixed with a block selector', '[data-block="hero"], :root { h1 { color: red; } }'],
    ['mixed with itself twice', ':root, :root { --c5-x: 1px; }'],
  ])(':root must be the only selector in its rule — %s', (_label, css) => {
    expect(errs(css, GLOBAL)).toMatch(/:root must be the only selector/i)
  })

  it.each([
    ['nested @media', ':root { @media (min-width:0) { color: red; --color-primary: red; } }'],
    ['nested @supports', ':root { @supports (display:grid) { --color-primary: red; } }'],
  ])(':root may not contain a nested at-rule — %s', (_label, css) => {
    expect(errs(css, GLOBAL)).toMatch(/no nested rules or at-rules/i)
  })

  it('still accepts a plain :root with only direct custom-property declarations', () => {
    ok(':root { --c5-x: 1px; --shadow-card: 0 8px 24px rgb(0 59 113 / .12); }', GLOBAL)
  })

  it('still accepts :root nested inside an allowed at-rule, with the same content rules', () => {
    ok('@media (min-width:0) { :root { --c5-x: 1px; } }', GLOBAL)
    expect(errs('@media (min-width:0) { :root { --color-primary: red; } }', GLOBAL)).toContain('--color-primary')
    expect(errs('@media (min-width:0) { :root { @supports (display:grid) { --c5-x: 1px; } } }', GLOBAL)).toMatch(
      /no nested rules or at-rules/i
    )
  })

  it('rejects a target-dependent check (position fixed) that only holds for one selector in a mixed list', () => {
    expect(errs('[data-component="navbar"], [data-block="hero"] { position: fixed; }', GLOBAL)).toMatch(/navbar/i)
  })

  it('still accepts position: fixed when every selector in the list is the navbar', () => {
    ok('[data-component="navbar"], [data-component="navbar"] { position: fixed; }', { kind: 'target', target: 'navbar' })
  })

  it.each([
    ['zero with pt unit', 'font-size: 0pt'],
    ['zero with vw unit', 'font-size: 0vw'],
    ['exponent notation', 'font-size: 1e-9px'],
    ['min()', 'font-size: min(1px, 2px)'],
    ['max()', 'font-size: max(1px, 2px)'],
    ['bare leading dot', 'font-size: .5rem'],
    ['smaller keyword (not on the allow-list)', 'font-size: smaller'],
    ['x-small keyword (not on the allow-list)', 'font-size: x-small'],
    ['xx-small keyword (not on the allow-list)', 'font-size: xx-small'],
    ["clamp() minimum below the px/rem/em floor", 'font-size: clamp(8px, 2vw, 3rem)'],
  ])('rejects a font-size not on the round-2 allow-list: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/not allowed|too small/i)
  })

  it.each(['large', 'x-large', 'xx-large', 'xxx-large', 'larger', 'inherit', 'initial', 'unset', 'revert'])(
    'accepts the allow-listed font-size keyword: %s',
    (kw) => {
      ok(`[data-block="hero"] { font-size: ${kw}; }`)
    }
  )

  it('accepts a clamp() whose minimum meets the px/rem/em floor', () => {
    ok('[data-block="hero"] { font-size: clamp(12px, 2vw, 3rem); }')
  })

  it.each([
    ['negative alpha', 'color: rgb(0 0 0 / -1)'],
    ['calc() alpha', 'color: rgb(0 0 0 / calc(0))'],
    ['oklch zero alpha', 'color: oklch(0 0 0 / 0)'],
    ['hwb zero alpha', 'color: hwb(0 0% 0% / 0)'],
  ])('rejects a colour function with an invalid/zero alpha: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/hides text/i)
  })

  it.each([
    ['4-digit hex, zero alpha nibble', 'color: #f000'],
    ['8-digit hex, zero alpha byte', 'color: #ffffff00'],
  ])('rejects a hex colour with zero alpha: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/hides text/i)
  })

  it('accepts currentcolor and opaque hex forms (no false positives)', () => {
    ok('[data-block="hero"] { color: currentcolor; }')
    ok('[data-block="hero"] { color: #ff0000; }')
    ok('[data-block="hero"] { color: #f00; }')
    ok('[data-block="hero"] { color: #ff000080; }')
  })

  it('rejects the backwards animation fill mode too (in addition to forwards/both)', () => {
    expect(errs('[data-block="hero"] { animation-fill-mode: backwards; }')).toContain('fill mode')
    expect(
      errs(
        '@keyframes c5-h { from { opacity: 0; } to { opacity: 1; } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h 1s 99999s backwards; } }'
      )
    ).toContain('fill mode')
  })

  it('rejects opacity < 0.2 at a keyframe final (to/100%) step, even combined with `from`', () => {
    expect(
      errs(
        '@keyframes c5-h { from, to { opacity: 0; } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h 1s infinite; } }'
      )
    ).toMatch(/final .* step/i)
  })

  it('rejects visibility hidden/collapse at a keyframe final (to/100%) step', () => {
    expect(
      errs(
        '@keyframes c5-h { to { visibility: hidden; } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h 1s; } }'
      )
    ).toMatch(/final .* step/i)
  })

  it('still accepts a `from { opacity: 0 }` entrance animation with no matching final-step issue', () => {
    ok(
      '@keyframes c5-e { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-e .3s; } }'
    )
  })

  it('rejects the reduced-motion gate `or` variant (always-true escape)', () => {
    expect(
      errs('@media (prefers-reduced-motion: no-preference) or (min-width: 0px) { [data-block="hero"] h1 { animation: c5-r 1s; } }')
    ).toContain('prefers-reduced-motion')
  })

  it('accepts the reduced-motion gate extended with one or more `and (<feature>)` groups', () => {
    ok(
      '@keyframes c5-f { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) and (min-width: 768px) { [data-block="hero"] { animation: c5-f 1s; } }'
    )
    ok(
      '@keyframes c5-g { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) and (min-width: 768px) and (orientation: landscape) { [data-block="hero"] { animation: c5-g 1s; } }'
    )
  })
})

// Regression tests for task-3-findings-r3.md (task review round 3) — the
// leading-dot alpha regression + clamp nested-comma parsing, structural
// animation limits, colour hiding via nested functions, and two uncovered
// properties.
describe('sanitizeDesignCss — round 3 findings (bypasses closed, regression fixed)', () => {
  it.each([
    ['modern slash syntax', 'color: rgb(0 59 113 / .9)'],
    ['legacy comma syntax', 'color: rgba(0, 0, 0, .5)'],
  ])('accepts a leading-dot alpha (regression fix): %s', (_label, decl) => {
    ok(`[data-block="hero"] { ${decl}; }`)
  })

  it('accepts clamp() whose 2nd argument is itself a multi-arg nested function', () => {
    ok('[data-block="hero"] { font-size: clamp(1rem, min(2vw, 3rem), 4rem); }')
  })

  it('still rejects clamp() with a nested-comma 2nd arg when the minimum is too small', () => {
    expect(errs('[data-block="hero"] { font-size: clamp(8px, min(2vw, 3rem), 4rem); }')).toMatch(/not allowed/i)
  })

  it('accepts the from/to entrance+exit animation with a plain final-step opacity', () => {
    ok(
      '@keyframes c5-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] h1 { animation: c5-rise .6s ease-out; } }'
    )
  })

  it('accepts an animation shorthand with cubic-bezier() timing and a delay', () => {
    ok(
      '@keyframes c5-rise2 { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-rise2 600ms cubic-bezier(.2,.7,.2,1) 100ms; } }'
    )
  })

  it('rejects a `from, 100.0%` combined selector as a final step (parseFloat, not string equality)', () => {
    expect(
      errs(
        '@keyframes c5-h { from, 100.0% { opacity: 0; } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h 1s; } }'
      )
    ).toMatch(/final .* step/i)
  })

  it('rejects a non-plain-number final-step opacity (calc(), not just a too-low number)', () => {
    expect(
      errs(
        '@keyframes c5-h2 { to { opacity: calc(0); } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h2 1s; } }'
      )
    ).toMatch(/plain number or percentage/i)
  })

  it.each([
    ['steps()', 'animation: c5-h 1s steps(1, end)'],
    ['infinite', 'animation: c5-h 1s infinite'],
    ['var()', 'animation: c5-h 1s var(--c5-f)'],
  ])('rejects the structurally-banned animation token: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/steps\(\)|infinite|var\(\)/)
  })

  it('rejects an animation-duration over 2s (via the shorthand)', () => {
    expect(errs('[data-block="hero"] { animation: c5-h 30s; }')).toContain('duration must be')
  })

  it('rejects an animation-delay over 1s (via the shorthand, 2nd time value)', () => {
    expect(errs('[data-block="hero"] { animation: c5-h 1s 5s; }')).toContain('delay must be')
  })

  it('rejects animation-iteration-count set to anything but 1', () => {
    expect(errs('[data-block="hero"] { animation-iteration-count: 3; }')).toContain('must be exactly 1')
  })

  it('rejects a bare iteration-count number in the shorthand other than 1', () => {
    expect(errs('[data-block="hero"] { animation: c5-h .3s 3; }')).toContain('bare number of 1')
  })

  it('does not misidentify a number inside cubic-bezier() as a bare iteration count', () => {
    ok(
      '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-h .3s cubic-bezier(.2,.7,.2,1); } }'
    )
  })

  it.each([
    ['color-mix()', 'color: color-mix(in srgb, red 0%, transparent)'],
    ['relative-colour syntax', 'color: rgb(from var(--c) r g b / 0)'],
  ])('rejects colour hiding via nested functions: %s', (_label, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/hides text/i)
  })

  it('rejects the font shorthand entirely', () => {
    expect(errs('[data-block="hero"] { font: 16px/1.5 sans-serif; }')).toMatch(/longhands/i)
  })

  it('treats -webkit-sticky exactly like sticky (navbar only)', () => {
    ok('[data-component="navbar"] { position: -webkit-sticky; }', { kind: 'target', target: 'navbar' })
    expect(errs('[data-block="hero"] { position: -webkit-sticky; }')).toMatch(/navbar/i)
  })
})

// Round 4: one numeric grammar for every animation value (canonical plain
// numbers only, per-layer duration/delay/iteration limits), plus leading-dot
// acceptance for longhand times and final-step opacity.
describe('sanitizeDesignCss — round 4 findings (animation number forms, per-layer limits)', () => {
  const gated = (decl: string) =>
    `@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { ${decl}; } }`

  it.each([
    ['signed duration', 'animation: c5-h +30s'],
    ['exponent duration', 'animation: c5-h 3e1s'],
    ['exponent iteration count', 'animation: c5-h 1s 1e3'],
    ['signed iteration count', 'animation: c5-h 1s +3'],
    ['leading-dot duration then long delay', 'animation: c5-h .1s 1.5s'],
    ['3rd-layer duration', 'animation: a 1s 0s, b 1s 0s, c 30s'],
  ])('rejects an animation shorthand bypass: %s', (_label, decl) => {
    expect(errs(gated(decl))).toMatch(/animation/i)
  })

  it('rejects a third <time> value in one shorthand layer', () => {
    expect(errs(gated('animation: c5-h 1s 0s 1s'))).toMatch(/time/i)
  })

  it('rejects non-canonical numbers in the longhands too', () => {
    errs(gated('animation-duration: 3e1s'))
    errs(gated('animation-delay: +1s'))
    errs(gated('animation-iteration-count: 1e0'))
    errs(gated('animation-duration: 1s, 30s'))
  })

  it.each([
    ['leading-dot duration', 'animation-duration: .3s'],
    ['leading-dot delay', 'animation-delay: .2s'],
    ['iteration count 1.0', 'animation-iteration-count: 1.0'],
    ['multi-layer shorthand within limits', 'animation: c5-a .6s ease-out .2s, c5-b 1s cubic-bezier(.2,.7,.2,1) 0s 1'],
    ['multi-layer longhands within limits', 'animation-duration: .3s, 2s'],
  ])('accepts: %s', (_label, decl) => {
    ok(gated(decl))
  })

  it('accepts a leading-dot final keyframe step opacity (to { opacity: .9 })', () => {
    ok(
      '@keyframes c5-f9 { from { opacity: 0; } to { opacity: .9; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-f9 .6s; } }'
    )
  })

  it('still rejects a leading-dot final keyframe step opacity below 0.2', () => {
    expect(
      errs(
        '@keyframes c5-f1 { from { opacity: 0; } to { opacity: .1; } }\n' +
          '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] { animation: c5-f1 .6s; } }'
      )
    ).toMatch(/final/i)
  })
})
