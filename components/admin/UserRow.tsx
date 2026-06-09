'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ClientAssignmentEditor from '@/components/admin/ClientAssignmentEditor'
import type { UserSummary } from '@/types/users'
import type { SessionOption } from '@/app/admin/settings/users/page'

export default function UserRow({
  user,
  sessions,
}: {
  user: UserSummary
  sessions: SessionOption[]
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'resend' | 'remove' | null>(null)
  const [note, setNote] = useState('')
  const router = useRouter()

  async function resend() {
    setBusy('resend')
    setNote('')
    try {
      const res = await fetch(`/api/admin/users/${user.id}/resend-invite`, { method: 'POST' })
      const data = (await res.json()) as { error?: string }
      setNote(res.ok && !data.error ? 'Invite sent' : data.error ?? 'Failed to send')
    } catch {
      setNote('Failed to send')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!confirm(`Remove ${user.name}? They will lose all access immediately.`)) return
    setBusy('remove')
    setNote('')
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) {
        setNote(data.error ?? 'Failed to remove')
        setBusy(null)
        return
      }
      router.refresh()
    } catch {
      setNote('Failed to remove')
      setBusy(null)
    }
  }

  return (
    <>
      <tr className="border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors">
        <td className="px-4 py-3 font-body text-text-primary">{user.name}</td>
        <td className="px-4 py-3 text-text-secondary">{user.email}</td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold ${
              user.role === 'admin'
                ? 'bg-brand-navy/10 text-brand-navy'
                : 'bg-info/10 text-info'
            }`}
          >
            {user.role === 'admin' ? 'Admin' : 'Manager'}
          </span>
        </td>
        <td className="px-4 py-3 text-text-secondary">
          {user.role === 'manager' ? `${user.assignedCount} assigned` : 'All'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-3">
            {note && <span className="text-xs font-body text-text-muted">{note}</span>}
            {user.role === 'manager' && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
              >
                Manage access
              </button>
            )}
            <button
              onClick={resend}
              disabled={busy !== null}
              className="text-xs font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors disabled:opacity-50"
            >
              {busy === 'resend' ? 'Sending…' : 'Resend invite'}
            </button>
            <button
              onClick={remove}
              disabled={busy !== null}
              className="text-xs font-heading font-semibold text-error hover:text-error/80 transition-colors disabled:opacity-50"
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={5} className="p-0">
            <ClientAssignmentEditor
              userId={user.id}
              sessions={sessions}
              onClose={() => setEditing(false)}
            />
          </td>
        </tr>
      )}
    </>
  )
}
