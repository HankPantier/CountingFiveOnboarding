'use client'

import { useMemo, useState, useEffect, type ReactNode } from 'react'
import {
  DndContext, MeasuringStrategy, useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, IndentIncrease, IndentDecrease, ChevronRight } from 'lucide-react'
import { navEditorCollision } from '@/lib/nav-dnd'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import { computeMoves, toEditItems, toNavJson, type EditNavItem, type Move } from '@/lib/editor/nav-urls'
import { useNavTreeEditor, pathId, parsePath, type Path } from '@/lib/editor/use-nav-tree-editor'
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seed = useMemo(() => lenientParse(contents), [])

  const nav = useNavTreeEditor({
    initialItems: seed ? toEditItems(seed.primary) : [],
    initialCta: seed?.cta,
    maxDepth: MAX_DEPTH,
    onChange: (items, cta) => {
      onChange(serializeNavJson(toNavJson(items, cta)))
      onMovesChange?.(computeMoves(items))
    },
  })

  const strictError = useMemo(() => {
    try {
      parseNavJson(contents)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON'
    }
  }, [contents])

  const cta = nav.cta
  const updateCta = nav.updateCta

  const formUnavailable = seed === null

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
            const open = expandable && nav.isExpanded(p)
            const reparentTargets = nav.validReparentTargetsFor(p)
            const showNest = nav.nestTargetIds?.has(pathId(p)) ?? false
            return (
              <SortableRow
                key={pathId(p)}
                path={p}
                label={item.label}
                showNest={showNest}
                expandable={expandable}
                isOpen={open}
                childCount={item.children?.length ?? 0}
                onToggle={() => nav.toggleExpanded(p)}
                inline={
                  <>
                    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                      <input
                        type="text"
                        value={item.label}
                        placeholder="Label"
                        aria-label="Menu label"
                        onChange={(e) => nav.setLabel(p, e.target.value)}
                        className={inputClass(item.label.trim() === '')}
                      />
                      {depth === 0 ? (
                        <input
                          type="text"
                          value={item.url}
                          placeholder="/page-url"
                          aria-label="Menu URL"
                          onChange={(e) => nav.setPrimaryUrl(p, e.target.value)}
                          className={`${inputClass(item.url.trim() === '')} font-mono`}
                        />
                      ) : (
                        <div className="min-w-0">
                          <input
                            type="text"
                            value={item.slug}
                            placeholder="url-segment"
                            aria-label="URL segment"
                            onChange={(e) => nav.setSlug(p, e.target.value)}
                            className={`${inputClass(item.slug.trim() === '')} font-mono`}
                          />
                          <div className="mt-0.5 text-[10px] font-mono text-text-muted truncate" title={item.url}>
                            {item.url}
                          </div>
                        </div>
                      )}
                    </div>
                    <IconButton label={`Indent ${item.label || 'item'}`} disabled={i === 0 || depth >= MAX_DEPTH} onClick={() => nav.indent(p)}>
                      <IndentIncrease className="w-4 h-4" />
                    </IconButton>
                    <IconButton label={`Outdent ${item.label || 'item'}`} disabled={depth === 0} onClick={() => nav.outdent(p)}>
                      <IndentDecrease className="w-4 h-4" />
                    </IconButton>
                    {reparentTargets.length > 0 && (
                      <select
                        aria-label={`Move ${item.label || 'item'} under another item`}
                        title="Move under another item"
                        value=""
                        onChange={(e) => { if (e.target.value) nav.reparent(p, parsePath(e.target.value)) }}
                        className="h-6 max-w-[8rem] text-[11px] font-body px-1.5 rounded border border-border-default bg-surface-card text-text-muted hover:text-brand-navy focus:outline-none focus:border-brand-cyan cursor-pointer"
                      >
                        <option value="" disabled>Move under…</option>
                        {reparentTargets.map((t) => (
                          <option key={pathId(t.path)} value={pathId(t.path)}>
                            {' '.repeat((t.path.length - 1) * 2)}{t.label || t.url}
                          </option>
                        ))}
                      </select>
                    )}
                    <IconButton label={`Remove ${item.label || 'item'}`} onClick={() => nav.removeAt(p)}>
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
                          onClick={() => nav.addChild(p)}
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
                  {nav.expandablePaths.length > 0 && (
                    <button
                      type="button"
                      onClick={nav.toggleAll}
                      className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
                    >
                      {nav.allExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                  )}
                  {strictError ? (
                    <span className="text-xs font-body text-error">{strictError}</span>
                  ) : (
                    <span className="text-xs font-body text-success">Valid</span>
                  )}
                </div>
              </div>

              {nav.items.length === 0 && (
                <p className="px-4 py-4 text-xs font-body text-text-muted">No menu items yet — add one below.</p>
              )}

              {mounted ? (
                nav.items.length > 0 && (
                  <DndContext
                    sensors={nav.sensors}
                    collisionDetection={navEditorCollision}
                    measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                    onDragStart={nav.handleDragStart}
                    onDragEnd={nav.handleDragEnd}
                    onDragCancel={nav.handleDragCancel}
                  >
                    {renderLevel(nav.items, [], 0)}
                  </DndContext>
                )
              ) : (
                nav.items.length > 0 && <p className="px-4 py-4 text-xs font-body text-text-muted">Loading nav editor…</p>
              )}

              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={nav.addPrimary}
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
