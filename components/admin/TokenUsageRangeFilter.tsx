'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { RANGE_KEYS, type RangeKey } from '@/lib/tokens/date-range'

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'mtd', label: 'This month' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
]

// Date-range selector shared across the Token Usage pages. Writes ?range= (and
// ?from/&to= for custom) onto the CURRENT path, so it works on every tab and the
// server pages re-aggregate to the window. Reads the active selection from the
// URL so it survives navigation and shareable links.
export default function TokenUsageRangeFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const activeKey: RangeKey = (RANGE_KEYS as readonly string[]).includes(params.get('range') ?? '')
    ? (params.get('range') as RangeKey)
    : 'all'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''

  function apply(next: { range: RangeKey; from?: string; to?: string }) {
    const sp = new URLSearchParams()
    if (next.range !== 'all') sp.set('range', next.range)
    if (next.range === 'custom') {
      if (next.from) sp.set('from', next.from)
      if (next.to) sp.set('to', next.to)
    }
    const q = sp.toString()
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false })
  }

  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-pill text-xs font-heading font-semibold transition-colors ${
      active
        ? 'bg-brand-cyan text-text-inverse'
        : 'bg-surface-subtle text-text-secondary hover:text-text-primary'
    }`

  const dateInput =
    'rounded-lg border border-border-default bg-surface-card px-2.5 py-1.5 text-xs font-body text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/40'

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => apply({ range: p.key, from, to })}
            className={pill(activeKey === p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {activeKey === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-body text-text-muted">From</label>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => apply({ range: 'custom', from: e.target.value, to })}
            className={dateInput}
            aria-label="Range start date"
          />
          <label className="text-xs font-body text-text-muted">To</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => apply({ range: 'custom', from, to: e.target.value })}
            className={dateInput}
            aria-label="Range end date"
          />
        </div>
      )}
    </div>
  )
}
