'use client'

import { useMemo, useState } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  collectExpandablePaths,
  deriveNavUrls,
  lastSegment,
  reparentItems,
  validReparentTargets,
  type EditNavItem,
} from './nav-urls'
import type { NavJson } from '@/types/nav-json'

// ---------------------------------------------------------------------------
// Path helpers — a Path is a list of indices, e.g. [0, 1] = primary[0].children[1].
// Shared by every nav-tree UI (the full NavEditor and the sidebar Pages tree).
// ---------------------------------------------------------------------------
export type Path = number[]
export const pathId = (p: Path): string => p.join('/')
export const parsePath = (id: string): Path => id.split('/').map(Number)
export const parentPath = (p: Path): Path => p.slice(0, -1)
export const lastIndex = (p: Path): number => p[p.length - 1]

export function listAt(root: EditNavItem[], parent: Path): EditNavItem[] | null {
  if (parent.length === 0) return root
  let node: EditNavItem | undefined = root[parent[0]]
  for (let k = 1; k < parent.length && node; k++) node = node.children?.[parent[k]]
  return node?.children ?? null
}
export function nodeAt(root: EditNavItem[], path: Path): EditNavItem | null {
  const list = listAt(root, parentPath(path))
  return list?.[lastIndex(path)] ?? null
}

// After the node at `removed` is spliced out, a path `p` in the same list that
// sat after it shifts down one index. Used to keep an auto-expanded destination
// pointing at the right row post-reparent (positional pathIds, matching dnd).
function adjustAfterRemoval(p: Path, removed: Path): Path {
  const fp = parentPath(removed)
  if (p.length <= fp.length) return p
  for (let i = 0; i < fp.length; i++) if (p[i] !== fp[i]) return p
  if (p[fp.length] > lastIndex(removed)) {
    const next = [...p]
    next[fp.length] -= 1
    return next
  }
  return p
}

// Headless state machine for editing a nav tree: reorder, indent/outdent,
// reparent, add/remove, expand/collapse. `onChange` fires with the derived
// items + cta after every mutation; consumers serialize / computeMoves as they
// need (the full editor writes a raw string; the sidebar posts immediately).
// State is seeded ONCE from initialItems — re-seed by remounting the consumer
// (a React key), matching the existing NavEditor pattern.
export function useNavTreeEditor(opts: {
  initialItems: EditNavItem[]
  initialCta?: NavJson['cta']
  maxDepth: number
  onChange: (items: EditNavItem[], cta: NavJson['cta'] | undefined) => void
}) {
  const { maxDepth, onChange } = opts
  const [items, setItems] = useState<EditNavItem[]>(() => opts.initialItems)
  const [cta, setCta] = useState<NavJson['cta'] | undefined>(() => opts.initialCta)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const isExpanded = (p: Path) => expanded.has(pathId(p))
  const toggleExpanded = (p: Path) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      const id = pathId(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const expand = (p: Path) => setExpanded((prev) => new Set(prev).add(pathId(p)))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const emit = (nextItems: EditNavItem[], nextCta: NavJson['cta'] | undefined) => {
    const derived = deriveNavUrls(nextItems)
    setItems(derived)
    setCta(nextCta)
    onChange(derived, nextCta)
  }

  const update = (fn: (draft: EditNavItem[]) => void) => {
    const draft = structuredClone(items)
    fn(draft)
    emit(draft, cta)
  }
  const updateCta = (next: NavJson['cta'] | undefined) => emit(items, next)
  const replaceItems = (next: EditNavItem[]) => emit(next, cta)

  // Reset working state without emitting — used to snap back to the last committed
  // tree after a failed save. Consumers pass freshly-seeded items.
  const reseed = (nextItems: EditNavItem[], nextCta?: NavJson['cta']) => {
    setItems(nextItems)
    setCta(nextCta)
    setExpanded(new Set())
    setActiveId(null)
  }

  const setLabel = (p: Path, v: string) =>
    update((d) => {
      const n = nodeAt(d, p)
      if (n) n.label = v
    })
  const setSlug = (p: Path, v: string) =>
    update((d) => {
      const n = nodeAt(d, p)
      if (n) n.slug = v
    })
  const setPrimaryUrl = (p: Path, v: string) =>
    update((d) => {
      const n = nodeAt(d, p)
      if (n) {
        n.url = v
        n.slug = lastSegment(v)
      }
    })

  const removeAt = (p: Path) =>
    update((d) => {
      const list = listAt(d, parentPath(p))
      if (!list) return
      list.splice(lastIndex(p), 1)
      const owner = parentPath(p)
      if (owner.length > 0) {
        const on = nodeAt(d, owner)
        if (on?.children && on.children.length === 0) delete on.children
      }
    })

  const addChild = (p: Path) => {
    expand(p)
    update((d) => {
      const n = nodeAt(d, p)
      if (!n) return
      n.children = [...(n.children ?? []), { label: '', url: '', slug: '' }]
    })
  }

  const addPrimary = () =>
    update((d) => {
      d.push({ label: '', url: '', slug: '' })
    })

  // Nest an item under its previous sibling (one level deeper).
  const indent = (p: Path) => {
    const i = lastIndex(p)
    if (i > 0) expand([...parentPath(p), i - 1])
    update((d) => {
      const list = listAt(d, parentPath(p))
      if (!list || i === 0) return
      const prev = list[i - 1]
      const [moved] = list.splice(i, 1)
      prev.children = [...(prev.children ?? []), moved]
    })
  }

  // Promote an item to its grandparent's list, just after its former parent.
  const outdent = (p: Path) =>
    update((d) => {
      if (p.length < 2) return
      const parentList = listAt(d, parentPath(p))
      if (!parentList) return
      const [moved] = parentList.splice(lastIndex(p), 1)
      if (parentList.length === 0) {
        const owner = nodeAt(d, parentPath(p))
        if (owner) delete owner.children
      }
      const grandList = listAt(d, parentPath(parentPath(p)))
      if (!grandList) return
      grandList.splice(lastIndex(parentPath(p)) + 1, 0, moved)
    })

  // Nest the item at `from` under the node at `newParent` (reparentItems no-ops
  // invalid moves, so callers don't need to re-check depth/self).
  const reparent = (from: Path, newParent: Path) => {
    expand(adjustAfterRemoval(newParent, from))
    emit(reparentItems(items, from, newParent, maxDepth), cta)
  }

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const handleDragCancel = () => setActiveId(null)

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const overId = String(over.id)
    if (overId.startsWith('nest:')) {
      reparent(parsePath(String(active.id)), parsePath(overId.slice('nest:'.length)))
      return
    }
    if (active.id === over.id) return
    const from = parsePath(String(active.id))
    const to = parsePath(overId)
    if (from.length !== to.length) return
    if (pathId(parentPath(from)) !== pathId(parentPath(to))) return
    update((d) => {
      const list = listAt(d, parentPath(from))
      if (!list) return
      const moved = arrayMove(list, lastIndex(from), lastIndex(to))
      list.splice(0, list.length, ...moved)
    })
  }

  // While a row is dragged, the set of rows it may legally nest under — used to
  // overlay a nest drop target on each valid parent's row.
  const activePath = activeId ? parsePath(activeId) : null
  const nestTargetIds = activePath
    ? new Set(validReparentTargets(items, activePath, maxDepth).map((t) => pathId(t.path)))
    : null

  const expandablePaths = useMemo(() => collectExpandablePaths(items), [items])
  const allExpanded =
    expandablePaths.length > 0 && expandablePaths.every((id) => expanded.has(id))
  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(expandablePaths))

  const validReparentTargetsFor = (p: Path) => validReparentTargets(items, p, maxDepth)

  return {
    items,
    cta,
    activeId,
    isExpanded,
    toggleExpanded,
    expand,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    nestTargetIds,
    expandablePaths,
    allExpanded,
    toggleAll,
    setLabel,
    setSlug,
    setPrimaryUrl,
    removeAt,
    addChild,
    addPrimary,
    indent,
    outdent,
    reparent,
    updateCta,
    replaceItems,
    reseed,
    validReparentTargetsFor,
  }
}
