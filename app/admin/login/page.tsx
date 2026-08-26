'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const router = useRouter()

  // Supabase's native auth emails (recovery, invite, magic link) verify server-
  // side then redirect here with the session in the URL hash fragment
  // (#access_token=…&refresh_token=…&type=recovery). That's the implicit flow —
  // distinct from the app's own Resend links, which use /auth/confirm + verifyOtp.
  // The hash never reaches the server, so we consume it client-side: establish
  // the session, strip the tokens from the URL, then route by link type.
  useEffect(() => {
    const hash = window.location.hash
    if (hash.length < 2) return
    const params = new URLSearchParams(hash.slice(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const errorDescription = params.get('error_description')

    if (!accessToken && !errorDescription) return

    // Clear the fragment so tokens/errors don't linger in the address bar or history.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)

    if (errorDescription || !accessToken || !refreshToken) {
      // Legitimate effect: surfacing an error parsed from the one-time auth
      // redirect hash on mount, not deriving state from props/render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(errorDescription ?? 'This link is invalid or has expired. Request a new one below.')
      return
    }

    setRecovering(true)
    const type = params.get('type')
    const supabase = createClient()
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setRecovering(false)
          setError(error.message)
          return
        }
        // recovery/invite → let them set a new password; anything else → into the app.
        router.replace(type === 'recovery' || type === 'invite' ? '/admin/set-password' : '/admin/home')
      })
  }, [router])

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
      router.push('/admin/home')
    }
  }

  if (recovering) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-page">
        <div className="w-full max-w-sm bg-surface-card rounded-card p-8 shadow-subtle text-center">
          <p className="text-sm text-text-secondary font-body">Completing sign-in…</p>
        </div>
      </div>
    )
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
              placeholder="admin@revaltus.com"
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
            className="w-full bg-brand-cyan text-text-inverse font-heading font-semibold text-xs py-3 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-center">
          <Link
            href="/admin/forgot-password"
            className="text-sm text-brand-cyan font-body hover:underline"
          >
            Forgot password?
          </Link>
        </p>
      </div>
    </div>
  )
}
