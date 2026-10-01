import { randomUUID } from 'node:crypto'
import { validateContent } from '@/lib/content/anti-slop-validator'
import { findNoGoHits } from '@/lib/content/no-go-match'
import { validateHeroSubhead, validateFaqAnswers } from '@/lib/content/output-validators'
import type { Finding } from '@/types/qa-review'

function f(kind: string, quote: string, message: string): Finding {
  return { id: randomUUID(), agent: 'rules', severity: 'med', kind, quote, message, safety: 'flag', status: 'open' }
}

export function checkCopy(args: {
  body: string
  heroSubhead: string | null
  faqBlock: unknown
  noGoPhrases: string[]
  avoidPhrases: string[]
}): Finding[] {
  const out: Finding[] = []
  const seen = new Set<string>()
  const push = (phrase: string, why: string) => {
    const key = phrase.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(f('copy_banned_phrase', phrase, why))
  }
  for (const hit of findNoGoHits(args.body, args.avoidPhrases)) push(hit, `"${hit}" is on this client's avoid list.`)

  // validateContent's flagged[] mixes three shapes: a quoted "No-go phrase:
  // ..." wrapper, a bare BANNED_PHRASES entry that's a literal body substring,
  // and free-text structural/AI-tell diagnostics with no body-verbatim
  // snippet to quote. Finding.quote must be a verbatim page snippet, so only
  // the first two extract a quote; the rest become page-level findings.
  const lowerBody = args.body.toLowerCase()
  for (const flagged of validateContent(args.body, args.noGoPhrases).flagged) {
    const noGoMatch = /^No-go phrase: "(.+)"$/.exec(flagged)
    if (noGoMatch) {
      push(noGoMatch[1], `"${noGoMatch[1]}" is a banned no-go phrase.`)
      continue
    }
    const idx = lowerBody.indexOf(flagged.toLowerCase())
    if (idx !== -1) {
      const quote = args.body.slice(idx, idx + flagged.length)
      push(quote, `"${quote}" reads as generic AI copy.`)
      continue
    }
    // Structural/AI-tell diagnostic (e.g. "Three or more consecutive
    // sentences open with..."): no verbatim snippet, not deduped against
    // the phrase set above.
    out.push({
      id: randomUUID(),
      agent: 'rules',
      severity: 'med',
      kind: 'copy_ai_pattern',
      quote: '',
      message: flagged,
      safety: 'flag',
      status: 'open',
    })
  }
  const sub = validateHeroSubhead(args.heroSubhead)
  if (sub) out.push(f('hero_subhead', args.heroSubhead ?? '', sub))
  // validateFaqAnswers's param type is read from output-validators.ts:38 — pass the stored faq_block through.
  for (const issue of validateFaqAnswers(args.faqBlock as Parameters<typeof validateFaqAnswers>[0])) {
    out.push(f('faq_answer', '', issue))
  }
  return out
}
