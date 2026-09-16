import type { SessionSchema } from '@/types/session-schema'

const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

// Field paths written by an approved suggestion within the last few days. The
// MBP page highlights these as "just added"; older entries fall out of the
// window and stop being highlighted (the fade is this filter, not a timer).
// Lives outside the page component so the Date.now() read isn't flagged as an
// impure call during render.
export function recentlyAppliedPaths(
  schema: SessionSchema,
  windowMs: number = RECENT_WINDOW_MS
): string[] {
  const map = (schema._meta?.recently_applied as Record<string, string> | undefined) ?? {}
  const cutoff = Date.now() - windowMs
  return Object.entries(map)
    .filter(([, ts]) => new Date(ts).getTime() >= cutoff)
    .map(([path]) => path)
}
