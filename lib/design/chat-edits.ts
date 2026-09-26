// Pure + client-safe. What the design chat's edit tools do to a bundle —
// shallow, typed patches only. Validation (zod, capability tier, sanitizer,
// contrast) is the workspace's job; nothing here decides whether a patch is
// acceptable.
import type { DesignBundle } from './bundle'
import { CSS_TARGETS, type CssTarget } from './css-targets'

export type CssFragmentKey = CssTarget | 'global'
export const CSS_FRAGMENT_KEYS = ['global', ...CSS_TARGETS] as const

export type TokensPatch = {
  roundness?: DesignBundle['tokens']['roundness']
  density?: DesignBundle['tokens']['density']
  visualFeel?: DesignBundle['tokens']['visualFeel']
  spacing?: Partial<DesignBundle['tokens']['spacing']>
  radius?: Partial<DesignBundle['tokens']['radius']>
}

export type ChatEdit =
  | { kind: 'palette'; patch: Partial<DesignBundle['palette']> }
  | { kind: 'fonts'; patch: Partial<DesignBundle['typography']> }
  | { kind: 'tokens'; patch: TokensPatch }
  | { kind: 'treatments'; patch: Partial<DesignBundle['treatments']> }
  | { kind: 'css'; target: CssFragmentKey; css: string }
  | { kind: 'remove-css'; target: CssFragmentKey }

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

function setFragment(css: DesignBundle['css'], target: CssFragmentKey, body: string | null): DesignBundle['css'] {
  const text = body !== null && body.trim() !== '' ? body : null
  if (target === 'global') {
    const { global: _old, ...rest } = css
    return text !== null ? { ...rest, global: text } : rest
  }
  const blocks = { ...css.blocks }
  if (text !== null) blocks[target] = text
  else delete blocks[target]
  return { ...css, blocks }
}

export function applyChatEdit(b: DesignBundle, e: ChatEdit): DesignBundle {
  switch (e.kind) {
    case 'palette':
      return { ...b, palette: { ...b.palette, ...defined(e.patch) } }
    case 'fonts':
      return { ...b, typography: { ...b.typography, ...defined(e.patch) } }
    case 'treatments':
      return { ...b, treatments: { ...b.treatments, ...defined(e.patch) } }
    case 'tokens': {
      const { spacing, radius, ...rest } = e.patch
      return {
        ...b,
        tokens: {
          ...b.tokens,
          ...defined(rest),
          spacing: { ...b.tokens.spacing, ...defined(spacing ?? {}) },
          radius: { ...b.tokens.radius, ...defined(radius ?? {}) },
        },
      }
    }
    case 'css':
      return { ...b, css: setFragment(b.css, e.target, e.css) }
    case 'remove-css':
      return { ...b, css: setFragment(b.css, e.target, null) }
  }
}

export function fragmentOf(css: DesignBundle['css'], target: CssFragmentKey): string | null {
  const body = target === 'global' ? css.global : css.blocks[target]
  return body && body.trim() ? body : null
}

const levers = (b: DesignBundle) => JSON.stringify({ p: b.palette, t: b.typography, k: b.tokens, r: b.treatments, c: b.css })
export function sameLevers(a: DesignBundle, b: DesignBundle): boolean {
  return levers(a) === levers(b)
}

export function describeChatEdit(e: ChatEdit): string {
  switch (e.kind) {
    case 'palette':
    case 'fonts':
    case 'treatments':
      return `${e.kind} (${Object.keys(defined(e.patch)).join(', ')})`
    case 'tokens':
      return `tokens (${Object.keys(defined(e.patch)).join(', ')})`
    case 'css':
      return `${e.target} CSS`
    case 'remove-css':
      return `removed ${e.target} CSS`
  }
}
