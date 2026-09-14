import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { loadNoGoPhrases, findNoGoHits } from '@/lib/content/no-go-phrases'
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
  const { data, error } = await supabase
    .from('generated_pages')
    .select('page_title, page_url, content_markdown, meta_title, meta_description, answer_block, content_job_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve each page's owning session via its content job (job → session_id).
  const rows = data ?? []
  const { data: jobs } = await supabase.from('content_jobs').select('id, session_id')
  const sessionByJob = new Map((jobs ?? []).map(j => [j.id, j.session_id]))

  const hits: NoGoScanHit[] = []
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

  return NextResponse.json<NoGoScanResponse>({ scanned: rows.length, hits })
}
