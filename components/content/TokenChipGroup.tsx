'use client'

export type ChipOption<T extends string> = {
  value: T
  label: string
  hint?: string
}

export default function TokenChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: ChipOption<T>[]
  onChange: (next: T) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-text-primary font-heading">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => {
          const selected = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={[
                'px-3 py-1.5 rounded-pill text-xs font-body border transition',
                selected
                  ? 'bg-brand-navy text-white border-brand-navy'
                  : 'bg-white text-text-primary border-border-default hover:border-brand-navy',
                disabled ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
              aria-pressed={selected}
            >
              <span>{opt.label}</span>
              {opt.hint && <span className="ml-1 opacity-70">({opt.hint})</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
