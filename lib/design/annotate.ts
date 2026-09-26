// Pure + client-safe. Geometry behind AnnotateCanvas. Shapes live in
// normalized image coordinates (0..1), so they survive any display scale;
// annotationOps() turns them into pixel draw ops for whichever canvas is being
// painted (the on-screen one, or the full-size export).
import { fitWithinMaxEdge } from './downscale-math'

export type AnnotTool = 'box' | 'arrow' | 'pin'
export type Pt = { x: number; y: number }
export type Shape = { kind: 'box'; a: Pt; b: Pt } | { kind: 'arrow'; from: Pt; to: Pt } | { kind: 'pin'; at: Pt; n: number }
export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { op: 'poly'; points: [number, number][] }
  | { op: 'circle'; x: number; y: number; r: number }
  | { op: 'label'; x: number; y: number; text: string; size: number }

// The exported PNG's long edge (the browser downscale + the attachments
// route's sharp re-encode take it to ≤ 1568 afterwards).
export const EXPORT_MAX_EDGE = 2400
const MIN_DRAG = 0.01
const HEAD_ANGLE = Math.PI / 7

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function toImagePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Pt {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) }
}

export function nextPinNumber(shapes: Shape[]): number {
  return shapes.reduce((n, s) => (s.kind === 'pin' ? Math.max(n, s.n) : n), 0) + 1
}

export function shapeFromDrag(tool: 'box' | 'arrow', start: Pt, end: Pt): Shape | null {
  if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_DRAG) return null
  return tool === 'box' ? { kind: 'box', a: start, b: end } : { kind: 'arrow', from: start, to: end }
}

export function strokeWidthFor(width: number, height: number): number {
  return Math.max(3, Math.round(Math.max(width, height) / 300))
}

export function exportSize(width: number, height: number): { width: number; height: number } {
  return fitWithinMaxEdge(width, height, EXPORT_MAX_EDGE)
}

export function annotationOps(shapes: Shape[], width: number, height: number): DrawOp[] {
  const lw = strokeWidthFor(width, height)
  const px = (p: Pt): [number, number] => [p.x * width, p.y * height]
  const ops: DrawOp[] = []
  for (const s of shapes) {
    if (s.kind === 'box') {
      const [x1, y1] = px(s.a)
      const [x2, y2] = px(s.b)
      ops.push({ op: 'rect', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) })
    } else if (s.kind === 'arrow') {
      const [x1, y1] = px(s.from)
      const [x2, y2] = px(s.to)
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const head = lw * 4
      ops.push({ op: 'line', x1, y1, x2, y2 })
      ops.push({
        op: 'poly',
        points: [
          [x2, y2],
          [x2 - head * Math.cos(angle - HEAD_ANGLE), y2 - head * Math.sin(angle - HEAD_ANGLE)],
          [x2 - head * Math.cos(angle + HEAD_ANGLE), y2 - head * Math.sin(angle + HEAD_ANGLE)],
        ],
      })
    } else {
      const [x, y] = px(s.at)
      const r = lw * 4
      ops.push({ op: 'circle', x, y, r })
      ops.push({ op: 'label', x, y, text: String(s.n), size: Math.round(r * 1.1) })
    }
  }
  return ops
}
