import Image from 'next/image'
import Link from 'next/link'
import type { Role } from '@/lib/auth/access'
import { signOut } from '@/app/admin/dashboard/actions'

// Shared header for the authenticated admin areas. The "Users" link is
// admin-only — managers never see it.
export default function AdminHeader({ role }: { role: Role }) {
  return (
    <header className="bg-brand-navy h-16 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <Link href="/admin/dashboard">
          <Image
            src="/logo-white.png"
            alt="CountingFive"
            height={32}
            width={180}
            style={{ height: '32px', width: 'auto' }}
            priority
          />
        </Link>
        {role === 'admin' && (
          <Link
            href="/admin/settings/users"
            className="text-sm text-text-inverse/70 hover:text-text-inverse font-body transition-colors"
          >
            Users
          </Link>
        )}
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="text-sm text-text-inverse/70 hover:text-text-inverse font-body transition-colors"
        >
          Sign out
        </button>
      </form>
    </header>
  )
}
