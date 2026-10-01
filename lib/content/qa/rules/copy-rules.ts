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
  for (const flagged of validateContent(args.body, args.noGoPhrases).flagged) {
    const phrase = /"(.+)"/.exec(flagged)?.[1] ?? flagged
    push(phrase, flagged.startsWith('No-go') ? `"${phrase}" is a banned no-go phrase.` : `"${phrase}" reads as generic AI copy.`)
  }
  const sub = validateHeroSubhead(args.heroSubhead)
  if (sub) out.push(f('hero_subhead', args.heroSubhead ?? '', sub))
  // validateFaqAnswers's param type is read from output-validators.ts:38 — pass the stored faq_block through.
  for (const issue of validateFaqAnswers(args.faqBlock as Parameters<typeof validateFaqAnswers>[0])) {
    out.push(f('faq_answer', '', issue))
  }
  return out
}
