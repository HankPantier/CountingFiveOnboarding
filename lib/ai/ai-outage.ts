// Pure, client-safe. The account-level AI outages the admin shell banners: a
// credit outage and an Anthropic API usage limit both pause EVERY AI feature at
// once, so one proactive banner beats a stream of per-action failures.

export type AiOutageKind = 'credit' | 'usage_limit'

export type AiOutageBannerCopy = { title: string; body: string; resolveLabel: string }

export function isAiOutageKind(value: unknown): value is AiOutageKind {
  return value === 'credit' || value === 'usage_limit'
}

// The provider's "regain access on YYYY-MM-DD at 00:00 UTC" date, if it is a
// real calendar date (the DB column is `date`; anything else is dropped).
export function normalizeResetDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value
}

// A usage limit whose reset date has arrived (00:00 UTC that day) is over —
// the banner must not outlive it even inside the self-heal window.
export function usageLimitHasReset(resetDate: string | null, nowMs: number): boolean {
  const date = normalizeResetDate(resetDate)
  return date !== null && nowMs >= Date.parse(`${date}T00:00:00Z`)
}

export function aiOutageBannerCopy(kind: AiOutageKind, resetDate: string | null = null): AiOutageBannerCopy {
  if (kind === 'usage_limit') {
    const date = normalizeResetDate(resetDate)
    return {
      title: 'AI features are paused',
      body: date
        ? `The Anthropic API usage limit has been reached — AI features are paused until ${date} or until the limit is raised in the Anthropic Console.`
        : 'The Anthropic API usage limit has been reached — AI features are paused until the limit resets or is raised in the Anthropic Console.',
      resolveLabel: "I've raised the limit",
    }
  }
  return {
    title: 'AI features are paused',
    body: "The account's Claude API credits have run out. Add credits in the Anthropic console to restore content generation, AI editing, and audits. Retrying won't help until then.",
    resolveLabel: "I've added credits",
  }
}
