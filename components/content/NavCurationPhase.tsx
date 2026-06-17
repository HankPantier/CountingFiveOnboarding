'use client'

import { useState, useEffect } from 'react'
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
import { GripVertical, Trash2, Eye, EyeOff, ChevronRight } from 'lucide-react'
import type { NavJson, NavItem } from '@/types/nav-json'

type SitemapEntry = { url: string; title: string; parent?: string; status?: string }

type CuratedItem = NavItem & { hidden?: boolean }

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
  // Fall back to a flat one-level structure from the sitemap. Group by parent.
  // Defensive: sitemap may be null/undefined when called before Phase 2 confirms a sitemap.
  const filtered = (sitemap ?? []).filter(e =>
    !e.status || !['redirect', 'consolidate'].includes(e.status)
  )
  const roots = filtered.filter(e => !e.parent || e.parent === '/')
  const result: CuratedItem[] = roots
    .filter(r => r.url !== '/')
    .map(r => ({
      label: r.title || r.url,
      url: r.url,
      children: filtered
        .filter(c => c.parent === r.url)
        .map(c => ({ label: c.title || c.url, url: c.url })),
    }))
  return { primary: result }
}

// Stable id derived from URL (URLs are unique per page in this app).
function itemKey(item: CuratedItem): string {
  return `nav-${item.url}`
}

function SortableRow({
  item,
  onChange,
  onRemove,
  onToggleHidden,
}: {
  item: CuratedItem
  index: number
  onChange: (next: CuratedItem) => void
  onRemove: () => void
  onToggleHidden: () => void
}) {
  const id = itemKey(item)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-white border border-border-default rounded-md px-3 py-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-text-muted hover:text-text-primary"
        aria-label="Drag handle"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <input
        type="text"
        value={item.label}
        onChange={(e) => onChange({ ...item, label: e.target.value })}
        className={`flex-1 text-sm font-body bg-transparent outline-none ${item.hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
        placeholder="Label"
      />

      <span className="text-xs font-mono text-text-muted truncate max-w-[180px]">{item.url}</span>

      {item.children?.length ? (
        <span className="text-xs text-text-muted flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {item.children.length}
        </span>
      ) : null}

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

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => itemKey(i) === active.id)
    const newIndex = items.findIndex(i => itemKey(i) === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setItems(arrayMove(items, oldIndex, newIndex))
  }

  const updateItem = (index: number, next: CuratedItem) => {
    setItems(prev => prev.map((it, i) => (i === index ? next : it)))
  }
  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }
  const toggleHidden = (index: number) => {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, hidden: !it.hidden } : it)))
  }

  const saveConfig = async () => {
    setSaving(true)
    setError(null)
    try {
      const navConfig: NavJson = {
        primary: items
          .filter(it => !it.hidden)
          .map(it => {
            const { hidden: _hidden, ...rest } = it
            void _hidden
            return rest
          }),
      }
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-heading font-semibold text-text-primary">Curate navigation</h3>
        <p className="text-xs font-body text-text-muted mt-1">
          Drag to reorder. Edit labels inline. Hide items from nav (keeps the page; removes it from the menu).
          Hidden items appear strikethrough and won&apos;t be in <code className="font-mono">nav.json</code>.
        </p>
      </div>

      {mounted ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(itemKey)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.length === 0 && (
                <p className="text-sm font-body text-text-muted py-2">No nav items.</p>
              )}
              {items.map((item, i) => (
                <SortableRow
                  key={itemKey(item)}
                  item={item}
                  index={i}
                  onChange={(next) => updateItem(i, next)}
                  onRemove={() => removeItem(i)}
                  onToggleHidden={() => toggleHidden(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="space-y-1.5">
          {items.length === 0 ? (
            <p className="text-sm font-body text-text-muted py-2">No nav items.</p>
          ) : (
            <p className="text-sm font-body text-text-muted py-2">Loading nav editor…</p>
          )}
        </div>
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
          className="px-3.5 py-1.5 rounded-pill bg-brand-cyan text-white text-xs font-heading font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save nav config'}
        </button>
      </div>
    </div>
  )
}
