'use client'

import { useRef } from 'react'
import type { ThemeLogo } from '@/app/api/edit/[id]/theme/_theme'
import type { PreviewLogos } from '@/lib/theme-preview/compose-srcdoc'

export type LogoSlot = 'primary' | 'footer'

const ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml'

function SlotButton({
  slot,
  label,
  image,
  hasFile,
  disabled,
  onPick,
}: {
  slot: LogoSlot
  label: string
  image: string | null
  hasFile: boolean
  disabled: boolean
  onPick: (slot: LogoSlot, file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        title={hasFile ? `Replace the ${label.toLowerCase()} logo` : `Upload a ${label.toLowerCase()} logo`}
        className={[
          'flex h-7 items-center gap-1.5 rounded-pill border border-border-default px-2 transition-colors hover:border-brand-cyan disabled:cursor-not-allowed disabled:opacity-50',
          slot === 'footer' ? 'bg-brand-navy' : 'bg-surface-card',
        ].join(' ')}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- inline data: URL thumbnail
          <img src={image} alt={`${label} logo`} className="h-4 max-w-[72px] object-contain" />
        ) : null}
        <span
          className={[
            'font-heading text-[11px] font-semibold',
            slot === 'footer' ? 'text-text-inverse' : 'text-text-secondary',
          ].join(' ')}
        >
          {hasFile ? label : `+ ${label}`}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onPick(slot, file)
        }}
      />
    </>
  )
}

// Theme Studio logo slots: upload/replace the header (primary) logo and an
// optional footer variant. Each upload commits to the draft (brand.json points
// at the new file); a primary upload also replaces the onboarding logo asset.
export default function LogoControls({
  logo,
  images,
  saving,
  onUpload,
  onRemoveFooter,
}: {
  logo: ThemeLogo | undefined
  images: PreviewLogos
  saving: boolean
  onUpload: (slot: LogoSlot, file: File) => void
  onRemoveFooter: () => void
}) {
  const disabled = saving || !logo
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-heading text-[11px] font-semibold text-text-secondary">Logo</span>
      <SlotButton
        slot="primary"
        label="Header"
        image={images.primary}
        hasFile={!!logo?.primary}
        disabled={disabled}
        onPick={onUpload}
      />
      <SlotButton
        slot="footer"
        label="Footer"
        image={images.footer}
        hasFile={!!logo?.footer}
        disabled={disabled}
        onPick={onUpload}
      />
      {logo?.footer && (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemoveFooter}
          title="Remove the footer logo — the footer shows the header logo instead"
          className="rounded-pill px-1.5 font-body text-[11px] text-text-muted transition-colors hover:text-brand-navy disabled:opacity-50"
        >
          Use header
        </button>
      )}
    </div>
  )
}
