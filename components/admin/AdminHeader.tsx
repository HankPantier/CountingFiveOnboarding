import Image from 'next/image'
import Link from 'next/link'
import type { Role } from '@/lib/auth/access'
import { signOut } from '@/app/admin/dashboard/actions'

// Shared header for the authenticated admin areas. The "Users" link is
// admin-only — managers never see it.
export default function AdminHeader({ role }: { role: Role }) {
  return (
    <header className="bg-surface-card border-b border-border-default h-16 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <Link href="/admin/dashboard">
          <Image
            src="/logo.png"
            alt="Revaltus"
            height={43}
            width={240}
            style={{ height: '43px', width: 'auto' }}
            priority
          />
        </Link>
        {role === 'admin' && (
          <>
            <Link
              href="/admin/audits"
              className="text-sm text-text-secondary hover:text-text-primary font-body transition-colors"
            >
              Audits
            </Link>
            <Link
              href="/admin/settings/users"
              className="text-sm text-text-secondary hover:text-text-primary font-body transition-colors"
            >
              Users
            </Link>
          </>
        )}
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="text-sm text-text-secondary hover:text-text-primary font-body transition-colors"
        >
          Sign out
        </button>
      </form>
    </header>
  )
}
