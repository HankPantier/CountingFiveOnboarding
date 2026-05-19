import type { SessionSchema } from '@/types/session-schema'

type CurrentSitemapEntry = NonNullable<SessionSchema['current_sitemap']>[number]

type ConfirmedSitemapEntry = {
  url: string
  title: string
  parent?: string
  status?: string  // 'new' | 'update' | 'existing' | 'redirect' | 'consolidate'
}

export type RedirectIssue = {
  severity: 'error' | 'warning'
  oldUrl: string
  reason: string
}

export type RedirectsResult = {
  csv: string
  issues: RedirectIssue[]
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const COMMENT_HEADER =
  '# This file controls 301 redirects for the live site.\n' +
  '# Edit, add, or remove rows; changes take effect on the next `npm run build` (or `npm run dev`).\n' +
  '# Format: old_url,new_url,status_code,reason\n' +
  '# Lines starting with # are ignored by the Next.js redirect loader.\n'

const CSV_HEADER = 'old_url,new_url,status_code,reason\n'

// Emit a CSV migration plan from the firm's current site to the new sitemap.
// Validates redirect targets against the confirmed sitemap and returns both
// the CSV and a list of issues. Warn-and-proceed: issues never block the CSV.
export function buildRedirectsCsv(
  currentSitemap: CurrentSitemapEntry[] | undefined,
  confirmedSitemap: ConfirmedSitemapEntry[] | undefined
): RedirectsResult {
  const header = COMMENT_HEADER + CSV_HEADER
  const issues: RedirectIssue[] = []

  if (!Array.isArray(currentSitemap) || currentSitemap.length === 0) {
    return { csv: header, issues }
  }

  // Build the set of valid destination URLs from the new sitemap.
  // Entries with status 'redirect' or 'consolidate' are themselves being
  // redirected away, so they are not valid landing pages.
  const validNewUrls = new Set<string>(
    (confirmedSitemap ?? [])
      .filter(e => !['redirect', 'consolidate'].includes(e.status ?? ''))
      .map(e => e.url)
  )

  const rows: string[] = []

  for (const entry of currentSitemap) {
    // Skip entries that aren't redirect candidates (existing behaviour)
    if (!entry?.url) continue
    if (entry.live === false) continue

    const isRedirectAction =
      entry.action === 'redirect' || entry.action === 'consolidate'

    if (isRedirectAction) {
      // Error: action requires a destination but none was set
      if (!entry.new_url) {
        issues.push({
          severity: 'error',
          oldUrl: entry.url,
          reason: `action '${entry.action}' but no new_url specified`,
        })
        continue // drop from CSV
      }

      // Error: destination set but it doesn't exist in the new sitemap
      if (!validNewUrls.has(entry.new_url)) {
        issues.push({
          severity: 'error',
          oldUrl: entry.url,
          reason: `new_url '${entry.new_url}' does not exist in the new sitemap`,
        })
        continue // drop from CSV
      }

      // Valid redirect row
      const reason =
        entry.action === 'consolidate'
          ? `consolidated into ${entry.new_url}`
          : 'redirected to new structure'

      rows.push(
        [csvEscape(entry.url), csvEscape(entry.new_url), '301', csvEscape(reason)].join(',')
      )
    } else {
      // Warning pass: 'keep' (or any other non-redirect action) whose URL
      // doesn't appear in the new sitemap — might become a broken old link.
      if (entry.url && !validNewUrls.has(entry.url)) {
        issues.push({
          severity: 'warning',
          oldUrl: entry.url,
          reason: `old URL marked '${entry.action ?? 'keep'}' but not present in new sitemap — broken old link?`,
        })
      }
    }
  }

  const csv = header + rows.join('\n') + (rows.length > 0 ? '\n' : '')
  return { csv, issues }
}
