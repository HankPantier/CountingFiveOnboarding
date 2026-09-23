import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { loadNoGoPhrases, findNoGoHits } from '@/lib/content/no-go-phrases'
import { fetchAllPages, DEFAULT_PAGE_SIZE } from '@/lib/admin/paginate'
import type { NoGoScanHit, NoGoScanResponse } from '@/types/no-go-phrases'

export const runtime = 'nodejs'
export const maxDuration = 120

// Report-only sweep: which already-generated pages currently contain a no-go
// phrase, so an operator can fix them in the editor. Scans the page body plus
// the visible SEO text fields. No mutation.
export async function GET() {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const phrases = (await loadNoGoPhrases()).map(p => p.phrase)
  if (phrases.length === 0) {
    return NextResponse.json<NoGoScanResponse>({ scanned: 0, hits: [] })
  }

  const supabase = createServerClient()

  // Resolve each page's owning session via its content job (job → session_id).
  let sessionByJob: Map<string, string>
  try {
    const jobs = await fetchAllPages<{ id: string; session_id: string }>((from, to) =>
      supabase.from('content_jobs').select('id, session_id').order('id').range(from, to)
    )
    sessionByJob = new Map(jobs.map(j => [j.id, j.session_id]))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Scan failed' }, { status: 500 })
  }

  // Page through generated_pages (PostgREST caps each response at 1000 rows —
  // a single select silently skipped everything past that) and scan each page
  // as it arrives so page bodies are never all held in memory at once.
  const hits: NoGoScanHit[] = []
  let scanned = 0
  for (let from = 0; ; from += DEFAULT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('generated_pages')
      .select('page_title, page_url, content_markdown, meta_title, meta_description, answer_block, content_job_id')
      .order('id')
      .range(from, from + DEFAULT_PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = data ?? []
    scanned += rows.length

    for (const row of rows) {
      const sessionId = sessionByJob.get(row.content_job_id)
      if (!sessionId) continue
      const haystack = [row.content_markdown, row.meta_title, row.meta_description, row.answer_block]
        .filter(Boolean)
        .join('\n')
      const matchedPhrases = findNoGoHits(haystack, phrases)
      if (matchedPhrases.length) {
        hits.push({ sessionId, pageTitle: row.page_title, pageUrl: row.page_url, matchedPhrases })
      }
    }
    if (rows.length < DEFAULT_PAGE_SIZE) break
  }

  return NextResponse.json<NoGoScanResponse>({ scanned, hits })
}
