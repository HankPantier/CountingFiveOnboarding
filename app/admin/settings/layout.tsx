import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import { signOut } from '../dashboard/actions'

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  // Settings is admin-only; managers never reach it.
  if (user.role !== 'admin') redirect('/admin/dashboard')

  return (
    <div className="min-h-screen bg-surface-page">
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
          <Link
            href="/admin/dashboard"
            className="text-sm text-text-inverse/70 hover:text-text-inverse font-body transition-colors"
          >
            ← Dashboard
          </Link>
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
      {children}
    </div>
  )
}
