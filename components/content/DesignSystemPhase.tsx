'use client'

import { useState, useEffect, useCallback } from 'react'
import SwatchEditor from './SwatchEditor'
import TokenChipGroup from './TokenChipGroup'
import TypePairingPicker from './TypePairingPicker'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens, Roundness, Density, VisualFeel } from '@/types/design-tokens'
import { findPairing } from '@/lib/content/type-pairing-catalog'
import { suggestDesignTokens } from '@/lib/content/suggest-design-tokens'
import type { SessionSchema } from '@/types/session-schema'

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

export default function DesignSystemPhase({
  sessionId,
  contentJobId,
  existingPalette,
  existingTokens,
  brand,
  logoUrl = null,
  isLocked = false,
}: {
  sessionId: string
  contentJobId: string
  existingPalette: PaletteData | null
  existingTokens: DesignTokens | null
  brand: SessionSchema['brand'] | undefined
  logoUrl?: string | null
  isLocked?: boolean
}) {
  const [palette, setPalette] = useState<PaletteData | null>(existingPalette)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromLogo, setFromLogo] = useState<boolean | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(logoUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Computed suggestion (changes if palette changes).
  const suggested = suggestDesignTokens(brand, palette)
  const [tokens, setTokens] = useState<DesignTokens>(existingTokens ?? suggested)

  const setPairing = useCallback((id: string) => {
    const p = findPairing(id)
    if (!p) return
    setTokens(prev => ({
      ...prev,
      typePairing: { id: p.id, headingFont: p.headingFont, bodyFont: p.bodyFont, label: p.label },
    }))
  }, [])

  const generatePalette = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/palette/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Palette generation failed')
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
    // Data-loading-on-mount pattern; setState happens only after the async
    // fetch in generatePalette resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!palette) generatePalette()
  }, [palette, generatePalette])

  async function handleLogoUpload(file: File) {
    setUploading(true); setUploadError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/sessions/${sessionId}/logo`, { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Logo upload failed')
      setLogoPreview(prev => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
      await generatePalette()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function saveAll() {
    if (!palette) return
    setSaving(true); setError(null)
    try {
      const body: Record<string, unknown> = { palette, design_tokens: tokens }
      if (!isLocked) body.phase = 2
      const res = await fetch(`/api/content-jobs/${contentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save')
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

  if (!palette) return null

  const minContrast = contrastRatio(palette.nearBlack.hex, palette.nearWhite.hex)
  const passesContrast = minContrast >= 4.5

  return (
    <div className="space-y-8">
      {/* Sub-step 1: Palette */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">1. Color Palette</h3>
        <div className="flex items-center gap-4 rounded-lg border border-border-default bg-surface-card p-3">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-default bg-surface-subtle">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-[10px] text-text-muted font-body text-center px-1">No logo</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-heading font-semibold text-text-primary">
              {logoPreview ? 'Logo' : 'Upload a logo'}
            </p>
            <p className="text-xs text-text-muted font-body mt-0.5">
              {fromLogo === false
                ? 'No logo yet — upload one to derive the palette, or edit swatches below.'
                : 'Palette derived from the logo. Re-upload to regenerate, or edit swatches below.'}
              {' '}PNG, JPG, WebP, or SVG.
            </p>
            {uploadError && <p className="text-xs text-error font-body mt-1">{uploadError}</p>}
          </div>
          <label className={`flex-shrink-0 rounded-pill bg-brand-cyan px-3.5 py-1.5 text-xs font-heading font-semibold text-white transition-all hover:bg-brand-cyan/90 ${uploading || saving ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
            {uploading ? 'Uploading…' : logoPreview ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              disabled={uploading || saving}
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void handleLogoUpload(f)
              }}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {SWATCH_KEYS.map(key => (
            <SwatchEditor
              key={key}
              name={palette[key].name}
              hex={palette[key].hex}
              onChange={(hex) => setPalette(prev => (prev ? { ...prev, [key]: { ...prev[key], hex } } : prev))}
            />
          ))}
        </div>
        <div className={`text-sm font-body ${passesContrast ? 'text-success' : 'text-error'}`}>
          Near-black / near-white contrast: {minContrast.toFixed(2)} {passesContrast ? '(WCAG AA)' : '(below WCAG AA — pick higher-contrast neutrals)'}
        </div>
      </section>

      {/* Sub-step 2: Type pairing */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">2. Type Pairing</h3>
        <TypePairingPicker
          selectedId={tokens.typePairing.id}
          suggestedId={suggested.typePairing.id}
          onChange={setPairing}
          disabled={saving}
        />
      </section>

      {/* Sub-step 3: Roundness */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">3. Roundness</h3>
        <TokenChipGroup<Roundness>
          label=""
          value={tokens.roundness}
          options={[
            { value: 'sharp', label: 'Sharp', hint: '4px' },
            { value: 'soft',  label: 'Soft',  hint: '8px' },
            { value: 'pill',  label: 'Pill',  hint: '9999px' },
          ]}
          onChange={(r) => setTokens(prev => ({ ...prev, roundness: r }))}
          disabled={saving}
        />
      </section>

      {/* Sub-step 4: Density */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">4. Density</h3>
        <TokenChipGroup<Density>
          label=""
          value={tokens.density}
          options={[
            { value: 'tight',    label: 'Tight' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'airy',     label: 'Airy' },
          ]}
          onChange={(d) => setTokens(prev => ({ ...prev, density: d }))}
          disabled={saving}
        />
      </section>

      {/* Sub-step 5: Visual feel */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">5. Visual Feel</h3>
        <TokenChipGroup<VisualFeel>
          label=""
          value={tokens.visualFeel}
          options={[
            { value: 'classic',   label: 'Classic' },
            { value: 'modern',    label: 'Modern' },
            { value: 'editorial', label: 'Editorial' },
          ]}
          onChange={(v) => setTokens(prev => ({ ...prev, visualFeel: v }))}
          disabled={saving}
        />
      </section>

      {error && <div className="text-sm text-error font-body">{error}</div>}

      <button
        type="button"
        disabled={saving || !passesContrast}
        onClick={saveAll}
        className="bg-brand-cyan text-white font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : isLocked ? 'Save changes' : 'Lock Design System & Continue'}
      </button>
    </div>
  )
}
