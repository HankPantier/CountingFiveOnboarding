'use client'

import { useMemo, useState, useEffect, type ReactNode } from 'react'
import {
  DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor,
  useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, IndentIncrease, IndentDecrease, ChevronRight } from 'lucide-react'
import { navEditorCollision } from '@/lib/nav-dnd'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import {
  collectExpandablePaths, computeMoves, deriveNavUrls, lastSegment, reparentItems,
  toEditItems, toNavJson, validReparentTargets,
  type EditNavItem, type Move,
} from '@/lib/editor/nav-urls'
import type { NavItem, NavJson } from '@/types/nav-json'

// 0 = primary, 1 = secondary, 2 = tertiary. Children can be added / nested down
// to tertiary; nothing renders deeper.
const MAX_DEPTH = 2

function lenientParse(text: string): NavJson | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  if (!Array.isArray(root.primary)) return null

  const coerceItem = (raw: unknown): NavItem | null => {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const item: NavItem = {
      label: typeof o.label === 'string' ? o.label : '',
      url: typeof o.url === 'string' ? o.url : '',
    }
    if (Array.isArray(o.children)) {
      const children = o.children.map(coerceItem).filter((c): c is NavItem => c !== null)
      if (children.length > 0) item.children = children
    }
    return item
  }

  const primary = root.primary.map(coerceItem).filter((c): c is NavItem => c !== null)
  const nav: NavJson = { primary }
  if (root.cta && typeof root.cta === 'object') {
    const cta = root.cta as Record<string, unknown>
    nav.cta = {
      label: typeof cta.label === 'string' ? cta.label : '',
      url: typeof cta.url === 'string' ? cta.url : '',
    }
  }
  return nav
}

function inputClass(empty: boolean): string {
  return `w-full text-xs font-body px-2.5 py-1.5 rounded border bg-surface-card focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-all ${
    empty ? 'border-error/50' : 'border-border-default'
  }`
}

function IconButton({
  label, disabled, onClick, children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-brand-navy hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Path helpers — a Path is a list of indices, e.g. [0, 1] = primary[0].children[1].
// ---------------------------------------------------------------------------
type Path = number[]
const pathId = (p: Path): string => p.join('/')
const parsePath = (id: string): Path => id.split('/').map(Number)
const parentPath = (p: Path): Path => p.slice(0, -1)
const lastIndex = (p: Path): number => p[p.length - 1]

function listAt(root: EditNavItem[], parent: Path): EditNavItem[] | null {
  if (parent.length === 0) return root
  let node: EditNavItem | undefined = root[parent[0]]
  for (let k = 1; k < parent.length && node; k++) node = node.children?.[parent[k]]
  return node?.children ?? null
}
function nodeAt(root: EditNavItem[], path: Path): EditNavItem | null {
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

function SortableRow({
  path, label, inline, nested, showNest, expandable, isOpen, childCount, onToggle,
}: {
  path: Path
  label: string
  inline: ReactNode
  nested?: ReactNode
  showNest?: boolean
  expandable?: boolean
  isOpen?: boolean
  childCount?: number
  onToggle?: () => void
}) {
  const id = pathId(path)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const hasChildren = (childCount ?? 0) > 0
  return (
    <li>
      <div
        ref={setNodeRef}
        style={style}
        className="relative flex items-center gap-2 border border-border-default rounded-lg p-3 bg-surface-card"
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${label || 'item'}`}
          className="cursor-grab active:cursor-grabbing w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-brand-navy hover:bg-surface-subtle transition-colors"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} sub-items of ${label || 'item'}`}
            title={isOpen ? 'Collapse sub-items' : 'Expand sub-items'}
            className="shrink-0 h-6 flex items-center gap-0.5 rounded px-1 text-text-muted hover:text-brand-navy hover:bg-surface-subtle transition-colors"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            {hasChildren && (
              <span className="text-[10px] font-body tabular-nums">{childCount}</span>
            )}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        {inline}
        {showNest && <NestOverlay path={path} label={label} />}
      </div>
      {nested}
    </li>
  )
}

// Drop target covering the center band of a valid parent's row while dragging.
// Overlaying the row (rather than a strip in the flowing list) keeps the target
// stable — it tracks the row as siblings reflow — and large, so it's easy to hit.
// The row's top/bottom quarters stay clear for sibling reordering. Rendered only
// for rows that can accept the active drag; pointer-events-none so it never
// intercepts the grip or inputs.
function NestOverlay({ path, label }: { path: Path; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'nest:' + pathId(path) })
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={`pointer-events-none absolute inset-x-1 top-1/4 h-1/2 rounded-md flex items-center justify-center text-[10px] font-heading font-semibold transition-colors ${
        isOver ? 'bg-brand-cyan/15 ring-2 ring-brand-cyan text-brand-navy' : 'text-transparent'
      }`}
    >
      {isOver ? `Nest under ${label || 'this item'}` : ''}
    </div>
  )
}

export default function NavEditor({
  path,
  contents,
  onChange,
  onMovesChange,
}: {
  path: string
  contents: string
  onChange: (next: string) => void
  onMovesChange?: (moves: Move[]) => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // Seed editor state once from the loaded nav.json. External replacements
  // (conflict "take server", publish reload) remount this component via a key
  // in EditorShell, which re-seeds. Malformed JSON → empty form + raw fallback.
  // Seed once from the contents present at mount; external replacements remount
  // via EditorShell's key, so we deliberately don't re-seed on prop changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seed = useMemo(() => lenientParse(contents), [])
  const [items, setItems] = useState<EditNavItem[]>(() =>
    seed ? toEditItems(seed.primary) : []
  )
  const [cta, setCta] = useState<NavJson['cta'] | undefined>(() => seed?.cta)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Which expandable rows are open. Empty = all collapsed → only primary items
  // show. Keyed by positional pathId ("0", "0/1"), matching the dnd/path ids.
  // View state only: no persistence (CLAUDE.md forbids localStorage/sessionStorage),
  // and positional ids are re-seeded on remount when the loaded nav changes.
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

  const strictError = useMemo(() => {
    try {
      parseNavJson(contents)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON'
    }
  }, [contents])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const emit = (nextItems: EditNavItem[], nextCta: NavJson['cta'] | undefined) => {
    const derived = deriveNavUrls(nextItems)
    setItems(derived)
    setCta(nextCta)
    onChange(serializeNavJson(toNavJson(derived, nextCta)))
    onMovesChange?.(computeMoves(derived))
  }

  const update = (fn: (draft: EditNavItem[]) => void) => {
    const draft = structuredClone(items)
    fn(draft)
    emit(draft, cta)
  }
  const updateCta = (next: NavJson['cta'] | undefined) => emit(items, next)

  const setLabel = (p: Path, v: string) =>
    update((d) => { const n = nodeAt(d, p); if (n) n.label = v })
  const setSlug = (p: Path, v: string) =>
    update((d) => { const n = nodeAt(d, p); if (n) n.slug = v })
  const setPrimaryUrl = (p: Path, v: string) =>
    update((d) => { const n = nodeAt(d, p); if (n) { n.url = v; n.slug = lastSegment(v) } })

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
    update((d) => { d.push({ label: '', url: '', slug: '' }) })

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
  // Callers only pass valid targets (validReparentTargets), so the move always
  // happens and `from` is removed — adjust the destination for that shift.
  const reparent = (from: Path, newParent: Path) => {
    expand(adjustAfterRemoval(newParent, from))
    emit(reparentItems(items, from, newParent, MAX_DEPTH), cta)
  }

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

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

  const formUnavailable = seed === null

  // While a row is being dragged, the set of rows it may legally nest under —
  // used to overlay a nest drop target on each valid parent's row.
  const activePath = activeId ? parsePath(activeId) : null
  const nestTargetIds = activePath
    ? new Set(validReparentTargets(items, activePath, MAX_DEPTH).map((t) => pathId(t.path)))
    : null

  // Rows with sub-items — drives the expand-all / collapse-all toggle.
  const expandablePaths = useMemo(() => collectExpandablePaths(items), [items])
  const allExpanded =
    expandablePaths.length > 0 && expandablePaths.every((id) => expanded.has(id))
  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(expandablePaths))

  const renderLevel = (list: EditNavItem[], parent: Path, depth: number): ReactNode => {
    const ids = list.map((_, i) => pathId([...parent, i]))
    const containerClass = depth === 0 ? 'p-4 space-y-3' : 'ml-8 space-y-2 border-l border-border-default pl-3 pt-1'
    return (
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={containerClass}>
          {list.map((item, i) => {
            const p = [...parent, i]
            const hasChildren = (item.children?.length ?? 0) > 0
            const expandable = depth < MAX_DEPTH
            const open = expandable && isExpanded(p)
            const reparentTargets = validReparentTargets(items, p, MAX_DEPTH)
            const showNest = nestTargetIds?.has(pathId(p)) ?? false
            return (
              <SortableRow
                key={pathId(p)}
                path={p}
                label={item.label}
                showNest={showNest}
                expandable={expandable}
                isOpen={open}
                childCount={item.children?.length ?? 0}
                onToggle={() => toggleExpanded(p)}
                inline={
                  <>
                    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                      <input
                        type="text"
                        value={item.label}
                        placeholder="Label"
                        aria-label="Menu label"
                        onChange={(e) => setLabel(p, e.target.value)}
                        className={inputClass(item.label.trim() === '')}
                      />
                      {depth === 0 ? (
                        <input
                          type="text"
                          value={item.url}
                          placeholder="/page-url"
                          aria-label="Menu URL"
                          onChange={(e) => setPrimaryUrl(p, e.target.value)}
                          className={`${inputClass(item.url.trim() === '')} font-mono`}
                        />
                      ) : (
                        <div className="min-w-0">
                          <input
                            type="text"
                            value={item.slug}
                            placeholder="url-segment"
                            aria-label="URL segment"
                            onChange={(e) => setSlug(p, e.target.value)}
                            className={`${inputClass(item.slug.trim() === '')} font-mono`}
                          />
                          <div className="mt-0.5 text-[10px] font-mono text-text-muted truncate" title={item.url}>
                            {item.url}
                          </div>
                        </div>
                      )}
                    </div>
                    <IconButton label={`Indent ${item.label || 'item'}`} disabled={i === 0 || depth >= MAX_DEPTH} onClick={() => indent(p)}>
                      <IndentIncrease className="w-4 h-4" />
                    </IconButton>
                    <IconButton label={`Outdent ${item.label || 'item'}`} disabled={depth === 0} onClick={() => outdent(p)}>
                      <IndentDecrease className="w-4 h-4" />
                    </IconButton>
                    {reparentTargets.length > 0 && (
                      <select
                        aria-label={`Move ${item.label || 'item'} under another item`}
                        title="Move under another item"
                        value=""
                        onChange={(e) => { if (e.target.value) reparent(p, parsePath(e.target.value)) }}
                        className="h-6 max-w-[8rem] text-[11px] font-body px-1.5 rounded border border-border-default bg-surface-card text-text-muted hover:text-brand-navy focus:outline-none focus:border-brand-cyan cursor-pointer"
                      >
                        <option value="" disabled>Move under…</option>
                        {reparentTargets.map((t) => (
                          <option key={pathId(t.path)} value={pathId(t.path)}>
                            {' '.repeat((t.path.length - 1) * 2)}{t.label || t.url}
                          </option>
                        ))}
                      </select>
                    )}
                    <IconButton label={`Remove ${item.label || 'item'}`} onClick={() => removeAt(p)}>
                      ✕
                    </IconButton>
                  </>
                }
                nested={
                  open && (
                    <>
                      {hasChildren && renderLevel(item.children!, p, depth + 1)}
                      {depth < MAX_DEPTH && (
                        <button
                          type="button"
                          onClick={() => addChild(p)}
                          className="ml-8 text-[11px] font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
                        >
                          {depth === 0 ? '+ Add sub-item' : '+ Add sub-sub-item'}
                        </button>
                      )}
                    </>
                  )
                }
              />
            )
          })}
        </ul>
      </SortableContext>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div>
          <div className="text-xs font-heading text-text-muted">Editing</div>
          <div className="font-heading font-semibold text-brand-navy text-lg">Site navigation</div>
          <p className="text-[11px] font-body text-text-muted mt-1">
            Nest an item under another with the <span className="font-semibold">Move under…</span> menu,
            by dragging it onto a “nest” zone, or with the indent arrows; its URL becomes{' '}
            <span className="font-mono">/parent/segment</span>. Saving moves the page to the new URL and
            adds a redirect from the old one.
          </p>
        </div>

        {!formUnavailable && (
          <>
            <section className="bg-surface-card border border-border-default rounded-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
                <h2 className="text-sm font-heading font-semibold text-brand-navy">Menu items</h2>
                <div className="flex items-center gap-3">
                  {expandablePaths.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
                    >
                      {allExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                  )}
                  {strictError ? (
                    <span className="text-xs font-body text-error">{strictError}</span>
                  ) : (
                    <span className="text-xs font-body text-success">Valid</span>
                  )}
                </div>
              </div>

              {items.length === 0 && (
                <p className="px-4 py-4 text-xs font-body text-text-muted">No menu items yet — add one below.</p>
              )}

              {mounted ? (
                items.length > 0 && (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={navEditorCollision}
                    measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setActiveId(null)}
                  >
                    {renderLevel(items, [], 0)}
                  </DndContext>
                )
              ) : (
                items.length > 0 && <p className="px-4 py-4 text-xs font-body text-text-muted">Loading nav editor…</p>
              )}

              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={addPrimary}
                  className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                >
                  + Add menu item
                </button>
              </div>
            </section>

            <section className="bg-surface-card border border-border-default rounded-lg">
              <div className="px-4 py-2 border-b border-border-default">
                <h2 className="text-sm font-heading font-semibold text-brand-navy">Call-to-action button</h2>
                <p className="text-[11px] font-body text-text-muted mt-0.5">
                  Optional highlighted button at the end of the menu (e.g. “Get in touch”).
                </p>
              </div>
              <div className="p-4">
                {cta ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                      <input
                        type="text"
                        value={cta.label}
                        placeholder="Label"
                        aria-label="CTA label"
                        onChange={(e) => updateCta({ ...cta, label: e.target.value })}
                        className={inputClass(cta.label.trim() === '')}
                      />
                      <input
                        type="text"
                        value={cta.url}
                        placeholder="/page-url"
                        aria-label="CTA URL"
                        onChange={(e) => updateCta({ ...cta, url: e.target.value })}
                        className={`${inputClass(cta.url.trim() === '')} font-mono`}
                      />
                    </div>
                    <IconButton label="Remove call-to-action" onClick={() => updateCta(undefined)}>✕</IconButton>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateCta({ label: '', url: '' })}
                    className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                  >
                    + Add call-to-action
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {formUnavailable && (
          <div className="bg-warning/10 border border-warning/30 text-warning-strong text-xs font-body rounded-lg px-4 py-3">
            The JSON is malformed, so the visual editor can&apos;t load it — fix it below and reopen the file.
          </div>
        )}

        <section className="bg-surface-card border border-border-default rounded-lg">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            aria-expanded={showRaw || formUnavailable}
            className="w-full flex items-center justify-between px-4 py-2 text-left"
          >
            <span className="text-sm font-heading font-semibold text-brand-navy">Raw JSON ({path})</span>
            <span className="text-xs font-body text-text-muted">{showRaw || formUnavailable ? 'Hide' : 'Show'}</span>
          </button>
          {(showRaw || formUnavailable) && (
            <div className="border-t border-border-default">
              <textarea
                value={contents}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                aria-label="nav.json source"
                className="w-full min-h-[320px] text-sm font-mono px-4 py-3 outline-none resize-y"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
