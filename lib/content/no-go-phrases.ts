import { createServerClient } from '@/lib/supabase/server'
import type { NoGoPhrase } from './no-go-match'

// Global "no-go phrases": the single admin-curated list of phrases that must
// NEVER appear in any AI-generated content across every client site (e.g. the
// cliché "receipts in a shoebox"). This module owns the DB-backed loader; the
// pure match/render helpers live in no-go-match.ts and are re-exported here so
// callers have one import site. Backed by the `no_go_phrases` table
// (migration 069) and managed from Admin → No-go phrases.

export type { NoGoPhrase } from './no-go-match'
export { normalizeNoGo, findNoGoHits, buildNoGoPromptBlock } from './no-go-match'

// Short in-memory cache so a batch content run (dozens of pages) doesn't re-query
// per generation call. The list changes only when an admin edits it, so a brief
// TTL is safe; a stale entry lasts at most CACHE_TTL_MS. The admin write routes
// call clearNoGoCache() so edits take effect immediately.
const CACHE_TTL_MS = 60_000
let cache: { at: number; phrases: NoGoPhrase[] } | null = null

export function clearNoGoCache(): void {
  cache = null
}

export async function loadNoGoPhrases(): Promise<NoGoPhrase[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.phrases

  // Fail open on ANY failure (client construction, query error, misconfigured
  // env): the no-go list must never break or block content generation. Serve
  // the last good snapshot if we have one, else an empty list.
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('no_go_phrases')
      .select('id, phrase')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    const phrases: NoGoPhrase[] = data ?? []
    cache = { at: now, phrases }
    return phrases
  } catch (err) {
    console.warn('[no-go] load failed:', err instanceof Error ? err.message : String(err))
    return cache?.phrases ?? []
  }
}
