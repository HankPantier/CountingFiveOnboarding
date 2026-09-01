// Pure date-range resolution for the Token Usage screens. A URL carries either
// a named preset (?range=30d) or a custom window (?range=custom&from=&to=). The
// resolver turns that into concrete ISO bounds the loader applies to the
// token_usage query, plus a human label. Kept pure + dependency-free so it's
// unit-testable and safe to import anywhere.

export type DateRangeParams = { range?: string; from?: string; to?: string }

export type ResolvedRange = {
  key: RangeKey
  // Inclusive ISO bounds; undefined means "unbounded on this side" (All time).
  fromISO?: string
  toISO?: string
  label: string
  // Echo the raw custom inputs back so the picker can rehydrate its date fields.
  from?: string
  to?: string
}

export const RANGE_KEYS = ['all', 'mtd', '30d', '90d', 'ytd', 'custom'] as const
export type RangeKey = (typeof RANGE_KEYS)[number]

const DAY_MS = 24 * 60 * 60 * 1000
const isYmd = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function resolveDateRange(params: DateRangeParams, nowMs: number): ResolvedRange {
  const key: RangeKey = (RANGE_KEYS as readonly string[]).includes(params.range ?? '')
    ? (params.range as RangeKey)
    : 'all'
  const now = new Date(nowMs)
  const toNow = new Date(nowMs).toISOString()

  switch (key) {
    case 'custom': {
      const from = isYmd(params.from) ? params.from : undefined
      const to = isYmd(params.to) ? params.to : undefined
      const label = from && to ? `${from} → ${to}` : from ? `From ${from}` : to ? `Through ${to}` : 'Custom'
      return {
        key,
        fromISO: from ? `${from}T00:00:00.000Z` : undefined,
        toISO: to ? `${to}T23:59:59.999Z` : undefined,
        label,
        from,
        to,
      }
    }
    case 'mtd': {
      const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      return { key, fromISO: new Date(start).toISOString(), toISO: toNow, label: 'This month' }
    }
    case 'ytd': {
      const start = Date.UTC(now.getUTCFullYear(), 0, 1)
      return { key, fromISO: new Date(start).toISOString(), toISO: toNow, label: 'Year to date' }
    }
    case '30d':
    case '90d': {
      const days = key === '30d' ? 30 : 90
      return { key, fromISO: new Date(nowMs - days * DAY_MS).toISOString(), toISO: toNow, label: `Last ${days} days` }
    }
    default:
      return { key: 'all', label: 'All time' }
  }
}
