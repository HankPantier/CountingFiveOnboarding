'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/use-dialog'
import type { Role, Capability } from '@/lib/auth/access'
import type { CreateUserResponse } from '@/types/users'
import type { SessionOption } from '@/app/admin/settings/users/page'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AddUserDialog({ sessions }: { sessions: SessionOption[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [capabilities, setCapabilities] = useState<Set<Capability>>(new Set(['manager']))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const isOwner = role === 'member' && capabilities.has('owner')
  const isContentUser =
    role === 'member' && (capabilities.has('manager') || capabilities.has('editor') || capabilities.has('owner'))

  function reset() {
    setName('')
    setEmail('')
    setRole('member')
    setCapabilities(new Set(['manager']))
    setSelected(new Set())
    setError('')
    setWarning('')
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Owner is assigned exactly one site — clicking a site replaces the selection.
  function pickSingle(id: string) {
    setSelected(new Set([id]))
  }

  function toggleCapability(cap: Capability) {
    setCapabilities(prev => {
      const next = new Set(prev)
      if (next.has(cap)) {
        next.delete(cap)
        return next
      }
      // Site Owner is exclusive with every other capability (and vice versa).
      if (cap === 'owner') {
        setSelected(new Set())
        return new Set<Capability>(['owner'])
      }
      next.add(cap)
      // manager and editor are mutually exclusive tiers of the content role.
      if (cap === 'manager') next.delete('editor')
      if (cap === 'editor') next.delete('manager')
      next.delete('owner')
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setWarning('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!EMAIL_RE.test(email.trim())) { setError('Please enter a valid email address'); return }
    if (role === 'member' && capabilities.size === 0) {
      setError('Select at least one capability for a member')
      return
    }
    if (isOwner && selected.size !== 1) {
      setError('A Site Owner must be assigned exactly one site')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          role,
          capabilities: role === 'member' ? [...capabilities] : [],
          sessionIds: isContentUser ? [...selected] : [],
        }),
      })
      const data = (await res.json()) as Partial<CreateUserResponse> & { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed to create user')
        setSaving(false)
        return
      }
      // The account exists now; make it visible behind the dialog either way.
      router.refresh()
      if (data.emailSent === false) {
        // Fail-soft: user was created but the invite email didn't send. Keep the
        // dialog open with a warning so the operator resends it from the row.
        setWarning(`${email.trim()} was created, but the invite email failed to send. Close this and use “Resend invite” on their row.`)
        setSaving(false)
        return
      }
      reset()
      setOpen(false)
    } catch {
      setError('Failed to create user. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 shadow-cyan-base transition-all hover:bg-brand-cyan-dark hover:-translate-y-px hover:shadow-cyan-glow"
      >
        Add User
      </button>
    )
  }

  return <AddUserDialogPanel onClose={() => { reset(); setOpen(false) }} {...{ sessions, name, setName, email, setEmail, role, setRole, capabilities, toggleCapability, selected, toggle, pickSingle, error, warning, saving, handleSubmit, isContentUser, isOwner }} />
}

interface PanelProps {
  onClose: () => void
  sessions: SessionOption[]
  name: string
  setName: (v: string) => void
  email: string
  setEmail: (v: string) => void
  role: Role
  setRole: (r: Role) => void
  capabilities: Set<Capability>
  toggleCapability: (c: Capability) => void
  selected: Set<string>
  toggle: (id: string) => void
  pickSingle: (id: string) => void
  error: string
  warning: string
  saving: boolean
  handleSubmit: (e: React.FormEvent) => void
  isContentUser: boolean
  isOwner: boolean
}

// Separate component so useDialog mounts/unmounts with the panel itself —
// focus is captured on open and restored to the trigger on close.
function AddUserDialogPanel({ onClose, sessions, name, setName, email, setEmail, role, setRole, capabilities, toggleCapability, selected, toggle, pickSingle, error, warning, saving, handleSubmit, isContentUser, isOwner }: PanelProps) {
  const dialogRef = useDialog(onClose)
  // A Site Owner may only be assigned a content-ready site.
  const pickable = isOwner ? sessions.filter(s => s.contentReady) : sessions

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-user-title"
        tabIndex={-1}
        className="w-full max-w-md bg-surface-card border border-border-default rounded-xl p-6 shadow-subtle max-h-[90vh] overflow-y-auto"
      >
        <h2 id="add-user-title" className="text-lg font-heading font-bold text-brand-navy mb-4">Add User</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card">{error}</p>
          )}

          {warning && (
            <p className="text-sm text-warning-strong bg-warning/10 px-3 py-2 rounded-card">{warning}</p>
          )}

          <div className="space-y-1">
            <label className="text-sm font-semibold text-text-secondary font-body">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-text-secondary font-body">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-text-secondary font-body">Account type</label>
            <div className="flex gap-2">
              {([['member', 'Member'], ['admin', 'Admin']] as const).map(([r, labelText]) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex-1 text-xs font-heading font-semibold px-3.5 py-1.5 rounded-pill transition-colors ${
                    role === r
                      ? 'bg-brand-navy text-text-inverse'
                      : 'border border-border-default text-text-secondary hover:bg-surface-subtle'
                  }`}
                >
                  {labelText}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted font-body pt-1">
              {role === 'admin'
                ? 'Admins can do everything.'
                : 'Members hold the capabilities you select below.'}
            </p>
          </div>

          {role === 'member' && (
            <div className="space-y-1">
              <label className="text-sm font-semibold text-text-secondary font-body">Capabilities</label>
              <div className="flex flex-col gap-2">
                {([['manager', 'Manager — view, edit & publish content for assigned clients'], ['editor', 'Editor — proof, edit & stage content for assigned clients, but cannot publish'], ['owner', 'Site Owner — the client for one site: edit & publish their own single site, nothing else'], ['auditor', 'Auditor — run & manage their own site audits']] as const).map(([cap, desc]) => (
                  <label
                    key={cap}
                    className="flex items-start gap-2 cursor-pointer rounded-card border border-border-default px-3 py-2 hover:bg-surface-subtle"
                  >
                    <input
                      type="checkbox"
                      checked={capabilities.has(cap)}
                      onChange={() => toggleCapability(cap)}
                      className="accent-brand-cyan mt-0.5"
                    />
                    <span className="text-sm font-body text-text-primary">{desc}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {isContentUser && (
            <div className="space-y-1">
              <label className="text-sm font-semibold text-text-secondary font-body">
                {isOwner ? 'Assigned site (one)' : `Client access (${selected.size} selected)`}
              </label>
              <div className="border border-border-default rounded-card max-h-48 overflow-y-auto divide-y divide-border-default">
                {pickable.length === 0 && (
                  <p className="text-sm text-text-muted font-body p-3">
                    {isOwner ? 'No content-ready sites yet.' : 'No clients available.'}
                  </p>
                )}
                {pickable.map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-subtle"
                  >
                    <input
                      type={isOwner ? 'radio' : 'checkbox'}
                      name={isOwner ? 'owner-site' : undefined}
                      checked={selected.has(s.id)}
                      onChange={() => (isOwner ? pickSingle(s.id) : toggle(s.id))}
                      className="accent-brand-cyan"
                    />
                    <span className="text-sm font-body text-text-primary truncate">{s.website_url}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-border-default text-text-secondary font-heading font-semibold text-xs py-3 rounded-pill transition-all hover:bg-surface-subtle"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-brand-cyan text-text-inverse font-heading font-semibold text-xs py-3 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Sending invite…' : 'Add & send invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
