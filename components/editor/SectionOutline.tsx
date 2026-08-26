'use client'

import { useEffect, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, Trash2 } from 'lucide-react'
import { blockLabel, type SectionInfo } from '@/lib/editor/section-reorder'

// Read-only-of-the-body outline that lets an operator drag, nudge, or delete
// whole page sections. All mutations are handed up as (from,to)/index callbacks;
// the parent rewrites the body and re-derives the list, so this component holds
// no section state of its own.

const ctrlBtn =
  'border border-border-default text-text-secondary w-7 h-7 flex items-center justify-center rounded-pill transition-all hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed'

function SectionLabel({ blockId, heading }: { blockId: string; heading: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-sm font-body text-text-primary truncate">
        {heading || blockLabel(blockId)}
      </div>
      <div className="text-[10px] font-heading font-semibold uppercase tracking-wide text-text-muted">
        {blockLabel(blockId)}
      </div>
    </div>
  )
}

function SortableRow({
  section,
  index,
  total,
  onMove,
  onDelete,
}: {
  section: SectionInfo
  index: number
  total: number
  onMove: (index: number, dir: 'up' | 'down') => void
  onDelete: (index: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <li ref={setNodeRef} style={style}>
      <div className="flex items-center gap-2 border border-border-default rounded-lg p-2.5 bg-surface-card">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${section.heading || blockLabel(section.blockId)}`}
          className="cursor-grab active:cursor-grabbing w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-brand-navy hover:bg-surface-subtle transition-colors"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <SectionLabel blockId={section.blockId} heading={section.heading} />
        <button
          type="button"
          onClick={() => onMove(index, 'up')}
          disabled={index === 0}
          aria-label="Move section up"
          className={ctrlBtn}
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(index, 'down')}
          disabled={index === total - 1}
          aria-label="Move section down"
          className={ctrlBtn}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Delete the “${section.heading || blockLabel(section.blockId)}” section? This removes it from the page.`
              )
            ) {
              onDelete(index)
            }
          }}
          aria-label="Delete section"
          className="w-7 h-7 flex items-center justify-center rounded-pill text-error hover:bg-error/5 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  )
}

export default function SectionOutline({
  sections,
  leadIn,
  onReorder,
  onMove,
  onDelete,
}: {
  sections: SectionInfo[]
  leadIn: { heading: string } | null
  onReorder: (from: number, to: number) => void
  onMove: (index: number, dir: 'up' | 'down') => void
  onDelete: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const ids = sections.map((s) => s.id)
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) onReorder(from, to)
  }

  if (sections.length === 0) return null

  return (
    <section className="bg-surface-card border border-border-default rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <ChevronRight
          className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <h2 className="text-sm font-heading font-semibold text-brand-navy">Sections</h2>
        <span className="text-xs font-body text-text-muted">({sections.length})</span>
        <span className="ml-auto text-xs font-body text-text-muted">
          {open ? 'Drag, reorder, or delete' : 'Rearrange page sections'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {leadIn && (
            <div className="flex items-center gap-2 border border-dashed border-border-default rounded-lg p-2.5 bg-surface-subtle/40">
              <span className="w-6 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 text-sm font-body text-text-muted truncate">
                {leadIn.heading}
              </div>
              <span className="text-[10px] font-heading font-semibold uppercase tracking-wide text-text-muted">
                Intro · fixed
              </span>
            </div>
          )}
          {mounted ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {sections.map((section, i) => (
                    <SortableRow
                      key={section.id}
                      section={section}
                      index={i}
                      total={sections.length}
                      onMove={onMove}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="px-1 py-2 text-xs font-body text-text-muted">Loading…</p>
          )}
        </div>
      )}
    </section>
  )
}
