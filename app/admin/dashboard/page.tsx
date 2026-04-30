import Link from 'next/link'
import { createAuthClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createAuthClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Dashboard</h1>
          <p className="text-text-secondary font-body mt-1">Signed in as {user?.email}</p>
        </div>
        <Link
          href="/admin/dashboard/new-session"
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark"
        >
          New Session
        </Link>
      </div>
      {/* Session list — Step 10 */}
    </main>
  )
}
