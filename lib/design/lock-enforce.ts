// Server-only (postcss). Applying design locks to a candidate bundle — THE one
// enforcement step every versioned write runs (chat workspace via
// concept-validate, Studio concepts, commitDesignVersion):
//   - lever locks: the locked lever is put back to the current design's value
//   - area locks: the target's own CSS fragment, and every global-fragment
//     selector that targets it, are put back to the current design's
//   - a layout preset that re-lays out a locked area (or is locked itself) is
//     put back
//   - the lock pins (css.locks) and the fonts they need (typography.
//     pinnedFonts) are always recomputed from the locks — never trusted from
//     the candidate.
// `current` must carry the draft's CSS region (its `css`), or locked targets
// lose their CSS; callers without one pass `currentCss: null` to leave area CSS
// as the candidate has it (the commit re-applies with the real region).
import postcss, { type AtRule, type ChildNode, type Container, type Root, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import type { DesignBundle } from './bundle'
import type { CssTarget } from './css-targets'
import { bundleToRepoFiles, type RepoThemeFiles } from './bundle-files'
import { composeLockPins, pinnedFontsOf, snapshotLook } from './lock-pins'
import { isLeverLocked, lockedPresets, lockedTargets, type DesignLock, type LockSnapshot } from './locks'
import { canonicalLayout, DEFAULT_LAYOUT_PRESET, type LayoutPresets } from './layout-presets'

export type LockEnforcement = { bundle: DesignBundle; notes: string[] }

function selectorTargets(selector: string, target: CssTarget): boolean {
  let hit = false
  try {
    selectorParser((root) => {
      root.walkAttributes((a) => {
        if ((a.attribute === 'data-block' || a.attribute === 'data-component') && a.value === target) hit = true
      })
    }).processSync(selector)
  } catch {
    return false
  }
  return hit
}

function splitSelectors(selector: string): string[] {
  try {
    const out: string[] = []
    selectorParser((root) => {
      root.each((s) => {
        out.push(s.toString().trim())
      })
    }).processSync(selector)
    return out
  } catch {
    return [selector]
  }
}

function pruneEmpty(container: Container): void {
  container.each((node) => {
    if (node.type === 'atrule' && node.nodes) {
      pruneEmpty(node)
      if (node.nodes.length === 0) node.remove()
    }
  })
}

// Drops every selector of `css` that targets one of `targets` (a rule left
// with no selectors is removed).
function withoutTargets(root: Root, targets: CssTarget[]): void {
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes') return
    const keep = splitSelectors(rule.selector).filter((s) => !targets.some((t) => selectorTargets(s, t)))
    if (keep.length === 0) rule.remove()
    else rule.selector = keep.join(', ')
  })
  pruneEmpty(root)
}

// The rules of `css` narrowed to the selectors that target one of `targets`,
// each wrapped in its at-rule chain.
function onlyTargets(root: Root, targets: CssTarget[]): ChildNode[] {
  const out: ChildNode[] = []
  root.walkRules((rule: Rule) => {
    if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes') return
    const hit = splitSelectors(rule.selector).filter((s) => targets.some((t) => selectorTargets(s, t)))
    if (hit.length === 0) return
    let node: ChildNode = rule.clone({ selector: hit.join(', ') })
    let parent = rule.parent
    while (parent && parent.type === 'atrule') {
      const wrap = (parent as AtRule).clone({ nodes: [] })
      wrap.append(node)
      node = wrap
      parent = parent.parent
    }
    out.push(node)
  })
  return out
}

// The candidate's global fragment with every locked target's rules replaced by
// the current design's.
export function keepLockedGlobalRules(candidate: string | undefined, current: string | undefined, targets: CssTarget[]): string | undefined {
  if (targets.length === 0) return candidate
  let next: Root
  let cur: Root
  try {
    next = postcss.parse(candidate ?? '')
    cur = postcss.parse(current ?? '')
  } catch {
    return current
  }
  const kept = onlyTargets(cur, targets)
  // Unchanged locked rules → the candidate as-is (no reordering churn).
  if (onlyTargets(next, targets).map(String).join('\n') === kept.map(String).join('\n')) return candidate
  withoutTargets(next, targets)
  for (const node of kept) next.append(node)
  const text = next.toString().trim()
  return text ? text : undefined
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function applyUserLocks(
  candidate: DesignBundle,
  current: Pick<DesignBundle, 'palette' | 'typography' | 'tokens' | 'treatments' | 'style' | 'layout'>,
  currentCss: DesignBundle['css'] | null,
  locks: readonly DesignLock[]
): LockEnforcement {
  const notes: string[] = []
  let b: DesignBundle = candidate

  const keep = <K extends 'palette' | 'tokens' | 'treatments'>(lever: 'palette' | 'tokens' | 'treatments', key: K, label: string) => {
    if (isLeverLocked(locks, lever) && !sameJson(b[key], current[key])) {
      b = { ...b, [key]: structuredClone(current[key]) }
      notes.push(`${label} is locked — the current ${label.toLowerCase()} was kept.`)
    }
  }
  keep('palette', 'palette', 'Palette')
  keep('tokens', 'tokens', 'Shape & spacing')
  keep('treatments', 'treatments', 'Treatments')
  if (isLeverLocked(locks, 'fonts')) {
    const t = current.typography
    if (b.typography.headingFont !== t.headingFont || b.typography.bodyFont !== t.bodyFont || b.typography.accentFont !== t.accentFont) {
      b = { ...b, typography: { ...b.typography, headingFont: t.headingFont, bodyFont: t.bodyFont, accentFont: t.accentFont } }
      notes.push('Fonts are locked — the current fonts were kept.')
    }
  }
  if (isLeverLocked(locks, 'style') && !sameJson(b.style, current.style)) {
    const { style: _s, ...rest } = b
    b = current.style ? { ...rest, style: { ...current.style } } : rest
    notes.push('Style presets are locked — the current presets were kept.')
  }

  const presets = lockedPresets(locks)
  if (presets.length > 0) {
    const layout: Record<string, string> = { ...(b.layout ?? {}) }
    let changed = false
    for (const p of presets) {
      const want = current.layout?.[p] ?? DEFAULT_LAYOUT_PRESET
      const have = layout[p] ?? DEFAULT_LAYOUT_PRESET
      if (want !== have) {
        layout[p] = want
        changed = true
      }
    }
    if (changed) {
      const next = canonicalLayout(layout as LayoutPresets)
      const { layout: _l, ...rest } = b
      b = next ? { ...rest, layout: next } : rest
      notes.push(`Layout presets for locked areas were kept (${presets.join(', ')}).`)
    }
  }

  const targets = lockedTargets(locks)
  let blocks = b.css.blocks
  let global = b.css.global
  if (currentCss && targets.length > 0) {
    blocks = { ...b.css.blocks }
    for (const t of targets) {
      if ((blocks[t] ?? '') === (currentCss.blocks[t] ?? '')) continue
      if (currentCss.blocks[t]) blocks[t] = currentCss.blocks[t]
      else delete blocks[t]
    }
    global = keepLockedGlobalRules(b.css.global, currentCss.global, targets)
    if (!sameJson(blocks, b.css.blocks) || (global ?? '').trim() !== (b.css.global ?? '').trim()) {
      notes.push(`Locked areas keep their CSS (${targets.join(', ')}).`)
    }
  }

  return { bundle: withLockPins({ ...b, css: { ...(global?.trim() ? { global } : {}), blocks, ...(b.css.locks ? { locks: b.css.locks } : {}) } }, locks), notes }
}

// The bundle with its lock pins (css.locks) and pinned fonts recomputed from
// `locks` — never trusted from the bundle itself. Canonical css key order
// (global, blocks, locks) so sameLevers never sees a reordering as a change.
export function withLockPins(b: DesignBundle, locks: readonly DesignLock[]): DesignBundle {
  const pins = composeLockPins(locks)
  const pinnedFonts = pinnedFontsOf(locks)
  const { pinnedFonts: _oldFonts, ...typography } = b.typography
  const { global, blocks } = b.css
  return {
    ...b,
    css: { ...(global?.trim() ? { global } : {}), blocks, ...(pins ? { locks: pins } : {}) },
    typography: pinnedFonts.length > 0 ? { ...typography, pinnedFonts } : typography,
  }
}

// What an area lock taken on `bundle` freezes: its theme.css custom properties
// (rendered from the bundle onto the draft files), the global fragment's :root
// overrides and the font families. null when the bundle can't be rendered.
export function snapshotFromBundle(bundle: DesignBundle, draftFiles: RepoThemeFiles): LockSnapshot | null {
  const { locks: _pins, ...css } = bundle.css
  const rendered = bundleToRepoFiles({ ...bundle, css }, draftFiles, { removeLegacy: false })
  if (!rendered.ok) return null
  return snapshotLook({
    themeCss: rendered.files.themeCss,
    globalCss: bundle.css.global,
    typography: bundle.typography,
    headlineStyle: bundle.treatments.headlineStyle,
  })
}
