// Alternating media rule: image-bearing sections (content-split, checklist with
// an image, after a hero-split opener) must swap sides down the page. Section
// indices come from describeSections so they line up with setSectionVariant.
import { randomUUID } from 'node:crypto'
import { describeSections } from '@/lib/editor/section-reorder'
import type { Finding } from '@/types/qa-review'

type Side = 'L' | 'R'

function sectionSide(blockId: string, variant: string | null | undefined): Side | null {
  if (blockId === 'content-split') return variant === 'image-left' ? 'L' : 'R'
  if (blockId === 'checklist-section') {
    if (variant === 'with-image-left') return 'L'
    if (variant === 'with-image' || variant === 'with-image-right') return 'R'
  }
  return null
}

function flippedVariant(blockId: string, to: Side): string {
  if (blockId === 'content-split') return to === 'L' ? 'image-left' : 'image-right'
  return to === 'L' ? 'with-image-left' : 'with-image-right'
}

export function checkMediaAlternation(
  body: string,
  hero: { block: string | null; variant: string | null },
): Finding[] {
  const findings: Finding[] = []
  let prev: Side | null = hero.block === 'hero-split' ? (hero.variant === 'image-left' ? 'L' : 'R') : null
  describeSections(body).sections.forEach((s, i) => {
    if (!s.parseable) return
    const side = sectionSide(s.blockId, s.variant)
    if (!side) return
    if (prev && side === prev) {
      const want: Side = prev === 'L' ? 'R' : 'L'
      findings.push({
        id: randomUUID(),
        agent: 'rules',
        severity: 'low',
        kind: 'media_side',
        quote: s.heading,
        message: `"${s.heading}" puts its image on the same side as the section before it; flipped to ${want === 'L' ? 'left' : 'right'} so images alternate.`,
        variantFix: { sectionIndex: i, variant: flippedVariant(s.blockId, want) },
        safety: 'auto',
        status: 'open',
      })
      prev = want
    } else {
      prev = side
    }
  })
  return findings
}
