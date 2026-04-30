'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/admin/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-page">
      <div className="w-full max-w-sm bg-surface-card rounded-card p-8 shadow-subtle">
        <h1 className="text-2xl font-heading font-bold text-brand-navy mb-6">
          Admin Login
        </h1>

        <form onSubmit={handleLogin} className="space-y-4">
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
              placeholder="admin@countingfive.com"
              required
              className="w-full border border-border-default rounded-card px-3 py-2 text-text-primary font-body text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-text-secondary font-body">
              Password
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-cyan text-text-inverse font-heading font-semibold text-sm py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
