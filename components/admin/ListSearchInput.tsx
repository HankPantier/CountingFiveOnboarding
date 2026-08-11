'use client'

export default function ListSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-56 rounded-pill border border-border-default bg-surface-card px-4 py-2 font-body text-xs transition-colors focus:border-brand-cyan focus:outline-none"
    />
  )
}
