'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Capability } from '@/lib/auth/access'
import { signOut } from '@/app/admin/dashboard/actions'

// Visibility predicate for a nav item:
//   'any'                 — every authenticated admin-table user
//   'manager' / 'auditor' — admins plus members holding that capability
//   'admin'               — admins only
type NavRequires = 'any' | 'manager' | 'auditor' | 'admin'
type NavItem = { href: string; label: string; d: string; requires: NavRequires }
type NavGroup = { label: string; items: NavItem[] }

function Icon({ d, className = 'h-[19px] w-[19px] shrink-0' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// Same items + `requires` rules as before, now organised into labelled groups.
const GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/admin/home', label: 'Home', d: 'M3 11l9-8 9 8M5 9v11h5v-6h4v6h5V9', requires: 'any' },
      { href: '/admin/dashboard', label: 'Onboarding', d: 'M3 12h18M3 6h18M3 18h18', requires: 'manager' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/content', label: 'Content', d: 'M8 6h10M8 12h10M8 18h7M4 6h.01M4 12h.01M4 18h.01', requires: 'manager' },
      { href: '/admin/blog-batch', label: 'Batch content', d: 'M4 4h16v4H4zM4 12h10M4 16h10M16 12l4 4-4 4', requires: 'manager' },
      { href: '/admin/audits', label: 'Audits', d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35', requires: 'auditor' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/admin/token-usage', label: 'Token usage', d: 'M4 19V5m4 14V9m4 10V7m4 12v-6m4 6V11', requires: 'admin' },
      { href: '/admin/settings/users', label: 'Users', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11', requires: 'admin' },
    ],
  },
]

function initials(name?: string): string {
  const w = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || 'R'
}

export default function AdminSidebar({
  isAdmin,
  capabilities,
  userName,
}: {
  isAdmin: boolean
  capabilities: Capability[]
  userName?: string
}) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const canSee = (r: NavRequires) =>
    r === 'any' ? true : r === 'admin' ? isAdmin : isAdmin || capabilities.includes(r)

  const rowBase =
    'group relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 font-heading text-[13.5px] font-medium transition-colors'

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col self-start bg-brand-navy-deeper">
      <div className="px-[22px] pb-4 pt-6">
        <Link href="/admin/home" className="inline-block">
          {/* White reversed wordmark — add public/logo-white.png (bundled here). */}
          <Image src="/logo-white.png" alt="Revaltus" height={29} width={161} style={{ height: '29px', width: 'auto' }} priority />
        </Link>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {GROUPS.map((g) => {
          const items = g.items.filter((it) => canSee(it.requires))
          if (!items.length) return null
          return (
            <div key={g.label} className="space-y-0.5">
              <div className="px-3 pb-1.5 pt-2 font-heading text-[10px] font-semibold uppercase tracking-[0.11em] text-white/35">
                {g.label}
              </div>
              {items.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${rowBase} ${
                      active ? 'bg-brand-cyan/15 text-white' : 'text-white/65 hover:bg-white/[0.07] hover:text-white'
                    }`}
                  >
                    {active && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-brand-cyan" />}
                    <Icon d={item.d} />
                    <span className="flex-1 truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.06]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-cyan font-heading text-xs font-semibold text-white">
            {initials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-heading text-[13px] font-semibold text-white">{userName ?? 'Account'}</div>
            <div className="font-body text-[11px] text-white/45">{isAdmin ? 'Admin' : 'Team'}</div>
          </div>
          <form action={signOut}>
            <button type="submit" aria-label="Sign out" className="p-1 text-white/40 transition-colors hover:text-white">
              <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" className="h-[17px] w-[17px]" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
