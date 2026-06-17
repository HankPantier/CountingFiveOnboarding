'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function AccountPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      // The active session stays valid after the change, so we keep the user
      // in the app and just confirm inline rather than redirecting.
      setSuccess(true)
      setPassword('')
      setConfirm('')
    }
  }

  return (
    <div className="max-w-sm mx-auto px-6 py-10">
      <div className="bg-surface-card rounded-card p-8 shadow-subtle">
        <h1 className="text-2xl font-heading font-bold text-brand-navy mb-2">
          Change password
        </h1>
        <p className="text-sm text-text-secondary font-body mb-6">
          Set a new password for your Revaltus account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-success bg-success/10 px-3 py-2 rounded-card">
              Your password has been updated.
            </p>
          )}

          <div className="space-y-1">
            <label className="text-sm font-semibold text-text-secondary font-body">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-text-secondary font-body">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-cyan text-text-inverse font-heading font-semibold text-sm py-3 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
