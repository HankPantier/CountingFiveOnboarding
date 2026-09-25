// Pure + client-safe. Defensive parsing of stored run screenshots (jsonb).
import { isPlainObject } from './input-validation'
import type { RunScreenshot } from './run-types'

export function parseScreenshots(value: unknown): RunScreenshot[] {
  if (!Array.isArray(value)) return []
  const out: RunScreenshot[] = []
  for (const s of value) {
    if (!isPlainObject(s)) continue
    const { viewport, path, width, height } = s
    if (viewport !== 'desktop' && viewport !== 'mobile') continue
    if (typeof path !== 'string' || !path.startsWith('design/') || path.includes('..')) continue
    if (typeof width !== 'number' || typeof height !== 'number') continue
    out.push({ viewport, path, width, height })
  }
  return out
}
