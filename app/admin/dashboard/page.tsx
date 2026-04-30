import Image from 'next/image'
import { redirect } from 'next/navigation'
import { createAuthClient } from '@/lib/supabase/server'
import { signOut } from './actions'

export default async function DashboardPage() {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/admin/login')

  return (
    <div className="min-h-screen bg-surface-page">
      <header className="bg-brand-navy h-16 flex items-center justify-between px-6">
        <Image
          src="/logo.png"
          alt="CountingFive"
          height={32}
          width={180}
          style={{ height: 32, width: 'auto' }}
          priority
        />
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-text-inverse/70 hover:text-text-inverse font-body transition-colors"
          >
            Sign out
          </button>
        </form>
      </header>

      <main className="p-8">
        <h1 className="text-2xl font-heading font-bold text-brand-navy">
          Dashboard
        </h1>
        <p className="text-text-secondary font-body mt-1">
          Signed in as {user.email}
        </p>
        {/* Session list — Step 10 */}
      </main>
    </div>
  )
}
