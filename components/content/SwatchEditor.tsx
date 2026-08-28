'use client'

import { useRef } from 'react'

export default function SwatchEditor({
  name,
  hex,
  onChange,
}: {
  name: string
  hex: string
  onChange: (hex: string) => void
}) {
  const pickerRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="w-11 h-11 rounded-lg border border-border-default shadow-subtle cursor-pointer flex-shrink-0"
        style={{ backgroundColor: hex }}
        onClick={() => pickerRef.current?.click()}
        aria-label={`Pick color for ${name}`}
      />
      <input
        ref={pickerRef}
        type="color"
        value={hex}
        onChange={e => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-heading font-semibold text-text-secondary mb-1">{name}</div>
        <input
          type="text"
          value={hex}
          aria-label={`Hex color value for ${name}`}
          onChange={e => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
          }}
          onBlur={e => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
          }}
          className="w-full px-2 py-1 text-sm font-mono bg-surface-subtle border border-border-default rounded text-text-primary"
          maxLength={7}
        />
      </div>
    </div>
  )
}
