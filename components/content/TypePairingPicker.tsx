'use client'

import { useMemo } from 'react'
import { pairingsByFeel, findPairing, type TypePairing } from '@/lib/content/type-pairing-catalog'

const FEEL_ORDER: TypePairing['feel'][] = ['modern', 'editorial', 'classic', 'warm']
const FEEL_LABEL: Record<TypePairing['feel'], string> = {
  modern: 'Modern', editorial: 'Editorial', classic: 'Classic', warm: 'Warm',
}

export default function TypePairingPicker({
  selectedId,
  suggestedId,
  onChange,
  disabled = false,
}: {
  selectedId: string
  suggestedId: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const groups = useMemo(() => pairingsByFeel(), [])
  const selected = findPairing(selectedId)
  const isSuggested = selectedId === suggestedId

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-text-primary font-heading">Type Pairing</div>

      {selected && (
        <div className="border border-border-default rounded-lg p-4 bg-surface-subtle">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-base font-semibold" style={{ fontFamily: selected.headingFont }}>
                {selected.label}
              </div>
              <div className="text-sm text-text-muted font-body" style={{ fontFamily: selected.bodyFont }}>
                {selected.headingFont} + {selected.bodyFont}
              </div>
            </div>
            {isSuggested && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand-navy text-white">
                Suggested
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text-muted font-body">{selected.description}</p>
        </div>
      )}

      <select
        value={selectedId}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full border border-border-default rounded-md px-3 py-2 text-sm font-body bg-white"
      >
        {FEEL_ORDER.map(feel => (
          <optgroup key={feel} label={FEEL_LABEL[feel]}>
            {groups[feel].map(p => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.headingFont}
                {p.headingFont !== p.bodyFont ? ` + ${p.bodyFont}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
