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
      <header className="bg-surface-card border-b border-border-default h-16 flex items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/admin/dashboard">
            <Image
              src="/logo.png"
              alt="Revaltus"
              height={36}
              width={200}
              style={{ height: '36px', width: 'auto' }}
              priority
            />
          </Link>
          <Link
            href="/admin/dashboard"
            className="text-sm text-text-secondary hover:text-text-primary font-body transition-colors"
          >
            ← Dashboard
          </Link>
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
      {children}
    </div>
  )
}
