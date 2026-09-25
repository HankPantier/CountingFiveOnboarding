// Pure + client-safe. Deterministic render checks for Design Studio concepts —
// the spec's "hard gates before apply": AA contrast on body text, no mobile
// overflow, no hidden blocks. The renderer's in-page script
// (render/page-metrics-script.ts) collects a RawPageSample per viewport; this
// module turns samples into RenderMetrics, and diffs a concept's metrics
// against the CURRENT SITE's (the run's baseline) so a defect the template
// already had never blocks a concept. No axe-core: our own checks run in the
// renderer's existing page under its CSP (see the P4 plan's rulings).
import chroma from 'chroma-js'
import { isPlainObject } from './input-validation'
import type { RunViewport } from './run-types'

export type RawTextSample = { key: string; text: string; color: string; bg: string[]; bgImage: boolean; fontSizePx: number; fontWeight: number; opacity: number }
export type RawBlockSample = {
  key: string
  display: string
  visibility: string
  opacity: number
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}
export type RawPageSample = { viewportWidth: number; scrollWidth: number; docHeight: number; offenders: string[]; text: RawTextSample[]; blocks: RawBlockSample[] }

export type ContrastFailure = { key: string; text: string; ratio: number; required: number; fontSizePx: number }
export type HiddenReason = 'display' | 'visibility' | 'opacity' | 'size' | 'offscreen'
export type HiddenBlock = { key: string; reason: HiddenReason }
export type ViewportMetrics = {
  viewport: RunViewport
  textChecked: number
  // Text over a background image / gradient, or with an unparseable colour.
  textUnverified: number
  contrast: ContrastFailure[] // worst first, capped at MAX_CONTRAST_FAILURES (display / critic)
  // EVERY failing key, uncapped — what the baseline diff compares, so a
  // severity reshuffle past the display cap never reads as a "new" failure.
  // Absent (hand-built / legacy) ⇒ the keys of `contrast`.
  contrastKeys?: string[]
  overflow: { scrollWidth: number; viewportWidth: number; offenders: string[] } | null
  hidden: HiddenBlock[]
}
export type RenderMetrics = { v: 1; viewports: ViewportMetrics[] }
export type GateFailure = { kind: 'contrast' | 'overflow' | 'hidden'; viewport: RunViewport; message: string }

export const AA_NORMAL = 4.5
export const AA_LARGE = 3
// How many failures are kept with detail (shown + fed to the critic). The
// baseline diff uses `contrastKeys`, which is uncapped.
export const MAX_CONTRAST_FAILURES = 40
// The in-page script samples ≤ 400 texts, so this never truncates in practice.
const MAX_CONTRAST_KEYS = 400
const OVERFLOW_TOLERANCE_PX = 1
const MIN_BLOCK_PX = 2
const MIN_BLOCK_OPACITY = 0.05
const LARGE_PX = 24
const LARGE_BOLD_PX = 18.66
const BOLD = 700

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]
const WHITE: Rgb = [255, 255, 255]

// null = unparseable. A background '' / 'transparent' is see-through.
function toRgba(css: string, emptyIsTransparent: boolean): Rgba | null {
  const s = css.trim()
  if (s === '' || s === 'transparent') return emptyIsTransparent ? [0, 0, 0, 0] : null
  try {
    const [r, g, b, a] = chroma(s).rgba()
    return [r, g, b, a]
  } catch {
    return null
  }
}

function over(top: Rgba, bottom: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, top[3]))
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a)]
}

export function contrastOf(sample: RawTextSample): { ratio: number; required: number } | null {
  if (sample.bgImage) return null
  let bg: Rgb = WHITE
  // bg is innermost-first; paint from the outermost inwards over the canvas.
  for (let i = sample.bg.length - 1; i >= 0; i--) {
    const layer = toRgba(sample.bg[i], true)
    if (!layer) return null
    bg = over(layer, bg)
  }
  const fg = toRgba(sample.color, false)
  if (!fg) return null
  const opacity = Math.min(1, Math.max(0, sample.opacity))
  const text = over([fg[0], fg[1], fg[2], fg[3] * opacity], bg)
  const ratio = chroma.contrast(chroma.rgb(...text), chroma.rgb(...bg))
  const large = sample.fontSizePx >= LARGE_PX || (sample.fontSizePx >= LARGE_BOLD_PX && sample.fontWeight >= BOLD)
  return { ratio, required: large ? AA_LARGE : AA_NORMAL }
}

function hiddenReason(b: RawBlockSample, docWidth: number): HiddenReason | null {
  if (b.display === 'none') return 'display'
  if (b.visibility !== 'visible') return 'visibility'
  if (b.opacity < MIN_BLOCK_OPACITY) return 'opacity'
  if (b.width < MIN_BLOCK_PX || b.height < MIN_BLOCK_PX) return 'size'
  if (b.right <= 0 || b.left >= docWidth || b.bottom <= 0) return 'offscreen'
  return null
}

const floor2 = (n: number): number => Math.floor(n * 100) / 100

export function evaluatePageSample(viewport: RunViewport, raw: RawPageSample): ViewportMetrics {
  const contrast: ContrastFailure[] = []
  let textChecked = 0
  let textUnverified = 0
  for (const sample of raw.text) {
    const c = contrastOf(sample)
    if (!c) {
      textUnverified++
      continue
    }
    textChecked++
    if (c.ratio < c.required) contrast.push({ key: sample.key, text: sample.text, ratio: floor2(c.ratio), required: c.required, fontSizePx: sample.fontSizePx })
  }
  contrast.sort((a, b) => a.ratio / a.required - b.ratio / b.required)
  const overflows = raw.scrollWidth > raw.viewportWidth + OVERFLOW_TOLERANCE_PX || raw.offenders.length > 0
  return {
    viewport,
    textChecked,
    textUnverified,
    contrast: contrast.slice(0, MAX_CONTRAST_FAILURES),
    contrastKeys: contrast.map((f) => f.key).slice(0, MAX_CONTRAST_KEYS),
    overflow: overflows ? { scrollWidth: raw.scrollWidth, viewportWidth: raw.viewportWidth, offenders: raw.offenders } : null,
    hidden: raw.blocks.flatMap((b) => {
      const reason = hiddenReason(b, Math.max(raw.scrollWidth, raw.viewportWidth))
      return reason ? [{ key: b.key, reason }] : []
    }),
  }
}

export function combineMetrics(list: ViewportMetrics[]): RenderMetrics | null {
  return list.length > 0 ? { v: 1, viewports: list } : null
}

const VIEWPORT_LABEL: Record<RunViewport, string> = { desktop: 'Desktop (1440)', mobile: 'Mobile (390)' }
const HIDDEN_TEXT: Record<HiddenReason, string> = {
  display: 'display: none',
  visibility: 'visibility hidden',
  opacity: 'fully transparent',
  size: 'collapsed to zero size',
  offscreen: 'pushed off the page',
}

// 'block:hero h1#0' → 'hero › h1'; 'block:hero#0' → 'hero'; a trailing
// ' (600px)' is kept.
export function describeKey(key: string): string {
  const m = /^(?:(?:block|component):([^\s#]+)|(page))(?:\s+([a-z0-9-]+))?#\d+(.*)$/.exec(key)
  if (!m) return key
  const scope = m[1] ?? m[2]
  return `${scope}${m[3] ? ` › ${m[3]}` : ''}${m[4] ?? ''}`
}

function contrastKeysOf(vm: ViewportMetrics): string[] {
  return vm.contrastKeys ?? vm.contrast.map((f) => f.key)
}

export function metricGateFailures(metrics: RenderMetrics, baseline: RenderMetrics | null): GateFailure[] {
  const out: GateFailure[] = []
  for (const vm of metrics.viewports) {
    const base = baseline?.viewports.find((b) => b.viewport === vm.viewport) ?? null
    const label = VIEWPORT_LABEL[vm.viewport]
    const baseContrast = new Set(base ? contrastKeysOf(base) : [])
    const shown = new Set<string>()
    for (const f of vm.contrast) {
      shown.add(f.key)
      if (baseContrast.has(f.key)) continue
      out.push({ kind: 'contrast', viewport: vm.viewport, message: `${label}: “${f.text}” (${describeKey(f.key)}) is ${f.ratio.toFixed(2)}:1 — needs ${f.required}:1` })
    }
    // New failures past the display cap have no detail stored — one summary line.
    const unshown = contrastKeysOf(vm).filter((k) => !shown.has(k) && !baseContrast.has(k))
    if (unshown.length > 0) {
      const n = unshown.length
      out.push({
        kind: 'contrast',
        viewport: vm.viewport,
        message: `${label}: ${n} more text ${n === 1 ? 'element falls' : 'elements fall'} below AA contrast — e.g. ${describeKey(unshown[0])}`,
      })
    }
    if (vm.overflow && !base?.overflow) {
      const eg = vm.overflow.offenders.slice(0, 2).map(describeKey).join(', ')
      out.push({
        kind: 'overflow',
        viewport: vm.viewport,
        message: `${label}: the page is wider than the screen (${vm.overflow.scrollWidth} px at ${vm.overflow.viewportWidth} px)${eg ? ` — e.g. ${eg}` : ''}`,
      })
    }
    const baseHidden = new Set(base?.hidden.map((h) => h.key) ?? [])
    for (const h of vm.hidden) {
      if (baseHidden.has(h.key)) continue
      out.push({ kind: 'hidden', viewport: vm.viewport, message: `${label}: the ${describeKey(h.key)} block is hidden (${HIDDEN_TEXT[h.reason]})` })
    }
  }
  return out
}

// ── Defensive parsing (renderer output / jsonb) ─────────────────────────────
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null)

function parseText(v: unknown): RawTextSample | null {
  if (!isPlainObject(v)) return null
  const key = str(v.key, 200)
  const text = str(v.text, 80)
  const color = str(v.color, 120)
  if (key === null || text === null || color === null) return null
  if (!Array.isArray(v.bg) || typeof v.bgImage !== 'boolean' || !finite(v.fontSizePx) || !finite(v.fontWeight) || !finite(v.opacity)) return null
  const bg = v.bg.flatMap((c) => (typeof c === 'string' ? [c.slice(0, 120)] : []))
  return { key, text, color, bg, bgImage: v.bgImage, fontSizePx: v.fontSizePx, fontWeight: v.fontWeight, opacity: v.opacity }
}

function parseBlock(v: unknown): RawBlockSample | null {
  if (!isPlainObject(v)) return null
  const key = str(v.key, 200)
  const display = str(v.display, 40)
  const visibility = str(v.visibility, 40)
  const nums = [v.opacity, v.width, v.height, v.left, v.right, v.top, v.bottom]
  if (key === null || display === null || visibility === null || !nums.every(finite)) return null
  const [opacity, width, height, left, right, top, bottom] = nums as number[]
  return { key, display, visibility, opacity, width, height, left, right, top, bottom }
}

export function parseRawPageSample(value: unknown): RawPageSample | null {
  if (!isPlainObject(value)) return null
  const { viewportWidth, scrollWidth, docHeight } = value
  if (!finite(viewportWidth) || !finite(scrollWidth) || !finite(docHeight)) return null
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  return {
    viewportWidth,
    scrollWidth,
    docHeight,
    offenders: list(value.offenders).flatMap((o) => (typeof o === 'string' ? [o.slice(0, 200)] : [])).slice(0, 8),
    text: list(value.text).flatMap((t) => {
      const p = parseText(t)
      return p ? [p] : []
    }),
    blocks: list(value.blocks).flatMap((b) => {
      const p = parseBlock(b)
      return p ? [p] : []
    }),
  }
}

const HIDDEN_REASONS: readonly HiddenReason[] = ['display', 'visibility', 'opacity', 'size', 'offscreen']

function parseViewportMetrics(v: unknown): ViewportMetrics | null {
  if (!isPlainObject(v)) return null
  if (v.viewport !== 'desktop' && v.viewport !== 'mobile') return null
  if (!finite(v.textChecked) || !finite(v.textUnverified) || !Array.isArray(v.contrast) || !Array.isArray(v.hidden)) return null
  const contrast = v.contrast.flatMap((f): ContrastFailure[] => {
    if (!isPlainObject(f)) return []
    const key = str(f.key, 200)
    const text = str(f.text, 80)
    if (key === null || text === null || !finite(f.ratio) || !finite(f.required) || !finite(f.fontSizePx)) return []
    return [{ key, text, ratio: f.ratio, required: f.required, fontSizePx: f.fontSizePx }]
  })
  const hidden = v.hidden.flatMap((h): HiddenBlock[] => {
    if (!isPlainObject(h)) return []
    const key = str(h.key, 200)
    return key !== null && (HIDDEN_REASONS as readonly unknown[]).includes(h.reason) ? [{ key, reason: h.reason as HiddenReason }] : []
  })
  let overflow: ViewportMetrics['overflow'] = null
  if (isPlainObject(v.overflow) && finite(v.overflow.scrollWidth) && finite(v.overflow.viewportWidth)) {
    const offenders = Array.isArray(v.overflow.offenders) ? v.overflow.offenders.flatMap((o) => (typeof o === 'string' ? [o.slice(0, 200)] : [])) : []
    overflow = { scrollWidth: v.overflow.scrollWidth, viewportWidth: v.overflow.viewportWidth, offenders }
  }
  const out: ViewportMetrics = { viewport: v.viewport, textChecked: v.textChecked, textUnverified: v.textUnverified, contrast, overflow, hidden }
  if (Array.isArray(v.contrastKeys)) {
    out.contrastKeys = v.contrastKeys.flatMap((k) => (typeof k === 'string' ? [k.slice(0, 200)] : [])).slice(0, MAX_CONTRAST_KEYS)
  }
  return out
}

export function parseRenderMetrics(value: unknown): RenderMetrics | null {
  if (!isPlainObject(value) || value.v !== 1 || !Array.isArray(value.viewports)) return null
  const viewports = value.viewports.flatMap((v) => {
    const p = parseViewportMetrics(v)
    return p ? [p] : []
  })
  return viewports.length > 0 ? { v: 1, viewports } : null
}
