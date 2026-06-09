import type { GapItem } from '@/types/gap-item'
import type { MbpDocument, MbpDocumentField } from '@/types/mbp'

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 — must have',
  2: 'Tier 2 — nice to have',
  3: 'Tier 3 — optional',
}

// Onboarding gaps store array indices as `team[3].title`; the document uses
// dot paths (`team.3.title`). Normalize numeric indices so the two align.
// Synthetic markers like `affiliations[Massachusetts Society of CPAs]` keep
// their bracket and simply won't match a document field (unreconcilable).
function normalizeGapField(field: string): string {
  return field.replace(/\[(\d+)\]/g, '.$1')
}

export default function MbpCompleteness({
  doc,
  gaps,
}: {
  doc: MbpDocument
  gaps: GapItem[]
}) {
  // Flatten every document field with its current emptiness — the live source
  // of truth (vs the gap list's `resolved` flag, which goes stale once fields
  // are filled by admin edits or approved suggestions).
  const allFields: MbpDocumentField[] = doc.sections.flatMap(s => [
    ...(s.fields ?? []),
    ...(s.items ?? []).flatMap(it => it.fields),
  ])
  const emptyByPath = new Map(allFields.map(f => [f.fieldPath, f.empty]))

  // A gap is still open only if its field is actually empty now. Gaps whose
  // path can't be reconciled to a document field (synthetic markers) are kept.
  const stillOpen = gaps.filter(g => {
    if (g.resolved) return false
    const norm = normalizeGapField(g.field)
    return emptyByPath.has(norm) ? emptyByPath.get(norm) === true : true
  })
  const gapPaths = new Set(stillOpen.map(g => normalizeGapField(g.field)))

  const byTier = [1, 2, 3]
    .map(tier => ({ tier, items: stillOpen.filter(g => (g.tier ?? 3) === tier) }))
    .filter(t => t.items.length > 0)

  // Empty fields not already represented by a shown gap (no double-listing).
  const emptyBySection = doc.sections
    .map(s => {
      const flat = [...(s.fields ?? []), ...(s.items ?? []).flatMap(it => it.fields)]
      return { title: s.title, empties: flat.filter(f => f.empty && !gapPaths.has(f.fieldPath)) }
    })
    .filter(s => s.empties.length > 0)

  const totalEmpty = allFields.filter(f => f.empty).length

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-surface-subtle flex items-center justify-between">
        <span className="text-sm font-heading font-semibold text-text-primary">Completeness</span>
        <span className="text-xs font-body text-text-muted">
          {totalEmpty === 0 ? 'All fields populated' : `${totalEmpty} empty field${totalEmpty === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="px-4 py-3 space-y-4">
        {byTier.length > 0 && (
          <div className="space-y-2">
            {byTier.map(({ tier, items }) => (
              <div key={tier}>
                <p className="text-xs font-heading font-semibold text-text-secondary mb-1">{TIER_LABELS[tier]}</p>
                <ul className="space-y-0.5">
                  {items.map(g => (
                    <li key={g.field} className="text-sm font-body text-text-primary">• {g.label}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {emptyBySection.length === 0 && byTier.length === 0 ? (
          <p className="text-sm font-body text-success">Every MBP field is filled in.</p>
        ) : emptyBySection.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-heading font-semibold text-text-secondary">Other empty fields</p>
            {emptyBySection.map(s => (
              <div key={s.title}>
                <p className="text-xs font-body text-text-muted">{s.title}</p>
                <p className="text-sm font-body text-text-primary">
                  {s.empties.map(f => f.label).join(', ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
