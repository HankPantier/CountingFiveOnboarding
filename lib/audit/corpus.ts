// Shared prioritized-corpus builder for AI passes over a completed audit's
// crawled content. Originally lived in lib/session-draft/draft-from-audit.ts;
// extracted here so the intelligence modules and the session draft share one
// implementation of "which pages matter most, capped to a token budget".
import type { AuditResult } from './types'

// ~100k tokens of page text (Sonnet has plenty of headroom; leaves room for the
// system prompt + output). page_text_sample is ≤3000 chars/page.
export const CORPUS_CHAR_BUDGET = 400_000

export interface CorpusPage {
  url: string
  title: string
  text: string
}

const PRIORITY = [
  { re: /\/$|^\/$|home/i, score: 100 },
  { re: /about|who-we-are|our-(firm|story|team)/i, score: 80 },
  { re: /service|what-we-do|solutions|practice/i, score: 70 },
  { re: /team|staff|people|leadership|attorneys|advisors/i, score: 60 },
  { re: /industr|niche|sector|who-we-serve/i, score: 55 },
  { re: /contact|locations?|offices?/i, score: 50 },
  { re: /pricing|fees/i, score: 40 },
]

export function pagePriority(url: string, title: string): number {
  const hay = `${url} ${title}`.toLowerCase()
  let best = 10
  for (const p of PRIORITY) if (p.re.test(hay)) best = Math.max(best, p.score)
  return best
}

/** Build a relevance-ordered, budget-capped corpus from the audit's per-page
 * text samples. Highest-signal pages (home/about/services) come first. */
export function buildCorpus(
  result: AuditResult,
  charBudget = CORPUS_CHAR_BUDGET,
): { pages: CorpusPage[]; chars: number } {
  const summaries = result.page_analysis_summary ?? []
  const analyzed = result.raw?.analyzed ?? []
  const candidates: CorpusPage[] = summaries.map((s, i) => ({
    url: s.url,
    title: s.title,
    text: (analyzed[i]?.page_text_sample || s.content_snippet || '').trim(),
  }))
  candidates.sort((a, b) => pagePriority(b.url, b.title) - pagePriority(a.url, a.title))

  const pages: CorpusPage[] = []
  let chars = 0
  for (const c of candidates) {
    if (!c.text) continue
    if (chars + c.text.length > charBudget && pages.length > 0) break
    pages.push(c)
    chars += c.text.length
  }
  return { pages, chars }
}
