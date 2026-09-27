import chroma from 'chroma-js'

const SKIP = new Set(['none', 'transparent', 'currentcolor', 'inherit', 'context-fill', 'context-stroke'])

// Pulls the distinct colors a logo SVG actually uses, from fill / stroke /
// stop-color (attribute or inline-style form), normalized to hex and ranked by
// how often each appears. Lets us derive a palette from a vector logo without
// rasterizing it. Skips keywords (none/currentColor/url(...)) and anything chroma
// can't parse.
export function extractSvgColors(svg: string): string[] {
  return extractSvgColorWeights(svg).map((c) => c.hex)
}

// The same colours with their occurrence counts, for the weighted logo-colour
// picker (lib/content/derive-palette.ts → pickLogoBrandColors).
export function extractSvgColorWeights(svg: string): Array<{ hex: string; weight: number }> {
  const counts = new Map<string, number>()
  const re = /(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const raw = m[1].trim().toLowerCase()
    if (SKIP.has(raw) || !chroma.valid(raw)) continue
    const hex = chroma(raw).hex().toLowerCase()
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex, weight]) => ({ hex, weight }))
}
