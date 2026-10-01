import type { PageDirectiveBadge } from '@/lib/content/directive-pipeline'

const BADGE_CLS: Record<PageDirectiveBadge['kind'], string> = {
  verbatim: 'border-brand-navy/30 bg-brand-navy/10 text-brand-navy',
  merged: 'border-info/40 bg-info/10 text-info',
  brought: 'border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan-dark',
  added: 'border-success/40 bg-success/10 text-success',
}

// Pills marking a page an operator instruction drives, so nobody rewrites or
// drops it by accident. Hover shows the rep's original sentence.
export default function DirectiveBadges({ badges }: { badges: PageDirectiveBadge[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b, i) => (
        <span
          key={`${b.kind}-${i}`}
          title={`Operator instruction: “${b.sourceText}”`}
          className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[11px] font-heading font-semibold ${BADGE_CLS[b.kind]}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  )
}
