import { createServerClient } from '@/lib/supabase/server'
import AddNoGoPhraseDialog from '@/components/admin/AddNoGoPhraseDialog'
import NoGoPhraseRow from '@/components/admin/NoGoPhraseRow'
import NoGoScanPanel from '@/components/admin/NoGoScanPanel'
import type { NoGoPhraseSummary } from '@/types/no-go-phrases'

export const dynamic = 'force-dynamic'

export default async function NoGoPhrasesPage() {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('no_go_phrases')
    .select('id, phrase, note, created_at')
    .order('created_at', { ascending: true })

  const phrases: NoGoPhraseSummary[] = data ?? []

  return (
    <main className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-brand-navy">No-go phrases</h1>
          <p className="mt-1 font-body text-sm text-text-secondary">
            {phrases.length} phrase{phrases.length === 1 ? '' : 's'} banned from all AI-generated
            content, site-wide. Matched case-insensitively; a hit forces a page to regenerate.
          </p>
        </div>
        <AddNoGoPhraseDialog />
      </div>

      {phrases.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-surface-card p-10 text-center shadow-subtle">
          <p className="font-body text-sm text-text-secondary">
            No banned phrases yet. Add one (e.g. &ldquo;receipts in a shoebox&rdquo;) to keep it out
            of every client&apos;s generated content.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface-card shadow-subtle">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-default bg-surface-header">
                <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Phrase</th>
                <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Note</th>
                <th className="px-4 py-3 text-right font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {phrases.map((p) => (
                <NoGoPhraseRow key={p.id} phrase={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NoGoScanPanel />
    </main>
  )
}
