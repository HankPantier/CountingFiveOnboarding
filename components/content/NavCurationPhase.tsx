'use client'

import { useState, useEffect, type ReactNode } from 'react'
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
import { GripVertical, Trash2, Eye, EyeOff } from 'lucide-react'
import type { NavJson, NavItem } from '@/types/nav-json'

type SitemapEntry = { url: string; title: string; parent?: string; status?: string }

// Recursive: curation applies at every level (primary → secondary → tertiary).
type CuratedItem = {
  label: string
  url: string
  hidden?: boolean
  children?: CuratedItem[]
}

type Props = {
  contentJobId: string
  initialNavConfig: NavJson | null
  confirmedSitemap: SitemapEntry[]
}

// Build initial curated state from either the saved nav_config or the sitemap.
function deriveInitialItems(
  navConfig: NavJson | null,
  sitemap: SitemapEntry[]
): { primary: CuratedItem[]; cta?: { label: string; url: string } } {
  if (navConfig?.primary?.length) {
    return { primary: navConfig.primary.map(item => ({ ...item })), cta: navConfig.cta }
  }
  // Fall back to a structure derived from the sitemap. Group by parent and
  // recurse to preserve tertiary items (secondary + tertiary); a saved
  // nav_config is preferred over the sitemap at assembly, so a 2-level derive
  // here would silently drop tertiary. Depth cap: 0 = primary, 2 = tertiary.
  // Defensive: sitemap may be null/undefined when called before Phase 2 confirms a sitemap.
  const filtered = (sitemap ?? []).filter(e =>
    !e.status || !['redirect', 'consolidate'].includes(e.status)
  )
  const build = (parentUrl: string, depth: number): NavItem[] =>
    depth > 2
      ? []
      : filtered
          .filter(c => c.parent === parentUrl && c.url !== parentUrl)
          .map(c => {
            const kids = build(c.url, depth + 1)
            return { label: c.title || c.url, url: c.url, ...(kids.length > 0 && { children: kids }) }
          })
  const roots = filtered.filter(e => !e.parent || e.parent === '/')
  const result: CuratedItem[] = roots
    .filter(r => r.url !== '/')
    .map(r => {
      const children = build(r.url, 1)
      return { label: r.title || r.url, url: r.url, ...(children.length > 0 && { children }) }
    })
  return { primary: result }
}

// ---------------------------------------------------------------------------
// Path helpers — a Path is a list of indices, e.g. [0, 1] = primary[0].children[1].
// The dnd-kit sortable id for a row is its path joined with '/'.
// ---------------------------------------------------------------------------
type Path = number[]
const pathId = (p: Path): string => p.join('/')
const parsePath = (id: string): Path => id.split('/').map(Number)
const parentPath = (p: Path): Path => p.slice(0, -1)
const lastIndex = (p: Path): number => p[p.length - 1]

// The sibling list containing the item at `path` (children of its parent).
// `[]` resolves to the root list.
function listAt(root: CuratedItem[], parent: Path): CuratedItem[] | null {
  if (parent.length === 0) return root
  let node: CuratedItem | undefined = root[parent[0]]
  for (let k = 1; k < parent.length && node; k++) {
    node = node.children?.[parent[k]]
  }
  return node?.children ?? null
}

function nodeAt(root: CuratedItem[], path: Path): CuratedItem | null {
  const list = listAt(root, parentPath(path))
  return list?.[lastIndex(path)] ?? null
}

function SortableRow({
  path,
  item,
  onLabel,
  onToggleHidden,
  onRemove,
  nested,
}: {
  path: Path
  item: CuratedItem
  onLabel: (v: string) => void
  onToggleHidden: () => void
  onRemove: () => void
  nested?: ReactNode
}) {
  const id = pathId(path)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-2 bg-white border border-border-default rounded-md px-3 py-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-text-muted hover:text-text-primary"
          aria-label={`Reorder ${item.label || 'item'}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <input
          type="text"
          value={item.label}
          onChange={(e) => onLabel(e.target.value)}
          className={`flex-1 min-w-0 text-sm font-body bg-transparent outline-none ${item.hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
          placeholder="Label"
          aria-label="Menu label"
        />

        <span className="text-xs font-mono text-text-muted truncate max-w-[180px]">{item.url}</span>

        <button
          type="button"
          onClick={onToggleHidden}
          className="text-xs text-text-muted hover:text-text-primary p-1"
          aria-label={item.hidden ? 'Show in nav' : 'Hide from nav'}
          title={item.hidden ? 'Show in nav' : 'Hide from nav'}
        >
          {item.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-error hover:text-error p-1"
          aria-label="Remove from nav"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {nested}
    </div>
  )
}

export default function NavCurationPhase({
  contentJobId,
  initialNavConfig,
  confirmedSitemap,
}: Props) {
  const initial = deriveInitialItems(initialNavConfig, confirmedSitemap)
  const [items, setItems] = useState<CuratedItem[]>(initial.primary)
  const [ctaLabel, setCtaLabel] = useState(initial.cta?.label ?? '')
  const [ctaUrl, setCtaUrl] = useState(initial.cta?.url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(initialNavConfig ? 'Loaded saved config' : null)

  // @dnd-kit generates accessibility-announcement IDs that don't line up between
  // server render and client mount (DndDescribedBy-0 vs DndDescribedBy-1), causing
  // a hydration mismatch. Mount-gate the DndContext so it only renders on the client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // Hydration gate: render dnd-kit children only after mount to avoid mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const update = (fn: (draft: CuratedItem[]) => void) =>
    setItems(prev => {
      const draft = structuredClone(prev)
      fn(draft)
      return draft
    })

  const setLabel = (p: Path, v: string) =>
    update((d) => {
      const node = nodeAt(d, p)
      if (node) node.label = v
    })

  const toggleHidden = (p: Path) =>
    update((d) => {
      const node = nodeAt(d, p)
      if (node) node.hidden = !node.hidden
    })

  const removeAt = (p: Path) =>
    update((d) => {
      const list = listAt(d, parentPath(p))
      if (!list) return
      list.splice(lastIndex(p), 1)
      const owner = parentPath(p)
      if (owner.length > 0) {
        const ownerNode = nodeAt(d, owner)
        if (ownerNode?.children && ownerNode.children.length === 0) {
          delete ownerNode.children
        }
      }
    })

  // Reorder within a sibling list only. Cross-list drags (dropping under a
  // different parent) are ignored — items stay in their own level.
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

  // Strip hidden items (and their subtrees) and the `hidden` flag; preserve nesting.
  const toNavItems = (list: CuratedItem[]): NavItem[] =>
    list
      .filter((it) => !it.hidden)
      .map((it) => {
        const kids = it.children ? toNavItems(it.children) : []
        return { label: it.label, url: it.url, ...(kids.length > 0 && { children: kids }) }
      })

  const saveConfig = async () => {
    setSaving(true)
    setError(null)
    try {
      const navConfig: NavJson = { primary: toNavItems(items) }
      if (ctaLabel.trim() && ctaUrl.trim()) {
        navConfig.cta = { label: ctaLabel.trim(), url: ctaUrl.trim() }
      }

      const res = await fetch(`/api/content-jobs/${contentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nav_config: navConfig }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save nav config')
      }
      setSavedAt(`Saved ${new Date().toLocaleTimeString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const renderLevel = (list: CuratedItem[], parent: Path, depth: number): ReactNode => {
    const ids = list.map((_, i) => pathId([...parent, i]))
    const containerClass =
      depth === 0
        ? 'space-y-1.5'
        : 'mt-1.5 ml-6 space-y-1.5 border-l border-border-default pl-3'
    return (
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={containerClass}>
          {list.map((item, i) => {
            const p = [...parent, i]
            return (
              <SortableRow
                key={pathId(p)}
                path={p}
                item={item}
                onLabel={(v) => setLabel(p, v)}
                onToggleHidden={() => toggleHidden(p)}
                onRemove={() => removeAt(p)}
                nested={
                  item.children?.length ? renderLevel(item.children, p, depth + 1) : null
                }
              />
            )
          })}
        </div>
      </SortableContext>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-heading font-semibold text-text-primary">Curate navigation</h3>
        <p className="text-xs font-body text-text-muted mt-1">
          Drag to reorder within a level. Edit labels inline. Hide an item to keep its page
          but remove it (and anything nested under it) from the menu. Hidden items appear
          strikethrough and won&apos;t be in <code className="font-mono">nav.json</code>.
        </p>
      </div>

      {mounted ? (
        items.length === 0 ? (
          <p className="text-sm font-body text-text-muted py-2">No nav items.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {renderLevel(items, [], 0)}
          </DndContext>
        )
      ) : (
        <p className="text-sm font-body text-text-muted py-2">
          {items.length === 0 ? 'No nav items.' : 'Loading nav editor…'}
        </p>
      )}

      <div className="pt-2 space-y-2">
        <h4 className="text-sm font-heading font-semibold text-text-primary">Header CTA (optional)</h4>
        <p className="text-xs font-body text-text-muted">A button shown in the nav bar on desktop. Leave blank to omit.</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="Get in touch"
            className="text-sm font-body border border-border-default rounded-md px-3 py-2"
          />
          <input
            type="text"
            value={ctaUrl}
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="/contact"
            className="text-sm font-body border border-border-default rounded-md px-3 py-2"
          />
        </div>
      </div>

      {error && <div className="text-sm text-error font-body">{error}</div>}

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs font-body text-text-muted">{savedAt ?? ''}</span>
        <button
          type="button"
          onClick={saveConfig}
          disabled={saving}
          className="px-3.5 py-1.5 rounded-pill bg-brand-cyan text-white text-xs font-heading font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save nav config'}
        </button>
      </div>
    </div>
  )
}
