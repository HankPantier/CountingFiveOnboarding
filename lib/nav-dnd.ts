import { closestCenter, type CollisionDetection } from '@dnd-kit/core'

// Nav-editor row ids are index paths joined with '/', e.g. "0/1" = primary[0].children[1].
// The parent key is the id with its last segment dropped ("" for a top-level row).
const parentKey = (id: string): string => id.split('/').slice(0, -1).join('/')

// Sibling-scoped collision detection for the nav editors. Each nesting level is
// its own SortableContext, so an unrestricted closestCenter can resolve `over`
// to a row in a different level — which the editors' handleDragEnd then rejects,
// making reorders silently fail. Restricting candidates to rows that share the
// dragged item's parent list guarantees `over` is always a valid sibling.
export const siblingScopedCollision: CollisionDetection = (args) => {
  const activeParent = parentKey(String(args.active.id))
  const candidates = args.droppableContainers.filter(
    (c) => parentKey(String(c.id)) === activeParent
  )
  return closestCenter({ ...args, droppableContainers: candidates })
}
