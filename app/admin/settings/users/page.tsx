import { createServerClient } from '@/lib/supabase/server'
import AddUserDialog from '@/components/admin/AddUserDialog'
import UserRow from '@/components/admin/UserRow'
import { contentReadySessionIds } from '@/lib/admin/content-ready'
import type { UserSummary } from '@/types/users'
import type { Capability } from '@/lib/auth/access'

const ALL_CAPABILITIES: Capability[] = ['manager', 'auditor', 'editor', 'owner']

export interface SessionOption {
  id: string
  website_url: string
  // A Site Owner may only be assigned a content-ready site (phase >= 6 + repo).
  contentReady: boolean
}

export default async function UsersPage() {
  const supabase = createServerClient()

  const [{ data: admins }, { data: links }, { data: sessions }] = await Promise.all([
    supabase.from('admins').select('id, name, email, role, capabilities, created_at').order('created_at', { ascending: true }),
    supabase.from('manager_clients').select('manager_id'),
    supabase.from('sessions').select('id, website_url').neq('status', 'archived').order('website_url', { ascending: true }),
  ])

  const countByManager = new Map<string, number>()
  for (const l of links ?? []) {
    countByManager.set(l.manager_id, (countByManager.get(l.manager_id) ?? 0) + 1)
  }

  const users: UserSummary[] = (admins ?? []).map(a => {
    const isAdmin = a.role === 'admin'
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      role: isAdmin ? 'admin' : 'member',
      capabilities: isAdmin
        ? ALL_CAPABILITIES
        : ALL_CAPABILITIES.filter(c => Array.isArray(a.capabilities) && a.capabilities.includes(c)),
      created_at: a.created_at,
      assignedCount: countByManager.get(a.id) ?? 0,
    }
  })

  const ready = await contentReadySessionIds((sessions ?? []).map(s => s.id))
  const sessionOptions: SessionOption[] = (sessions ?? []).map(s => ({
    id: s.id,
    website_url: s.website_url,
    contentReady: ready.has(s.id),
  }))

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Users</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {users.length} {users.length === 1 ? 'user' : 'users'}
          </p>
        </div>
        <AddUserDialog sessions={sessionOptions} />
      </div>

      <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle overflow-hidden">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-border-default bg-[#FBFCFD]">
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Role</th>
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Clients</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <UserRow key={user.id} user={user} sessions={sessionOptions} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
