'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Maps the current route to a human breadcrumb title. First match wins, so the
// more specific patterns are listed before the broader ones.
const TITLES: Array<[RegExp, string]> = [
  [/^\/admin\/home/, 'Home'],
  [/^\/admin\/dashboard\/new-session/, 'New session'],
  [/^\/admin\/dashboard/, 'Onboarding'],
  [/^\/admin\/content/, 'Content'],
  [/^\/admin\/blog-batch/, 'Batch content'],
  [/^\/admin\/audits/, 'Audits'],
  [/^\/admin\/token-usage/, 'Token usage'],
  [/^\/admin\/settings\/users/, 'Users'],
  [/^\/admin\/sessions/, 'Client'],
  [/^\/admin\/account/, 'Account'],
]

function initials(name?: string): string {
  const w = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || 'R'
}

// Sticky top bar for every /admin/* route: breadcrumb, global client search,
// notifications, and the operator avatar. searchAction is the page the client
// search submits to — /admin/dashboard for onboarding users, /admin/content for
// editors (who can't reach the dashboard).
export default function AdminTopBar({
  userName,
  searchAction = '/admin/dashboard',
}: {
  userName?: string
  searchAction?: string
}) {
  const pathname = usePathname()
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Console'

  return (
    <header className="sticky top-0 z-10 flex h-16 flex-none items-center gap-4 border-b border-border-default bg-surface-card px-8">
      <div className="flex items-center gap-2.5">
        <span className="font-heading text-[13px] font-medium text-text-muted">Console</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-text-muted" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="font-heading text-sm font-semibold text-brand-navy">{title}</span>
      </div>

      <div className="flex-1" />

      <form
        action={searchAction}
        className="hidden items-center gap-2.5 rounded-pill border border-transparent bg-surface-subtle px-4 py-2 transition-colors focus-within:border-brand-cyan focus-within:bg-surface-card md:flex md:w-80"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-muted" aria-hidden="true">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35" />
        </svg>
        <input
          name="q"
          placeholder="Search clients…"
          aria-label="Search clients"
          className="min-w-0 flex-1 bg-transparent font-body text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </form>

      <Link
        href="/admin/account"
        aria-label="Account"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors hover:bg-surface-subtle"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full border-[1.5px] border-surface-card bg-brand-cyan" />
      </Link>

      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-cyan font-heading text-xs font-semibold text-text-inverse">
        {initials(userName)}
      </div>
    </header>
  )
}
