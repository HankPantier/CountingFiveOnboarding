// Pure sizing math for the browser-side inspiration-image downscale
// (components/design-studio/downscale-image.ts). Given the original
// dimensions and a maximum long edge, returns the integer target
// dimensions that preserve aspect ratio and never enlarge the image.
export function fitWithinMaxEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  if (maxEdge <= 0) return { width: safeWidth, height: safeHeight }

  const longEdge = Math.max(safeWidth, safeHeight)
  if (longEdge <= maxEdge) return { width: safeWidth, height: safeHeight }

  const scale = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}
