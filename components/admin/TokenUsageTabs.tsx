'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const TABS = [
  { href: '/admin/token-usage', label: 'Overview' },
  { href: '/admin/token-usage/by-user', label: 'By user' },
  { href: '/admin/token-usage/by-user-client', label: 'By user & client' },
]

// Sub-nav shown only across the Token Usage pages (rendered from their layout).
// Carries the active date-range query params across tabs so the selected window
// persists when switching views.
export default function TokenUsageTabs() {
  const pathname = usePathname()
  const params = useSearchParams()
  const qs = params.toString()
  const suffix = qs ? `?${qs}` : ''
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border-default mb-6">
      {TABS.map((t) => {
        const active = pathname === t.href
        return (
          <Link
            key={t.href}
            href={`${t.href}${suffix}`}
            className={`px-4 py-2.5 text-sm font-heading font-semibold border-b-2 -mb-px transition-colors ${
              active
                ? 'border-brand-cyan text-brand-navy'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
