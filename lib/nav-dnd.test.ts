import { describe, expect, it } from 'vitest'
import type { CollisionDetection } from '@dnd-kit/core'
import { siblingScopedCollision } from './nav-dnd'

// Minimal fixtures for closestCenter: it reads each container's `id`, looks up a
// rect in `droppableRects`, and ranks by distance from `collisionRect`'s center.
type Args = Parameters<CollisionDetection>[0]

const rect = (top: number) => ({
  top,
  left: 0,
  right: 100,
  bottom: top + 10,
  width: 100,
  height: 10,
})

// A vertical stack: "0" (primary), its children "0/0" and "0/1", then "1" (primary).
const IDS = ['0', '0/0', '0/1', '1']
const TOPS: Record<string, number> = { '0': 0, '0/0': 10, '0/1': 20, '1': 30 }

function makeArgs(activeId: string, collisionTop: number): Args {
  const droppableRects = new Map(IDS.map((id) => [id, rect(TOPS[id])]))
  return {
    active: { id: activeId },
    collisionRect: rect(collisionTop),
    droppableRects,
    droppableContainers: IDS.map((id) => ({ id })),
    pointerCoordinates: null,
  } as unknown as Args
}

describe('siblingScopedCollision', () => {
  it('never resolves a primary drag to a nested child, even when a child is closest', () => {
    // Active "1" is dragged up next to child "0/0" (center 15). Unfiltered
    // closestCenter would pick "0/0"; the sibling filter must exclude it.
    const collisions = siblingScopedCollision(makeArgs('1', 12))
    const ids = collisions.map((c) => String(c.id))
    expect(ids.every((id) => !id.includes('/'))).toBe(true)
    expect(ids).toContain('0')
    expect(ids).not.toContain('0/0')
  })

  it('scopes a child drag to its own sibling list', () => {
    // Active "0/1" dragged toward primary "1" (center 35). Only "0/0"/"0/1"
    // (same parent "0") are valid candidates.
    const collisions = siblingScopedCollision(makeArgs('0/1', 34))
    const ids = collisions.map((c) => String(c.id))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => id.startsWith('0/'))).toBe(true)
    expect(ids).not.toContain('1')
  })

  it('picks the nearest sibling among valid candidates', () => {
    // Active "0" dragged down to overlap "1" (center 35) — the only other
    // top-level sibling — so it ranks first.
    const collisions = siblingScopedCollision(makeArgs('0', 34))
    expect(String(collisions[0].id)).toBe('1')
  })
})
