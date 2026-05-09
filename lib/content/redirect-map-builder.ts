import type { SessionSchema } from '@/types/session-schema'

type CurrentSitemapEntry = NonNullable<SessionSchema['current_sitemap']>[number]

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// Emit a CSV migration plan from the firm's current site to the new sitemap.
// Only entries with action 'redirect' or 'consolidate' produce rows. Always
// emits the header so a downstream dev/automation knows the file is intentional.
export function buildRedirectsCsv(currentSitemap: CurrentSitemapEntry[] | undefined): string {
  const header = 'old_url,new_url,status_code,reason\n'
  if (!Array.isArray(currentSitemap) || currentSitemap.length === 0) return header

  const rows: string[] = []
  for (const entry of currentSitemap) {
    if (!entry?.url) continue
    if (entry.live === false) continue
    if (entry.action !== 'redirect' && entry.action !== 'consolidate') continue
    if (!entry.new_url) continue

    const reason = entry.action === 'consolidate'
      ? `consolidated into ${entry.new_url}`
      : 'redirected to new structure'

    rows.push(
      [csvEscape(entry.url), csvEscape(entry.new_url), '301', csvEscape(reason)].join(',')
    )
  }

  return header + rows.join('\n') + (rows.length > 0 ? '\n' : '')
}
