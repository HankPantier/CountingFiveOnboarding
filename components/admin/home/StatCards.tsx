import StatCard from '@/components/admin/ui/StatCard'
import type { HomeStats } from '@/lib/admin/home-stats'

// The three cards read as one pipeline: audits in flight → clients still being
// onboarded (no live site) → clients whose site is live. Rewritten to use the
// shared elevated StatCard.
export default function StatCards({ stats }: { stats: HomeStats }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="Active audits" value={stats.activeAudits} context="running now" href="/admin/audits" />
      <StatCard
        label="In onboarding"
        value={stats.inProgress}
        context="no live site yet"
        href="/admin/dashboard?status=in_progress"
      />
      <StatCard label="Live client sites" value={stats.currentClients} context="site set up" tone="good" href="/admin/dashboard" />
    </div>
  )
}
