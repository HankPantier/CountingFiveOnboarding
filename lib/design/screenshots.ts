// Pure + client-safe. Defensive parsing of stored run screenshots (jsonb).
import { isPlainObject } from './input-validation'
import type { RunScreenshot, RunViewport } from './run-types'

export function parseScreenshots(value: unknown): RunScreenshot[] {
  if (!Array.isArray(value)) return []
  const out: RunScreenshot[] = []
  for (const s of value) {
    if (!isPlainObject(s)) continue
    const { viewport, path, width, height } = s
    if (viewport !== 'desktop' && viewport !== 'mobile') continue
    if (typeof path !== 'string' || !path.startsWith('design/') || path.includes('..')) continue
    if (typeof width !== 'number' || typeof height !== 'number') continue
    out.push({ viewport, path, width, height, ...(s.fontsReady === false ? { fontsReady: false as const } : {}) })
  }
  return out
}

// The viewports of a render captured before its webfonts loaded.
export function fontsNotReadyViewports(shots: RunScreenshot[]): RunViewport[] {
  return shots.filter((s) => s.fontsReady === false).map((s) => s.viewport)
}

// The Studio's non-blocking note for such a render (null when every fold had its fonts).
export function fontsNotReadyNote(shots: RunScreenshot[]): string | null {
  const vps = fontsNotReadyViewports(shots)
  if (vps.length === 0) return null
  const which = vps.length === 1 ? `the ${vps[0]} screenshot` : 'the screenshots'
  return `Fonts hadn’t finished loading when this was captured — ${which} may show fallback fonts.`
}
