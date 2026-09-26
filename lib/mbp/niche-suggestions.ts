import type { SuggestionChangeInput } from '@/lib/mbp/create-suggestion'
import type { SessionSchema } from '@/types/session-schema'

export interface NicheAddition {
  name: string
  description?: string
  valueProp?: string
}

export interface NicheSuggestion {
  summary?: string
  changes: SuggestionChangeInput[]
}

const RATIONALE = 'Audience pages changed on the live site; sync the MBP target niches.'

// Turn a site-structure audience change into element-level MBP suggestions:
// - one suggestion marking each removed niche `status: 'dropped'` (kept in the
//   array, like the Audit Review drop, so niches[i] gap paths stay stable),
//   each guarded on that niche's name so a reorder can't drop the wrong one;
// - one `append` suggestion per added niche (a suggestion keys changes by path,
//   so two appends to `niches` can't share one), or a `status: 'kept'` restore
//   when the added niche is already in the array as dropped.
// Never a whole-array set: approving an old snapshot of the list would wipe
// every niche edit made since.
export function buildNicheSuggestions(
  schema: Pick<SessionSchema, 'niches'>,
  removedNames: Set<string>,
  added: NicheAddition[]
): { suggestions: NicheSuggestion[]; skipped: string[] } {
  const niches = Array.isArray(schema.niches) ? schema.niches : []
  const key = (name: unknown) => (typeof name === 'string' ? name.trim().toLowerCase() : '')
  const skipped: string[] = []
  const suggestions: NicheSuggestion[] = []

  const drops: SuggestionChangeInput[] = []
  const matched = new Set<string>()
  niches.forEach((n, i) => {
    const k = key(n?.name)
    if (!k || !removedNames.has(k)) return
    matched.add(k)
    if (n.status === 'dropped') return
    drops.push({
      fieldPath: `niches[${i}].status`,
      op: 'set',
      proposedValue: 'dropped',
      rationale: RATIONALE,
      basePath: `niches[${i}].name`,
    })
  })
  for (const name of removedNames) {
    if (!matched.has(name)) skipped.push(`"${name}" is not in the profile`)
  }
  if (drops.length) suggestions.push({ changes: drops })

  const active = new Set(niches.filter(n => n?.status !== 'dropped').map(n => key(n?.name)).filter(Boolean))
  for (const a of added) {
    const name = a.name.trim()
    if (!name) continue
    if (active.has(key(name))) {
      skipped.push(`"${name}" is already an active niche`)
      continue
    }
    active.add(key(name))
    // A previously dropped niche is restored in place rather than duplicated.
    const droppedIdx = niches.findIndex(n => n?.status === 'dropped' && key(n?.name) === key(name))
    if (droppedIdx >= 0) {
      suggestions.push({
        summary: `Restore niche: ${name}`,
        changes: [
          {
            fieldPath: `niches[${droppedIdx}].status`,
            op: 'set',
            proposedValue: 'kept',
            rationale: RATIONALE,
            basePath: `niches[${droppedIdx}].name`,
          },
        ],
      })
      continue
    }
    suggestions.push({
      summary: `Add niche: ${name}`,
      changes: [
        {
          fieldPath: 'niches',
          op: 'append',
          proposedValue: {
            name,
            description: a.description?.trim() ?? '',
            valueProp: a.valueProp?.trim() ?? '',
            status: 'kept',
            origin: 'site',
          },
          rationale: RATIONALE,
        },
      ],
    })
  }

  return { suggestions, skipped }
}
