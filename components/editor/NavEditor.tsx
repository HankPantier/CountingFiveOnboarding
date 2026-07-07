'use client'

import { useMemo, useState, useEffect, type ReactNode } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import type { NavJson, NavItem } from '@/types/nav-json'

// Depth is 0-indexed: 0 = primary (top menu), 1 = secondary (dropdown),
// 2 = tertiary (side-nav only). Nothing renders below tertiary, so children
// can be added at depth 0 and 1 but not 2.
const MAX_DEPTH = 2

// Lenient structural parse for the form view: empty labels/urls are allowed
// mid-edit (the strict parser would throw and bounce the user to raw mode on
// every cleared input). Returns null only when the JSON is malformed or the
// shape is unrecognizable — that's when we fall back to the raw textarea.
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
      const children = o.children
        .map(coerceItem)
        .filter((c): c is NavItem => c !== null)
      if (children.length > 0) item.children = children
    }
    return item
  }

  const primary = root.primary
    .map(coerceItem)
    .filter((c): c is NavItem => c !== null)
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
  label,
  disabled,
  onClick,
  children,
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

function ItemFields({
  item,
  onLabel,
  onUrl,
}: {
  item: NavItem
  onLabel: (v: string) => void
  onUrl: (v: string) => void
}) {
  return (
    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
      <input
        type="text"
        value={item.label}
        placeholder="Label"
        aria-label="Menu label"
        onChange={(e) => onLabel(e.target.value)}
        className={inputClass(item.label.trim() === '')}
      />
      <input
        type="text"
        value={item.url}
        placeholder="/page-url"
        aria-label="Menu URL"
        onChange={(e) => onUrl(e.target.value)}
        className={`${inputClass(item.url.trim() === '')} font-mono`}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Path helpers — a Path is a list of indices, e.g. [0, 1] = primary[0].children[1].
// The dnd-kit sortable id for an item is its path joined with '/'.
// ---------------------------------------------------------------------------
type Path = number[]
const pathId = (p: Path): string => p.join('/')
const parsePath = (id: string): Path => id.split('/').map(Number)
const parentPath = (p: Path): Path => p.slice(0, -1)
const lastIndex = (p: Path): number => p[p.length - 1]

// The sibling list that contains the item at `path` (i.e. children of its
// parent). `[]` resolves to nav.primary. Returns null if the branch is absent.
function listAt(nav: NavJson, parent: Path): NavItem[] | null {
  if (parent.length === 0) return nav.primary
  let node: NavItem | undefined = nav.primary[parent[0]]
  for (let k = 1; k < parent.length && node; k++) {
    node = node.children?.[parent[k]]
  }
  return node?.children ?? null
}

function nodeAt(nav: NavJson, path: Path): NavItem | null {
  const list = listAt(nav, parentPath(path))
  return list?.[lastIndex(path)] ?? null
}

function SortableRow({
  path,
  label,
  inline,
  nested,
}: {
  path: Path
  label: string
  inline: ReactNode
  nested?: ReactNode
}) {
  const id = pathId(path)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="border border-border-default rounded-lg p-3 space-y-2 bg-surface-card"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${label || 'item'}`}
          className="cursor-grab active:cursor-grabbing w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-brand-navy hover:bg-surface-subtle transition-colors"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        {inline}
      </div>
      {nested}
    </li>
  )
}

export default function NavEditor({
  path,
  contents,
  onChange,
}: {
  path: string
  contents: string
  onChange: (next: string) => void
}) {
  const [showRaw, setShowRaw] = useState(false)

  // @dnd-kit generates accessibility-announcement IDs that don't line up
  // between server render and client mount, causing a hydration mismatch.
  // Mount-gate the sortable tree so it only renders on the client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const nav = useMemo(() => lenientParse(contents), [contents])

  // Strict validity drives the badge (and warns about empty fields the
  // lenient form happily tolerates while typing).
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

  const commit = (next: NavJson) => onChange(serializeNavJson(next))

  const update = (fn: (draft: NavJson) => void) => {
    if (!nav) return
    const draft = structuredClone(nav)
    fn(draft)
    commit(draft)
  }

  const setField = (p: Path, field: 'label' | 'url', value: string) =>
    update((d) => {
      const node = nodeAt(d, p)
      if (node) node[field] = value
    })

  const removeAt = (p: Path) =>
    update((d) => {
      const list = listAt(d, parentPath(p))
      if (!list) return
      list.splice(lastIndex(p), 1)
      // Drop an emptied children array so the JSON stays clean.
      const owner = parentPath(p)
      if (owner.length > 0) {
        const ownerNode = nodeAt(d, owner)
        if (ownerNode?.children && ownerNode.children.length === 0) {
          delete ownerNode.children
        }
      }
    })

  const addChild = (p: Path) =>
    update((d) => {
      const node = nodeAt(d, p)
      if (!node) return
      node.children = [...(node.children ?? []), { label: '', url: '' }]
    })

  const addPrimary = () =>
    update((d) => {
      d.primary.push({ label: '', url: '' })
    })

  // Reorder within a sibling list only. Cross-list drags (dropping an item
  // under a different parent) are ignored — mirrors the old up/down arrows,
  // which only moved items within their own level.
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = parsePath(String(active.id))
    const to = parsePath(String(over.id))
    if (from.length !== to.length) return
    if (pathId(parentPath(from)) !== pathId(parentPath(to))) return
    update((d) => {
      const list = listAt(d, parentPath(from))
      if (!list) return
      const moved = arrayMove(list, lastIndex(from), lastIndex(to))
      list.splice(0, list.length, ...moved)
    })
  }

  const formUnavailable = nav === null

  const renderLevel = (list: NavItem[], parent: Path, depth: number): ReactNode => {
    const ids = list.map((_, i) => pathId([...parent, i]))
    const listClass =
      depth === 0
        ? 'p-4 space-y-3'
        : 'ml-8 space-y-2 border-l border-border-default pl-3 pt-1'
    return (
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={listClass}>
          {list.map((item, i) => {
            const p = [...parent, i]
            const hasChildren = (item.children?.length ?? 0) > 0
            return (
              <SortableRow
                key={pathId(p)}
                path={p}
                label={item.label}
                inline={
                  <>
                    <ItemFields
                      item={item}
                      onLabel={(v) => setField(p, 'label', v)}
                      onUrl={(v) => setField(p, 'url', v)}
                    />
                    <IconButton
                      label={`Remove ${item.label || 'item'}`}
                      onClick={() => removeAt(p)}
                    >
                      ✕
                    </IconButton>
                  </>
                }
                nested={
                  (hasChildren || depth < MAX_DEPTH) && (
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
          <div className="font-heading font-semibold text-brand-navy text-lg">
            Site navigation
          </div>
        </div>

        {!formUnavailable && (
          <>
            <section className="bg-surface-card border border-border-default rounded-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
                <h2 className="text-sm font-heading font-semibold text-brand-navy">
                  Menu items
                </h2>
                {strictError ? (
                  <span className="text-xs font-body text-error">{strictError}</span>
                ) : (
                  <span className="text-xs font-body text-success">Valid</span>
                )}
              </div>

              {nav.primary.length === 0 && (
                <p className="px-4 py-4 text-xs font-body text-text-muted">
                  No menu items yet — add one below.
                </p>
              )}

              {mounted ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  {renderLevel(nav.primary, [], 0)}
                </DndContext>
              ) : (
                nav.primary.length > 0 && (
                  <p className="px-4 py-4 text-xs font-body text-text-muted">
                    Loading nav editor…
                  </p>
                )
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
                <h2 className="text-sm font-heading font-semibold text-brand-navy">
                  Call-to-action button
                </h2>
                <p className="text-[11px] font-body text-text-muted mt-0.5">
                  Optional highlighted button at the end of the menu (e.g. “Get in touch”).
                </p>
              </div>
              <div className="p-4">
                {nav.cta ? (
                  <div className="flex items-center gap-2">
                    <ItemFields
                      item={nav.cta}
                      onLabel={(v) => update((d) => { d.cta = { ...d.cta!, label: v } })}
                      onUrl={(v) => update((d) => { d.cta = { ...d.cta!, url: v } })}
                    />
                    <IconButton
                      label="Remove call-to-action"
                      onClick={() => update((d) => { delete d.cta })}
                    >
                      ✕
                    </IconButton>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => update((d) => { d.cta = { label: '', url: '' } })}
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
            The JSON is malformed, so the visual editor can&apos;t load it — fix it below
            and the form view will come back.
          </div>
        )}

        <section className="bg-surface-card border border-border-default rounded-lg">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            aria-expanded={showRaw || formUnavailable}
            className="w-full flex items-center justify-between px-4 py-2 text-left"
          >
            <span className="text-sm font-heading font-semibold text-brand-navy">
              Raw JSON ({path})
            </span>
            <span className="text-xs font-body text-text-muted">
              {showRaw || formUnavailable ? 'Hide' : 'Show'}
            </span>
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
