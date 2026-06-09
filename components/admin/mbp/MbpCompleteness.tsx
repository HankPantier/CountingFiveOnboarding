import type { GapItem } from '@/types/gap-item'
import type { MbpDocument } from '@/types/mbp'

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 — must have',
  2: 'Tier 2 — nice to have',
  3: 'Tier 3 — optional',
}

export default function MbpCompleteness({
  doc,
  gaps,
}: {
  doc: MbpDocument
  gaps: GapItem[]
}) {
  // Empty fields across the whole document, grouped by section title.
  const emptyBySection = doc.sections
    .map(s => {
      const flat = [
        ...(s.fields ?? []),
        ...(s.items ?? []).flatMap(it => it.fields),
      ]
      return { title: s.title, empties: flat.filter(f => f.empty) }
    })
    .filter(s => s.empties.length > 0)

  const unresolved = gaps.filter(g => !g.resolved)
  const byTier = [1, 2, 3].map(tier => ({
    tier,
    items: unresolved.filter(g => (g.tier ?? 3) === tier),
  })).filter(t => t.items.length > 0)

  const totalEmpty = emptyBySection.reduce((n, s) => n + s.empties.length, 0)

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

        {emptyBySection.length === 0 ? (
          <p className="text-sm font-body text-success">Every MBP field is filled in.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-heading font-semibold text-text-secondary">Empty fields</p>
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
