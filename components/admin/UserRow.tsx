'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ClientAssignmentEditor from '@/components/admin/ClientAssignmentEditor'
import type { UserSummary, ResetPasswordResponse, SetPasswordResponse } from '@/types/users'
import type { SessionOption } from '@/app/admin/settings/users/page'

export default function UserRow({
  user,
  sessions,
}: {
  user: UserSummary
  sessions: SessionOption[]
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'resend' | 'remove' | 'reset' | 'setpw' | null>(null)
  const [note, setNote] = useState('')
  const [resetLink, setResetLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [newPassword, setNewPassword] = useState<string | null>(null)
  const [copiedPw, setCopiedPw] = useState(false)
  const router = useRouter()

  async function resend() {
    if (!confirm(`Send a new invite email to ${user.email}?`)) return
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

  async function resetPassword() {
    if (!confirm(`Generate a single-use password reset link for ${user.email}?`)) return
    setBusy('reset')
    setNote('')
    setResetLink(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' })
      const data = (await res.json()) as Partial<ResetPasswordResponse> & { error?: string }
      if (res.ok && data.link) {
        setResetLink(data.link)
      } else {
        setNote(data.error ?? 'Failed to generate link')
      }
    } catch {
      setNote('Failed to generate link')
    } finally {
      setBusy(null)
    }
  }

  function copyResetLink() {
    if (!resetLink) return
    navigator.clipboard.writeText(resetLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  async function setPassword() {
    if (!confirm(`Generate a new password for ${user.email}? Their current password stops working immediately.`)) return
    setBusy('setpw')
    setNote('')
    setNewPassword(null)
    setCopiedPw(false)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/set-password`, { method: 'POST' })
      const data = (await res.json()) as Partial<SetPasswordResponse> & { error?: string }
      if (res.ok && data.password) {
        setNewPassword(data.password)
      } else {
        setNote(data.error ?? 'Failed to set password')
      }
    } catch {
      setNote('Failed to set password')
    } finally {
      setBusy(null)
    }
  }

  function copyPassword() {
    if (!newPassword) return
    navigator.clipboard.writeText(newPassword).then(() => {
      setCopiedPw(true)
      setTimeout(() => setCopiedPw(false), 2500)
    })
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
      <tr className="border-b border-border-default last:border-0 hover:bg-brand-cyan/10 transition-colors">
        <td className="px-4 py-3 font-body text-text-primary">{user.name}</td>
        <td className="px-4 py-3 text-text-secondary">{user.email}</td>
        <td className="px-4 py-3">
          {user.role === 'admin' ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold bg-brand-navy/10 text-brand-navy">
              Admin
            </span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {user.capabilities.map(cap => (
                <span
                  key={cap}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold bg-info/10 text-info capitalize"
                >
                  {cap}
                </span>
              ))}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-text-secondary">
          {user.role === 'admin'
            ? 'All'
            : user.capabilities.includes('manager')
              ? `${user.assignedCount} assigned`
              : '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-3">
            {note && <span className="text-xs font-body text-text-muted">{note}</span>}
            {user.role !== 'admin' && user.capabilities.includes('manager') && (
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
              onClick={resetPassword}
              disabled={busy !== null}
              className="text-xs font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors disabled:opacity-50"
            >
              {busy === 'reset' ? 'Generating…' : 'Reset password'}
            </button>
            <button
              onClick={setPassword}
              disabled={busy !== null}
              className="text-xs font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors disabled:opacity-50"
            >
              {busy === 'setpw' ? 'Setting…' : 'Set password'}
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
      {resetLink && (
        <tr>
          <td colSpan={5} className="px-4 py-3 bg-surface-page">
            <div className="bg-surface-card border border-border-default rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                  Single-use reset link for {user.email}
                </p>
                <button
                  onClick={() => setResetLink(null)}
                  className="text-xs font-heading font-semibold text-text-muted hover:text-brand-navy transition-colors"
                >
                  Dismiss
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-text-primary bg-surface-subtle rounded px-2 py-1.5 truncate">
                  {resetLink}
                </code>
                <button
                  onClick={copyResetLink}
                  className={`flex-shrink-0 text-xs font-heading font-semibold px-3 py-1.5 rounded-pill border transition-all ${
                    copied
                      ? 'border-success/40 text-success bg-success/10'
                      : 'border-border-default text-text-secondary hover:border-brand-cyan hover:text-brand-cyan'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs font-body text-text-muted mt-2">
                Send this to the user securely. It expires per Supabase settings and can be used once.
              </p>
            </div>
          </td>
        </tr>
      )}
      {newPassword && (
        <tr>
          <td colSpan={5} className="px-4 py-3 bg-surface-page">
            <div className="bg-surface-card border border-border-default rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                  New password for {user.email}
                </p>
                <button
                  onClick={() => setNewPassword(null)}
                  className="text-xs font-heading font-semibold text-text-muted hover:text-brand-navy transition-colors"
                >
                  Dismiss
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-text-primary bg-surface-subtle rounded px-2 py-1.5 truncate">
                  {newPassword}
                </code>
                <button
                  onClick={copyPassword}
                  className={`flex-shrink-0 text-xs font-heading font-semibold px-3 py-1.5 rounded-pill border transition-all ${
                    copiedPw
                      ? 'border-success/40 text-success bg-success/10'
                      : 'border-border-default text-text-secondary hover:border-brand-cyan hover:text-brand-cyan'
                  }`}
                >
                  {copiedPw ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs font-body text-text-muted mt-2">
                The password is now active. Send it to the user securely — it won&apos;t be shown again.
              </p>
            </div>
          </td>
        </tr>
      )}
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
