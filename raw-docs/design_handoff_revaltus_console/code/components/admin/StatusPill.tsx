// Status → pill styling, following the Revaltus design-system spec:
//   pending      → neutral subtle fill
//   in_progress  → teal tint
//   completed    → near-black tint
//   approved     → SOLID near-black (design-system ground truth; note this
//                  differs from the old dashboard's plum `approved` chip)
//   archived     → muted
const MAP: Record<string, { label: string; cls: string }> = {
  pending:     { label: 'Pending',     cls: 'bg-surface-subtle text-text-secondary' },
  in_progress: { label: 'In progress', cls: 'bg-brand-cyan/10 text-brand-cyan-dark' },
  completed:   { label: 'Completed',   cls: 'bg-brand-navy/10 text-brand-navy' },
  approved:    { label: 'Approved',    cls: 'bg-brand-navy text-text-inverse' },
  archived:    { label: 'Archived',    cls: 'bg-surface-subtle text-text-muted' },
}

export default function StatusPill({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, cls: 'bg-surface-subtle text-text-muted' }
  return (
    <span
      className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${s.cls}`}
    >
      {s.label}
    </span>
  )
}
