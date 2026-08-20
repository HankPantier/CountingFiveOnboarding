import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, hasCapability, type CurrentUser } from '@/lib/auth/access'
import { getHomeStats } from '@/lib/admin/home-stats'
import { getCommandIndex } from '@/lib/admin/command-index'
import HomeGreeting from '@/components/admin/home/HomeGreeting'
import CommandBox, { type CommandSection } from '@/components/admin/home/CommandBox'
import StatCards from '@/components/admin/home/StatCards'
import StatusPill from '@/components/admin/StatusPill'

// Sections the caller can reach, in nav order — powers the command box's local
// "go to page" matches. Mirrors the nav visibility rule in AdminSidebar.
const ALL_SECTIONS: Array<CommandSection & { requires: 'manager' | 'auditor' | 'admin' }> = [
  { label: 'Onboarding', href: '/admin/dashboard', keywords: 'clients sessions onboarding calls', requires: 'manager' },
  { label: 'Content', href: '/admin/content', keywords: 'content generation pages website', requires: 'manager' },
  { label: 'Batch Content', href: '/admin/blog-batch', keywords: 'batch blog resources', requires: 'manager' },
  { label: 'Audits', href: '/admin/audits', keywords: 'audits site audit seo score', requires: 'auditor' },
  { label: 'Token Usage', href: '/admin/token-usage', keywords: 'tokens ai spend billing cost', requires: 'admin' },
  { label: 'Users', href: '/admin/settings/users', keywords: 'users team members admins', requires: 'admin' },
]

const QUICK_ACTIONS: Array<{ label: string; href: string; requires: 'manager' | 'auditor' | 'admin' }> = [
  { label: 'New Session', href: '/admin/dashboard/new-session', requires: 'admin' },
  { label: 'New Audit', href: '/admin/audits/new', requires: 'auditor' },
  { label: 'New Batch', href: '/admin/blog-batch/new', requires: 'manager' },
]

function canSee(user: CurrentUser, requires: 'manager' | 'auditor' | 'admin'): boolean {
  return requires === 'admin' ? user.isAdmin : hasCapability(user, requires)
}

export default async function AdminHomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const [stats, index] = await Promise.all([getHomeStats(user), getCommandIndex(user)])

  const firstName = (user.name ?? '').trim().split(/\s+/)[0] ?? ''
  const sections: CommandSection[] = ALL_SECTIONS.filter((s) => canSee(user, s.requires)).map(
    ({ label, href, keywords }) => ({ label, href, keywords }),
  )
  const quickActions = QUICK_ACTIONS.filter((a) => canSee(user, a.requires))
  const recentClients = index.clients.slice(0, 6)

  return (
    <main className="mx-auto max-w-5xl p-8 pb-14">
      <div className="flex flex-col items-center gap-6 pb-6 pt-8 text-center">
        <HomeGreeting firstName={firstName} />
        <CommandBox clients={index.clients} audits={index.audits} sections={sections} />
        {quickActions.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {quickActions.map((a, i) => (
              <Link
                key={a.href}
                href={a.href}
                className={
                  i === 0
                    ? 'rounded-pill bg-brand-navy px-5 py-2.5 font-heading text-[13px] font-semibold text-text-inverse transition-all hover:bg-brand-navy-dark'
                    : 'rounded-pill border border-border-default bg-surface-card px-5 py-2.5 font-heading text-[13px] font-semibold text-brand-navy transition-all hover:bg-surface-subtle'
                }
              >
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-heading text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
          Your workspace
        </h2>
        <StatCards stats={stats} />
      </section>

      {recentClients.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Jump back in
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentClients.map((c) => (
              <Link
                key={c.id}
                href={`/admin/sessions/${c.id}`}
                className="rounded-xl border border-border-default bg-surface-card p-4 shadow-subtle transition-all hover:-translate-y-0.5 hover:border-brand-cyan hover:shadow-medium"
              >
                <div className="truncate font-heading text-sm font-semibold text-brand-navy">{c.name}</div>
                <div className="mt-0.5 truncate font-body text-xs text-text-muted">{c.websiteUrl}</div>
                <div className="mt-3">
                  <StatusPill status={c.hasSite ? 'approved' : 'in_progress'} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
