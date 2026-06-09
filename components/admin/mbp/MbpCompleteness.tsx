import MbpSectionLink from '@/components/admin/mbp/MbpSectionLink'
import type { GapItem } from '@/types/gap-item'
import type { MbpDocument } from '@/types/mbp'

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 — must have',
  2: 'Tier 2 — nice to have',
  3: 'Tier 3 — optional',
}

// Onboarding gaps store array indices as `team[3].title`; the document uses
// dot paths (`team.3.title`). Normalize numeric indices so the two align.
function normalizeGapField(field: string): string {
  return field.replace(/\[(\d+)\]/g, '.$1')
}

// The document section that holds a gap's field — its first path segment
// (business.foundingYear → business, team[3].title → team).
function sectionKeyForGap(field: string): string {
  return field.split(/[.[]/)[0]
}

// Focused "what's still genuinely missing" list. Driven by the curated gap
// list (the things worth collecting), reconciled against live field values so
// items filled by any means (admin edit, approved suggestion, backfill) drop
// off. Deliberately NOT an exhaustive empty-field scan — structural/operational
// fields (team bios, service offerings, WHOIS, address line 2) live in the
// produced content and aren't profile-completeness concerns.
export default function MbpCompleteness({
  doc,
  gaps,
}: {
  doc: MbpDocument
  gaps: GapItem[]
}) {
  const profileSections = doc.sections.filter(s => s.key !== 'site_map')
  const emptyByPath = new Map(
    profileSections
      .flatMap(s => [...(s.fields ?? []), ...(s.items ?? []).flatMap(it => it.fields)])
      .map(f => [f.fieldPath, f.empty])
  )

  const stillOpen = gaps.filter(g => {
    if (g.resolved) return false
    const norm = normalizeGapField(g.field)
    return emptyByPath.has(norm) ? emptyByPath.get(norm) === true : true
  })

  const byTier = [1, 2, 3]
    .map(tier => ({ tier, items: stillOpen.filter(g => (g.tier ?? 3) === tier) }))
    .filter(t => t.items.length > 0)

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-surface-subtle flex items-center justify-between">
        <span className="text-sm font-heading font-semibold text-text-primary">Still needed</span>
        <span className="text-xs font-body text-text-muted">
          {stillOpen.length === 0 ? 'Profile complete' : `${stillOpen.length} item${stillOpen.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {byTier.length === 0 ? (
          <p className="text-sm font-body text-success">Everything we track is filled in.</p>
        ) : (
          byTier.map(({ tier, items }) => (
            <div key={tier}>
              <p className="text-xs font-heading font-semibold text-text-secondary mb-1">{TIER_LABELS[tier]}</p>
              <ul className="space-y-0.5">
                {items.map(g => (
                  <li key={g.field} className="flex gap-1.5 text-sm font-body text-text-primary">
                    <span className="text-text-muted">•</span>
                    <MbpSectionLink sectionKey={sectionKeyForGap(g.field)} label={g.label} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
