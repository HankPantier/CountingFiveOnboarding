'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { DndContext, MeasuringStrategy, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ChevronRight, Eye, EyeOff, Search } from 'lucide-react'
import { navEditorCollision } from '@/lib/nav-dnd'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import {
  computeMoves,
  deriveNavUrls,
  lastSegment,
  toEditItems,
  toNavJson,
  type EditNavItem,
  type Move,
} from '@/lib/editor/nav-urls'
import { useNavTreeEditor, pathId, type Path } from '@/lib/editor/use-nav-tree-editor'
import {
  buildMergedPagesModel,
  deriveNavLabel,
  navUrlToPagePath,
  pagePathToUrl,
} from '@/lib/editor/sidebar-nav-tree'
import { pageSegments, type PageFile } from '@/lib/editor/page-paths'
import type { NavJson } from '@/types/nav-json'

const MAX_DEPTH = 2
const HOME_PATH = 'content/pages/home.md'

function labelClass(selected: boolean): string {
  return `flex-1 min-w-0 truncate text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
    selected
      ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
      : 'text-text-secondary hover:bg-surface-subtle'
  }`
}

function DirtyDot() {
  return (
    <span
      role="img"
      aria-label="Unsaved changes"
      title="Unsaved changes"
      className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-warning align-middle"
    />
  )
}

function EditCountBadge({ n }: { n: number }) {
  return (
    <span
      title={`${n} edit${n === 1 ? '' : 's'}`}
      className="ml-1.5 inline-flex items-center rounded-full bg-surface-subtle px-1.5 py-0.5 align-middle font-heading text-[9px] font-semibold text-text-muted"
    >
      {n}
    </span>
  )
}

function EyeToggle({
  shown,
  label,
  disabled,
  onClick,
}: {
  shown: boolean
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={shown ? `Hide ${label} from navigation` : `Show ${label} in navigation`}
      aria-pressed={shown}
      title={shown ? 'Showing in navigation — click to hide' : 'Hidden from navigation — click to show'}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        shown ? 'text-brand-cyan hover:bg-brand-cyan/10' : 'text-text-muted hover:text-brand-navy hover:bg-surface-subtle'
      }`}
    >
      {shown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
    </button>
  )
}

// Nest drop target over a valid parent's row (mirrors NavEditor's NestOverlay).
function NestOverlay({ path, label }: { path: Path; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'nest:' + pathId(path) })
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-1/4 h-1/2 rounded flex items-center justify-center text-[9px] font-heading font-semibold transition-colors ${
        isOver ? 'bg-brand-cyan/15 ring-2 ring-brand-cyan text-brand-navy' : 'text-transparent'
      }`}
    >
      {isOver ? `Nest under ${label || 'this item'}` : ''}
    </div>
  )
}

type RowInner = {
  depth: number
  hasChildren: boolean
  isOpen: boolean
  expandable: boolean
  onToggle: () => void
  selectable: boolean
  selected: boolean
  label: string
  file: PageFile | null
  dirty: boolean
  editCount?: number
  isHome: boolean
  showNest: boolean
  navShown: boolean
  onSelect: () => void
  onToggleNav: () => void
  navBusy: boolean
}

function rowBody(
  r: RowInner,
  grip: ReactNode
): ReactNode {
  return (
    <>
      {grip}
      {r.expandable && r.hasChildren ? (
        <button
          type="button"
          onClick={r.onToggle}
          aria-expanded={r.isOpen}
          aria-label={`${r.isOpen ? 'Collapse' : 'Expand'} ${r.label}`}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-brand-navy transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${r.isOpen ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="shrink-0 w-4" aria-hidden />
      )}
      {r.selectable ? (
        <button onClick={r.onSelect} className={labelClass(r.selected)}>
          {r.label}
          {r.dirty && <DirtyDot />}
          {r.editCount ? <EditCountBadge n={r.editCount} /> : null}
        </button>
      ) : (
        <span
          className="flex-1 min-w-0 truncate text-left text-xs font-body px-2 py-1.5 text-text-muted italic"
          title="Menu link with no matching page (external or missing)"
        >
          {r.label}
        </span>
      )}
      {!r.isHome && (
        <EyeToggle shown={r.navShown} label={r.label} disabled={r.navBusy} onClick={r.onToggleNav} />
      )}
    </>
  )
}

function SortableNavRow({ path, r, children }: { path: Path; r: RowInner; children?: ReactNode }) {
  const id = pathId(path)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const grip = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${r.label}`}
      className="cursor-grab active:cursor-grabbing shrink-0 w-5 h-6 flex items-center justify-center rounded text-text-muted hover:text-brand-navy hover:bg-surface-subtle transition-colors"
    >
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  )
  return (
    <li>
      <div ref={setNodeRef} style={style} className="relative flex items-center gap-0.5">
        {rowBody(r, grip)}
        {r.showNest && <NestOverlay path={path} label={r.label} />}
      </div>
      {children}
    </li>
  )
}

function PlainNavRow({ r, children }: { r: RowInner; children?: ReactNode }) {
  // Home / non-draggable rows: a fixed-width spacer stands in for the grip so
  // labels stay aligned with sortable rows.
  const grip = <span className="shrink-0 w-5" aria-hidden />
  return (
    <li>
      <div className="relative flex items-center gap-0.5">{rowBody(r, grip)}</div>
      {children}
    </li>
  )
}

export default function SidebarPagesNav({
  pageFiles,
  navContent,
  selectedPath,
  dirtyPaths,
  editCounts,
  busy = false,
  onSelect,
  onNavCommit,
}: {
  pageFiles: PageFile[]
  navContent: string | null
  selectedPath: string | null
  dirtyPaths: Set<string>
  editCounts?: Record<string, number>
  busy?: boolean
  onSelect: (path: string) => void
  // Persist a nav.json structural change immediately. Resolves true on success;
  // on false the working tree snaps back to the last committed state.
  onNavCommit: (contents: string, moves: Move[]) => Promise<boolean>
}) {
  const parsed = useMemo<NavJson | null>(() => {
    if (!navContent) return null
    try {
      return parseNavJson(navContent)
    } catch {
      return null
    }
  }, [navContent])

  const merged = useMemo(
    () => buildMergedPagesModel(pageFiles, parsed?.primary ?? []),
    [pageFiles, parsed]
  )
  const fileByPath = useMemo(() => new Map(pageFiles.map((f) => [f.path, f])), [pageFiles])
  const notInNavPaths = useMemo(
    () => new Set(merged.notInNav.map((f) => f.path)),
    [merged]
  )

  const seedItems = useMemo(() => toEditItems(merged.navPrimary), [merged])
  // Baseline serialization for the no-op guard (skip a POST that changes nothing,
  // e.g. an over-depth drop that reparentItems rejected).
  const lastCommitted = useRef(
    serializeNavJson(toNavJson(deriveNavUrls(seedItems), parsed?.cta))
  )

  const nav = useNavTreeEditor({
    initialItems: seedItems,
    initialCta: parsed?.cta,
    maxDepth: MAX_DEPTH,
    onChange: (items, cta) => {
      const contents = serializeNavJson(toNavJson(items, cta))
      const moves = computeMoves(items)
      if (contents === lastCommitted.current && moves.length === 0) return
      lastCommitted.current = contents
      void onNavCommit(contents, moves).then((ok) => {
        if (!ok) {
          // Snap back to the last committed state.
          lastCommitted.current = serializeNavJson(toNavJson(deriveNavUrls(seedItems), parsed?.cta))
          nav.reseed(toEditItems(merged.navPrimary), parsed?.cta)
        }
      })
    },
  })

  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const searching = query.trim() !== ''
  const q = query.trim().toLowerCase()

  if (!parsed) {
    // nav.json missing or malformed — fall back to a plain selectable list so the
    // operator can still open pages; structural editing needs a valid nav file.
    return (
      <div className="mb-4 pl-[18px]">
        <p className="px-2 py-1 text-[11px] font-body text-warning-strong">
          Navigation file couldn&apos;t be read — edit it in Configuration → Navigation.
        </p>
        <ul>
          {pageFiles.map((f) => {
            const segs = pageSegments(f.path)
            return (
              <li key={f.path}>
                <button onClick={() => onSelect(f.path)} className={labelClass(selectedPath === f.path)}>
                  {segs.length === 1 ? `${segs[0]}.md` : segs[segs.length - 1]}
                  {dirtyPaths.has(f.path) && <DirtyDot />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const resolveFile = (url: string): PageFile | null => {
    const p = navUrlToPagePath(url)
    return p ? fileByPath.get(p) ?? null : null
  }

  // Recursive nav tree (normal mode).
  const renderLevel = (list: EditNavItem[], parent: Path, depth: number): ReactNode => {
    // Only draggable rows go into the SortableContext id set (home is pinned).
    const sortableIds = list
      .map((item, i) => ({ id: pathId([...parent, i]), isHome: (navUrlToPagePath(item.url) ?? '') === HOME_PATH }))
      .filter((x) => !busy && !x.isHome)
      .map((x) => x.id)
    const containerClass = depth === 0 ? 'space-y-0.5' : 'ml-2 border-l border-border-default pl-1.5 space-y-0.5'
    return (
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul className={containerClass}>
          {list.map((item, i) => {
            const p = [...parent, i]
            const file = resolveFile(item.url)
            const isHome = (navUrlToPagePath(item.url) ?? '') === HOME_PATH
            const hasChildren = (item.children?.length ?? 0) > 0
            const expandable = depth < MAX_DEPTH && hasChildren
            const open = expandable && nav.isExpanded(p)
            const draggable = !busy && !isHome
            const showNest = !isHome && (nav.nestTargetIds?.has(pathId(p)) ?? false)
            const r: RowInner = {
              depth,
              hasChildren,
              isOpen: open,
              expandable: depth < MAX_DEPTH,
              onToggle: () => nav.toggleExpanded(p),
              selectable: file !== null,
              selected: selectedPath === (file?.path ?? ''),
              label: item.label || (file ? pageSegments(file.path).slice(-1)[0] : item.url),
              file,
              dirty: file ? dirtyPaths.has(file.path) : false,
              editCount: file ? editCounts?.[file.path] : undefined,
              isHome,
              showNest,
              navShown: true,
              onSelect: () => file && onSelect(file.path),
              onToggleNav: () => nav.removeAt(p),
              navBusy: busy,
            }
            const rowChildren = open && hasChildren ? renderLevel(item.children!, p, depth + 1) : null
            return draggable ? (
              <SortableNavRow key={pathId(p)} path={p} r={r}>
                {rowChildren}
              </SortableNavRow>
            ) : (
              <PlainNavRow key={pathId(p)} r={r}>
                {rowChildren}
              </PlainNavRow>
            )
          })}
        </ul>
      </SortableContext>
    )
  }

  // Flat filtered results (search mode) — drag + visibility toggles disabled.
  const flatMatches = searching
    ? pageFiles.filter((f) => {
        const url = pagePathToUrl(f.path)
        return f.path.toLowerCase().includes(q) || url.toLowerCase().includes(q)
      })
    : []

  return (
    <div className="mb-4 pl-[6px] pr-1">
      <div className="relative mb-2 mr-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages…"
          aria-label="Search pages"
          className="w-full text-xs font-body pl-7 pr-2 py-1.5 rounded border border-border-default bg-surface-default focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-all"
        />
      </div>

      {searching ? (
        <ul>
          {flatMatches.length === 0 ? (
            <li className="px-2 py-1 text-xs text-text-muted">No matches.</li>
          ) : (
            flatMatches.map((f) => {
              const shown = !notInNavPaths.has(f.path)
              return (
                <li key={f.path} className="flex items-center gap-0.5">
                  <span className="shrink-0 w-5" aria-hidden />
                  <button onClick={() => onSelect(f.path)} className={labelClass(selectedPath === f.path)}>
                    {pageSegments(f.path).slice(-1)[0]}
                    {dirtyPaths.has(f.path) && <DirtyDot />}
                    {editCounts?.[f.path] ? <EditCountBadge n={editCounts[f.path]} /> : null}
                  </button>
                  <span
                    aria-hidden
                    title={shown ? 'In navigation' : 'Not in navigation'}
                    className={`shrink-0 w-6 h-6 flex items-center justify-center ${shown ? 'text-brand-cyan' : 'text-text-muted'}`}
                  >
                    {shown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </span>
                </li>
              )
            })
          )}
          <li className="px-2 pt-1 text-[10px] font-body text-text-muted">
            Clear search to reorder or change visibility.
          </li>
        </ul>
      ) : (
        <>
          {nav.items.length === 0 ? (
            <p className="px-2 py-1 text-xs text-text-muted">No pages in navigation.</p>
          ) : (
            // Always inside a DndContext; when busy, rows render non-draggable
            // (no grip / no useSortable) so no drag can start.
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
          )}

          {merged.notInNav.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                aria-expanded={showHidden}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-heading font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary transition-colors"
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${showHidden ? 'rotate-90' : ''}`} />
                Not in navigation
                <span className="font-body font-normal normal-case tracking-normal">
                  ({merged.notInNav.length})
                </span>
              </button>
              {showHidden && (
                <ul className="space-y-0.5">
                  {merged.notInNav.map((f) => {
                    const label = pageSegments(f.path).slice(-1)[0]
                    return (
                      <li key={f.path} className="flex items-center gap-0.5">
                        <span className="shrink-0 w-5" aria-hidden />
                        <span className="shrink-0 w-4" aria-hidden />
                        <button onClick={() => onSelect(f.path)} className={labelClass(selectedPath === f.path)}>
                          {label}
                          {dirtyPaths.has(f.path) && <DirtyDot />}
                          {editCounts?.[f.path] ? <EditCountBadge n={editCounts[f.path]} /> : null}
                        </button>
                        <EyeToggle
                          shown={false}
                          label={label}
                          disabled={busy}
                          onClick={() => {
                            const url = pagePathToUrl(f.path)
                            nav.replaceItems([
                              ...nav.items,
                              { label: deriveNavLabel(f.path), url, slug: lastSegment(url) },
                            ])
                          }}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
