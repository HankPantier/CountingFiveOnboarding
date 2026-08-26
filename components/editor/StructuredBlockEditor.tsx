'use client'

import { useEffect, useRef, useState } from 'react'
import type { IconItemRef } from '@/lib/editor/icon-items'
import {
  cardBlockId,
  parseCardBlock,
  setCardTitle,
  setCardDescription,
  setCardLink,
  setCardIcon,
  addCard,
  removeCard,
  moveCard,
} from '@/lib/editor/structured-blocks/card-blocks'
import { extractTeamMembers, moveTeamMember, removeTeamMember } from '@/lib/editor/team-photos'
import {
  parseTeamGridBlock,
  setTeamMemberField,
  addTeamMember,
} from '@/lib/editor/structured-blocks/team-grid'
import IconPickerControl from './IconPickerControl'

// Inline field editor for ONE structured block's markdown (a card family or a
// team-grid). Renders each card/member as an editable form and pushes every
// change back as new block text via `onChange`. Inputs are uncontrolled
// (defaultValue) so per-keystroke re-parsing upstream can't fight the caret;
// handlers read the latest block text from `textRef` so edits across fields
// never clobber one another. Structural ops (add/remove/move/icon) bump `rev`
// to remount the inputs with fresh values.

const TEAM_GRID_RE = /^<!--\s*block:\s*team-grid\b/

const fieldInput =
  'w-full text-sm font-body px-3 py-2 rounded border border-border-default focus:border-brand-cyan focus:outline-none'
const fieldTextarea = `${fieldInput} resize-y min-h-[64px]`
const fieldLabel = 'block text-[11px] font-heading text-text-secondary mb-1'
const ctrlBtn =
  'border border-border-default text-text-secondary font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed'
const removeBtn =
  'ml-auto text-[11px] font-heading font-semibold text-error hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed'
const addBtn =
  'rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading font-semibold text-xs text-brand-navy hover:bg-brand-navy/5 transition-colors'

function BlockShell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-lg border border-border-default bg-surface-subtle/40 p-3">
      {heading && (
        <h3 className="mb-2 font-heading font-semibold text-base text-brand-navy">{heading}</h3>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function CardEditor({
  text,
  onChange,
}: {
  text: string
  onChange: (next: string) => void
}) {
  // Handlers read the latest block text here so edits across fields don't
  // clobber one another; synced after commit (never mutated during render).
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
  const [rev, setRev] = useState(0)
  const model = parseCardBlock(text)
  const isService = model.blockId === 'service-cards'

  const emit = (next: string) => onChange(next)
  const emitRemount = (next: string) => {
    onChange(next)
    setRev((r) => r + 1)
  }

  return (
    <BlockShell heading={model.heading}>
      {model.cards.map((card, i) => {
        // Synthesize a chunk ref for the picker; it reads only icon + title.
        const iconRef: IconItemRef = {
          kind: 'chunk',
          blockId: model.blockId,
          title: card.title,
          icon: card.icon,
          headingLineIndex: 0,
          iconLineIndex: null,
        }
        return (
          <div
            key={`${rev}-${i}`}
            className="rounded-md border border-border-default bg-surface-card p-3 space-y-2"
          >
            <label className="block">
              <span className={fieldLabel}>Title</span>
              <input
                type="text"
                defaultValue={card.title}
                onChange={(e) => emit(setCardTitle(textRef.current, i, e.target.value))}
                className={`${fieldInput} font-heading font-semibold`}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>Description</span>
              <textarea
                defaultValue={card.description}
                onChange={(e) => emit(setCardDescription(textRef.current, i, e.target.value))}
                className={fieldTextarea}
              />
            </label>
            {isService && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block">
                  <span className={fieldLabel}>Link label (optional)</span>
                  <input
                    type="text"
                    defaultValue={card.link?.label ?? ''}
                    placeholder="Learn more"
                    onChange={(e) =>
                      emit(
                        setCardLink(textRef.current, i, {
                          label: e.target.value,
                          url: card.link?.url ?? '',
                        })
                      )
                    }
                    className={fieldInput}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>Link URL (optional)</span>
                  <input
                    type="text"
                    defaultValue={card.link?.url ?? ''}
                    placeholder="/services/…"
                    onChange={(e) =>
                      emit(
                        setCardLink(textRef.current, i, {
                          label: card.link?.label ?? '',
                          url: e.target.value,
                        })
                      )
                    }
                    className={fieldInput}
                  />
                </label>
              </div>
            )}
            <div>
              <span className={fieldLabel}>Icon</span>
              <IconPickerControl
                item={iconRef}
                onChange={(name) => emitRemount(setCardIcon(textRef.current, i, name))}
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => emitRemount(moveCard(textRef.current, i, 'up'))}
                disabled={i === 0}
                className={ctrlBtn}
              >
                Move up
              </button>
              <button
                type="button"
                onClick={() => emitRemount(moveCard(textRef.current, i, 'down'))}
                disabled={i === model.cards.length - 1}
                className={ctrlBtn}
              >
                Move down
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove “${card.title}” from this section?`)) {
                    emitRemount(removeCard(textRef.current, i))
                  }
                }}
                className={removeBtn}
              >
                Remove
              </button>
            </div>
          </div>
        )
      })}
      <button type="button" onClick={() => emitRemount(addCard(textRef.current))} className={addBtn}>
        + Add card
      </button>
    </BlockShell>
  )
}

function TeamEditor({
  text,
  onChange,
}: {
  text: string
  onChange: (next: string) => void
}) {
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
  const [rev, setRev] = useState(0)
  const model = parseTeamGridBlock(text)

  const emit = (next: string) => onChange(next)
  const emitRemount = (next: string) => {
    onChange(next)
    setRev((r) => r + 1)
  }
  // Reorder/remove reuse team-photos, which address a member by ref; refs come
  // from the SAME block text so positions stay aligned.
  const refFor = (i: number) => extractTeamMembers(textRef.current)[i] ?? null
  const canRemove = model.members.length > 2

  return (
    <BlockShell heading={model.heading}>
      {model.members.map((m, i) => (
        <div
          key={`${rev}-${i}`}
          className="rounded-md border border-border-default bg-surface-card p-3 space-y-2"
        >
          <label className="block">
            <span className={fieldLabel}>Name &amp; credentials</span>
            <input
              type="text"
              defaultValue={m.name}
              onChange={(e) => emit(setTeamMemberField(textRef.current, i, 'name', e.target.value))}
              className={`${fieldInput} font-heading font-semibold`}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Job title (optional)</span>
            <input
              type="text"
              defaultValue={m.title ?? ''}
              placeholder="Managing Partner"
              onChange={(e) => emit(setTeamMemberField(textRef.current, i, 'title', e.target.value))}
              className={fieldInput}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Bio</span>
            <textarea
              defaultValue={m.bio}
              onChange={(e) => emit(setTeamMemberField(textRef.current, i, 'bio', e.target.value))}
              className={fieldTextarea}
            />
          </label>
          <p className="text-[11px] font-body text-text-muted">
            Photos are managed in the Media tab.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                const ref = refFor(i)
                if (ref) emitRemount(moveTeamMember(textRef.current, ref, 'up'))
              }}
              disabled={i === 0}
              className={ctrlBtn}
            >
              Move up
            </button>
            <button
              type="button"
              onClick={() => {
                const ref = refFor(i)
                if (ref) emitRemount(moveTeamMember(textRef.current, ref, 'down'))
              }}
              disabled={i === model.members.length - 1}
              className={ctrlBtn}
            >
              Move down
            </button>
            <button
              type="button"
              disabled={!canRemove}
              title={canRemove ? undefined : 'A team section needs at least two members'}
              onClick={() => {
                const ref = refFor(i)
                if (ref && confirm(`Remove ${m.name} from the team section?`)) {
                  emitRemount(removeTeamMember(textRef.current, ref))
                }
              }}
              className={removeBtn}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => emitRemount(addTeamMember(textRef.current))} className={addBtn}>
        + Add member
      </button>
    </BlockShell>
  )
}

// Returns true when this block text is one this editor can handle.
export function isStructuredBlockEditable(blockText: string): boolean {
  return cardBlockId(blockText) !== null || TEAM_GRID_RE.test(blockText)
}

export default function StructuredBlockEditor({
  text,
  onChange,
}: {
  text: string
  onChange: (next: string) => void
}) {
  if (TEAM_GRID_RE.test(text)) return <TeamEditor text={text} onChange={onChange} />
  if (cardBlockId(text)) return <CardEditor text={text} onChange={onChange} />
  return null
}
