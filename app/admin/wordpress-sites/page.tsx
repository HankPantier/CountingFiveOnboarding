import { createServerClient } from '@/lib/supabase/server'
import AddWordpressSiteDialog from '@/components/admin/AddWordpressSiteDialog'
import WordpressSiteRow from '@/components/admin/WordpressSiteRow'
import type { WordpressSiteSummary } from '@/types/wordpress-sites'

export const dynamic = 'force-dynamic'

export default async function WordpressSitesPage() {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('wordpress_sites')
    .select('id, site_key, github_repo, enabled, created_at')
    .order('created_at', { ascending: true })

  const sites: WordpressSiteSummary[] = data ?? []
  // Absolute base for the displayed feed URLs; the client falls back to the
  // current origin when this isn't configured (e.g. local dev without the env).
  const feedBase = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  return (
    <main className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-brand-navy">WordPress Sites</h1>
          <p className="mt-1 font-body text-sm text-text-secondary">
            {sites.length} site{sites.length === 1 ? '' : 's'} pulling published blog posts from git.
            Transition-only — one-way, posts only.
          </p>
        </div>
        <AddWordpressSiteDialog feedBase={feedBase} />
      </div>

      {sites.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-surface-card p-10 text-center shadow-subtle">
          <p className="font-body text-sm text-text-secondary">
            No WordPress sites yet. Add one to generate its feed URL + secret, then install the
            Revaltus Blog Sync plugin on that site.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface-card shadow-subtle">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-default bg-surface-header">
                <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Site key</th>
                <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">GitHub repo</th>
                <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Status</th>
                <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Feed URL</th>
                <th className="px-4 py-3 text-right font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <WordpressSiteRow key={site.id} site={site} feedBase={feedBase} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
