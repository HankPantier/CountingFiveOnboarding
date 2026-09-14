// Pure matching/render helpers for the global "no-go phrases" system. Kept free
// of any DB/Next imports so validators, generators, and tests can use them
// without pulling in the Supabase server client. The DB-backed loader lives in
// no-go-phrases.ts (which re-exports these).

export interface NoGoPhrase {
  id: string
  phrase: string
}

// Dedupe + match key. Lowercase, collapse internal runs of whitespace to a
// single space, trim. Matching normalizes both the phrase and the haystack this
// way, so "Receipts  in a\nshoebox" matches "receipts in a shoebox".
export function normalizeNoGo(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Return the ORIGINAL phrases whose normalized form appears anywhere in the
// normalized text. Case-insensitive, whitespace-tolerant substring match.
export function findNoGoHits(text: string, phrases: string[]): string[] {
  if (!text || phrases.length === 0) return []
  const haystack = normalizeNoGo(text)
  const hits: string[] = []
  for (const phrase of phrases) {
    const needle = normalizeNoGo(phrase)
    if (needle && haystack.includes(needle)) hits.push(phrase)
  }
  return hits
}

// Prompt fragment injected into every async generator's system prompt. Returns
// '' for an empty list so an unconfigured list leaves prompts (and the cached
// static prefix) byte-for-byte unchanged.
export function buildNoGoPromptBlock(phrases: string[]): string {
  const clean = phrases.map(p => p.trim()).filter(Boolean)
  if (clean.length === 0) return ''
  return `NO-GO PHRASES (hard ban — never use these exact phrases or a close variant, in any casing, anywhere in the copy):
${clean.map(p => `- "${p}"`).join('\n')}`
}
