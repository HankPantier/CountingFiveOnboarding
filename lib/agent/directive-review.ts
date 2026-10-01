import type { OperatorDirective, SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import type { NicheTreatment } from './niche-review'
import { applyDirectivesToSitemap } from '@/lib/content/directive-sitemap'
import { isResolved } from '@/lib/onboarding/directives'

const DIRECTIVE_GAP = /^operator_directives\[\d+\]/
const norm = (s: string): string => s.trim().toLowerCase()

// The add_offering directives as Audit Review treatments, so a "we need to add a
// new service called X" instruction flows through the exact same
// applyServiceReview/applyNicheReview path as a row the admin set by hand.
// origin 'audit' = not on the client's current site.
export function offeringTreatments(directives: OperatorDirective[]): {
  services: NicheTreatment[]
  niches: NicheTreatment[]
} {
  const services: NicheTreatment[] = []
  const niches: NicheTreatment[] = []
  for (const d of directives) {
    if (d.kind !== 'add_offering' || !d.offering || !isResolved(d)) continue
    const t: NicheTreatment = {
      name: d.offering.name,
      pageTreatment: d.offering.treatment,
      origin: 'audit',
      ...(d.offering.treatment === 'block' && d.offering.parent ? { parent: d.offering.parent } : {}),
    }
    ;(d.offering.type === 'service' ? services : niches).push(t)
  }
  return { services, niches }
}

// Pure transform: stores the confirmed directives on the MBP and applies their
// effects. Verbatim bios are written onto team[] (bioVerbatim marks them so every
// generator reproduces the text unchanged); page directives go through
// applyDirectivesToSitemap; every unresolved directive gets a Tier-2 gap whose
// field is that directive's `clarification`, so the Q&A chat asks about it and
// resolves the gap the normal way (by filling the field). Idempotent.
export function applyDirectives(
  schema: SessionSchema,
  gaps: GapItem[],
  directives: OperatorDirective[],
): { schema: SessionSchema; gaps: GapItem[] } {
  let next = structuredClone(schema)
  next.operator_directives = directives

  const verbatimBios = new Map<string, string>()
  for (const d of directives) {
    if (d.kind === 'verbatim_content' && d.teamMember && d.verbatimText && isResolved(d)) {
      verbatimBios.set(norm(d.teamMember), d.verbatimText)
    }
  }
  if (Array.isArray(next.team)) {
    for (const m of next.team) {
      if (!m?.name) continue
      const text = verbatimBios.get(norm(m.name))
      if (text) {
        m.bio = text
        m.bioVerbatim = true
      } else if (m.bioVerbatim) {
        delete m.bioVerbatim
      }
    }
  }

  next = applyDirectivesToSitemap(next)

  const kept = gaps.filter((g) => !DIRECTIVE_GAP.test(g.field))
  const directiveGaps: GapItem[] = []
  directives.forEach((d, i) => {
    if (isResolved(d)) return
    directiveGaps.push({
      field: `operator_directives[${i}].clarification`,
      label: `Clarify the operator instruction: "${d.sourceText.slice(0, 160)}"`,
      phase: 4,
      tier: 2,
      topic: 'Operator instructions',
      resolved: !!d.clarification?.trim(),
    })
  })

  return { schema: next, gaps: [...kept, ...directiveGaps] }
}
