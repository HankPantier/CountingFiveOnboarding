import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthClient } from '@/lib/supabase/server'
import { signOut } from '../dashboard/actions'

export default async function SessionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  return (
    <div className="min-h-screen bg-surface-page">
      <header className="bg-brand-navy h-16 flex items-center justify-between px-6">
        <Link href="/admin/dashboard">
          <Image
            src="/logo-white.png"
            alt="CountingFive"
            height={32}
            width={180}
            className="h-8 w-auto"
            priority
          />
        </Link>
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
