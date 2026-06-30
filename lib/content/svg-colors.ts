import chroma from 'chroma-js'

const SKIP = new Set(['none', 'transparent', 'currentcolor', 'inherit', 'context-fill', 'context-stroke'])

// Pulls the distinct colors a logo SVG actually uses, from fill / stroke /
// stop-color (attribute or inline-style form), normalized to hex and ranked by
// how often each appears. Lets us derive a palette from a vector logo without
// rasterizing it. Skips keywords (none/currentColor/url(...)) and anything chroma
// can't parse.
export function extractSvgColors(svg: string): string[] {
  const counts = new Map<string, number>()
  const re = /(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const raw = m[1].trim().toLowerCase()
    if (SKIP.has(raw) || !chroma.valid(raw)) continue
    const hex = chroma(raw).hex().toLowerCase()
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)
}

// Picks the two most useful brand colors from extracted SVG colors: the most
// frequent saturated, non-neutral color as primary, and the next hue-distinct
// one as secondary. Returns null when nothing usable is present (caller falls
// back to neutral defaults).
export function pickBrandColors(colors: string[]): { primary: string; secondary: string } | null {
  const branded = colors.filter((h) => {
    const l = chroma(h).luminance()
    const s = chroma(h).get('hsl.s')
    return l > 0.05 && l < 0.95 && s > 0.12
  })
  const ranked = branded.length ? branded : colors
  if (ranked.length === 0) return null
  const primary = ranked[0]
  const pHue = chroma(primary).get('hsl.h')
  const secondary =
    ranked.find((h) => {
      const hue = chroma(h).get('hsl.h')
      if (Number.isNaN(hue) || Number.isNaN(pHue)) return h !== primary
      const d = Math.abs(hue - pHue)
      return Math.min(d, 360 - d) > 30
    }) ?? ranked[1] ?? primary
  return { primary, secondary }
}
