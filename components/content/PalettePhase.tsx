'use client'

import { useState, useEffect, useCallback } from 'react'
import SwatchEditor from './SwatchEditor'
import type { PaletteData } from '@/types/palette'

// Simple contrast ratio calculation (WCAG)
function luminance(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g)?.map(c => {
    const v = parseInt(c, 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }) ?? [0, 0, 0]
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1)
  const l2 = luminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const SWATCH_KEYS: (keyof PaletteData)[] = [
  'primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite',
]

export default function PalettePhase({
  sessionId,
  contentJobId,
  existingPalette,
}: {
  sessionId: string
  contentJobId: string
  existingPalette: PaletteData | null
}) {
  const [palette, setPalette] = useState<PaletteData | null>(existingPalette)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromLogo, setFromLogo] = useState<boolean | null>(null)

  const generatePalette = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/palette/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to generate palette')
      }
      const data = await res.json()
      setPalette(data.palette)
      setFromLogo(data.fromLogo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate palette')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!palette) generatePalette()
  }, [palette, generatePalette])

  const updateSwatch = (key: keyof PaletteData, hex: string) => {
    if (!palette) return
    setPalette({ ...palette, [key]: { ...palette[key], hex } })
  }

  const lockPalette = async () => {
    if (!palette) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ palette, phase: 2 }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save palette')
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="text-sm text-text-muted font-body">Extracting palette from logo...</div>
      </div>
    )
  }

  if (!palette) {
    return (
      <div className="py-6 text-center">
        <div className="text-sm text-text-muted font-body mb-3">No palette generated yet.</div>
        <button
          onClick={generatePalette}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all hover:bg-brand-navy-dark"
        >
          Generate Palette
        </button>
      </div>
    )
  }

  const contrast = contrastRatio(palette.nearBlack.hex, palette.nearWhite.hex)
  const contrastPasses = contrast >= 4.5

  return (
    <div className="space-y-4">
      {fromLogo === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-body rounded-lg px-4 py-2">
          No logo found — showing default brand palette. Edit colors below or upload a logo first.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {SWATCH_KEYS.map(key => (
          <SwatchEditor
            key={key}
            name={palette[key].name}
            hex={palette[key].hex}
            onChange={hex => updateSwatch(key, hex)}
          />
        ))}
      </div>

      <div className={`flex items-center gap-2 text-sm font-body px-3 py-2 rounded-lg ${
        contrastPasses ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}>
        <span className="font-semibold">{contrastPasses ? '\u2713' : '\u2717'}</span>
        <span>
          Text / Dark on Background / Light: {contrast.toFixed(1)}:1
          {contrastPasses ? ' (WCAG AA)' : ' (below 4.5:1 — adjust colors)'}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-body rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={lockPalette}
          disabled={saving || !contrastPasses}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Lock Palette & Continue'}
        </button>
        <button
          onClick={generatePalette}
          disabled={loading}
          className="border border-border-default text-text-secondary font-heading font-semibold text-sm px-5 py-3 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
        >
          Regenerate
        </button>
      </div>
    </div>
  )
}
