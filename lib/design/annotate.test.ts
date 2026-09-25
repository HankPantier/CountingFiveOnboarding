import { describe, it, expect } from 'vitest'
import { EXPORT_MAX_EDGE, annotationOps, exportSize, nextPinNumber, shapeFromDrag, strokeWidthFor, toImagePoint, type Shape } from './annotate'

describe('annotate geometry', () => {
  it('maps client coordinates into clamped 0..1 image space', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(toImagePoint(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(toImagePoint(0, 999, rect)).toEqual({ x: 0, y: 1 })
    expect(toImagePoint(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
  it('ignores accidental clicks as drags; numbers pins in order', () => {
    expect(shapeFromDrag('box', { x: 0.1, y: 0.1 }, { x: 0.105, y: 0.1 })).toBeNull()
    expect(shapeFromDrag('arrow', { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 })).toEqual({ kind: 'arrow', from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.5 } })
    const shapes: Shape[] = [{ kind: 'pin', at: { x: 0, y: 0 }, n: 1 }, { kind: 'box', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, { kind: 'pin', at: { x: 0, y: 0 }, n: 2 }]
    expect(nextPinNumber(shapes)).toBe(3)
    expect(nextPinNumber([])).toBe(1)
  })
  it('produces pixel draw ops at any canvas size (box normalized, arrow + head, pin + label)', () => {
    const ops = annotationOps(
      [
        { kind: 'box', a: { x: 0.5, y: 0.5 }, b: { x: 0.25, y: 0.25 } },
        { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
        { kind: 'pin', at: { x: 0.5, y: 0.5 }, n: 4 },
      ],
      800,
      400
    )
    expect(ops[0]).toEqual({ op: 'rect', x: 200, y: 100, w: 200, h: 100 })
    expect(ops[1]).toEqual({ op: 'line', x1: 0, y1: 0, x2: 800, y2: 0 })
    expect(ops[2].op).toBe('poly')
    expect(ops[3]).toMatchObject({ op: 'circle', x: 400, y: 200 })
    expect(ops[4]).toMatchObject({ op: 'label', text: '4' })
  })
  it('scales stroke with the canvas and caps the export size', () => {
    expect(strokeWidthFor(300, 200)).toBe(3)
    expect(strokeWidthFor(2400, 1200)).toBe(8)
    expect(exportSize(4800, 2400)).toEqual({ width: EXPORT_MAX_EDGE, height: 1200 })
    expect(exportSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})
