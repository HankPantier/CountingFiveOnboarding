import Link from 'next/link'
import type { HomeStats } from '@/lib/admin/home-stats'

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

interface Card {
  label: string
  value: number
  context: string
  href: string
  icon: string
}

// The three cards read as one pipeline: audits in flight → clients still being
// onboarded (no live site) → clients whose site is live.
export default function StatCards({ stats }: { stats: HomeStats }) {
  const cards: Card[] = [
    { label: 'Active Audits', value: stats.activeAudits, context: 'running now', href: '/admin/audits', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35' },
    { label: 'In Progress', value: stats.inProgress, context: 'onboarding, no site yet', href: '/admin/dashboard?status=in_progress', icon: 'M12 8v4l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
    { label: 'Current Clients', value: stats.currentClients, context: 'site set up', href: '/admin/dashboard', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6' },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map(card => (
        <Link
          key={card.label}
          href={card.href}
          className="group bg-surface-card border border-border-default rounded-card shadow-subtle p-6 transition-all hover:border-brand-cyan hover:shadow-medium"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-heading font-semibold uppercase tracking-wide text-text-secondary">
              {card.label}
            </span>
            <span className="text-brand-cyan"><Icon d={card.icon} /></span>
          </div>
          <div className="mt-3 text-3xl font-heading font-bold text-brand-navy tabular-nums">
            {card.value}
          </div>
          <div className="mt-1 text-sm font-body text-text-muted group-hover:text-brand-cyan transition-colors">
            {card.context}
          </div>
        </Link>
      ))}
    </div>
  )
}
