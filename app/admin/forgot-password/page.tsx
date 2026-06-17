'use client'
import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    if (res.ok) {
      setSent(true)
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-page">
      <div className="w-full max-w-sm bg-surface-card rounded-card p-8 shadow-subtle">
        <h1 className="text-2xl font-heading font-bold text-brand-navy mb-2">
          Reset your password
        </h1>

        {sent ? (
          <>
            <p className="text-sm text-text-secondary font-body mb-6">
              If an account exists for that email, we&rsquo;ve sent a link to reset your password.
              Check your inbox.
            </p>
            <Link
              href="/admin/login"
              className="text-sm text-brand-cyan font-body hover:underline"
            >
              ← Back to login
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary font-body mb-6">
              Enter your admin email and we&rsquo;ll send you a link to set a new password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card">
                  {error}
                </p>
              )}

              <div className="space-y-1">
                <label className="text-sm font-semibold text-text-secondary font-body">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@revaltus.com"
                  required
                  className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-cyan text-text-inverse font-heading font-semibold text-sm py-3 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="mt-4 text-center">
              <Link
                href="/admin/login"
                className="text-sm text-brand-cyan font-body hover:underline"
              >
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
