'use client'

import { useState } from 'react'
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

type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  requires: NavRequires
}

// Inline icons keep the sidebar dependency-free. 20px, currentColor stroke.
function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const NAV: NavItem[] = [
  { href: '/admin/home', label: 'Home', icon: <Icon d="M3 11l9-8 9 8M5 9v11h5v-6h4v6h5V9" />, requires: 'any' },
  { href: '/admin/dashboard', label: 'Onboarding', icon: <Icon d="M3 12h18M3 6h18M3 18h18" />, requires: 'manager' },
  { href: '/admin/content', label: 'Content', icon: <Icon d="M8 6h10M8 12h10M8 18h7M4 6h.01M4 12h.01M4 18h.01" />, requires: 'manager' },
  { href: '/admin/blog-batch', label: 'Batch Content', icon: <Icon d="M4 4h16v4H4zM4 12h10M4 16h10M16 12l4 4-4 4" />, requires: 'manager' },
  { href: '/admin/audits', label: 'Audits', icon: <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35" />, requires: 'auditor' },
  { href: '/admin/token-usage', label: 'Token Usage', icon: <Icon d="M4 19V5m4 14V9m4 10V7m4 12v-6m4 6V11" />, requires: 'admin' },
  { href: '/admin/settings/users', label: 'Users', icon: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />, requires: 'admin' },
]

export default function AdminSidebar({
  isAdmin,
  capabilities,
}: {
  isAdmin: boolean
  capabilities: Capability[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const items = NAV.filter((item) => {
    if (item.requires === 'any') return true
    if (item.requires === 'admin') return isAdmin
    return isAdmin || capabilities.includes(item.requires)
  })

  const rowBase =
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-body transition-colors'

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 border-r border-border-default bg-surface-card flex flex-col transition-[width] duration-200`}
    >
      <div className="h-16 flex items-center justify-between px-3 border-b border-border-default">
        {!collapsed && (
          <Link href="/admin/home" className="min-w-0">
            <Image
              src="/logo.png"
              alt="Revaltus"
              height={32}
              width={178}
              style={{ height: '32px', width: 'auto' }}
              priority
            />
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="text-text-muted hover:text-text-primary p-1 rounded-md transition-colors"
        >
          <Icon d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
        </button>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-1">
        {items.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`${rowBase} ${collapsed ? 'justify-center' : ''} ${
                active
                  ? 'bg-surface-subtle text-brand-cyan font-semibold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
              }`}
            >
              {item.icon}
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="px-2 py-3 border-t border-border-default space-y-1">
        <Link
          href="/admin/account"
          title={collapsed ? 'Account' : undefined}
          className={`${rowBase} ${collapsed ? 'justify-center' : ''} ${
            isActive('/admin/account')
              ? 'bg-surface-subtle text-brand-cyan font-semibold'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
          }`}
        >
          <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM6 21v-1a6 6 0 0 1 12 0v1" />
          {!collapsed && <span className="truncate">Account</span>}
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            title={collapsed ? 'Sign out' : undefined}
            className={`${rowBase} w-full ${collapsed ? 'justify-center' : ''} text-text-secondary hover:text-text-primary hover:bg-surface-subtle`}
          >
            <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            {!collapsed && <span className="truncate">Sign out</span>}
          </button>
        </form>
      </div>
    </aside>
  )
}
