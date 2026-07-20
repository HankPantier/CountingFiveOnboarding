import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, hasCapability, type CurrentUser } from '@/lib/auth/access'
import { getHomeStats } from '@/lib/admin/home-stats'
import { getCommandIndex } from '@/lib/admin/command-index'
import HomeGreeting from '@/components/admin/home/HomeGreeting'
import CommandBox, { type CommandSection } from '@/components/admin/home/CommandBox'
import StatCards from '@/components/admin/home/StatCards'

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
  const sections: CommandSection[] = ALL_SECTIONS.filter(s => canSee(user, s.requires)).map(
    ({ label, href, keywords }) => ({ label, href, keywords }),
  )
  const quickActions = QUICK_ACTIONS.filter(a => canSee(user, a.requires))
  const recentClients = index.clients.slice(0, 5)

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="pt-8 pb-6 flex flex-col items-center text-center gap-6">
        <HomeGreeting firstName={firstName} />
        <CommandBox clients={index.clients} audits={index.audits} sections={sections} />
        {quickActions.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {quickActions.map(a => (
              <Link
                key={a.href}
                href={a.href}
                className="bg-brand-navy text-text-inverse font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-brand-navy-dark"
              >
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-heading font-semibold uppercase tracking-wide text-text-secondary mb-3">
          Your workspace
        </h2>
        <StatCards stats={stats} />
      </section>

      {recentClients.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-heading font-semibold uppercase tracking-wide text-text-secondary mb-3">
            Jump back in
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentClients.map(c => (
              <Link
                key={c.id}
                href={`/admin/sessions/${c.id}`}
                className="bg-surface-card border border-border-default rounded-card shadow-subtle p-4 transition-all hover:border-brand-cyan hover:shadow-medium"
              >
                <div className="font-body text-sm text-text-primary font-semibold truncate">{c.name}</div>
                <div className="text-xs text-text-muted font-body mt-0.5 truncate">{c.websiteUrl}</div>
                <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-heading font-semibold bg-surface-subtle text-text-secondary">
                  {c.hasSite ? 'Site live' : 'In onboarding'}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
