'use client'

import Link from 'next/link'
import { useEffect } from 'react'

const primaryButton =
  'rounded-pill bg-brand-cyan px-4 py-2 font-heading text-sm font-semibold whitespace-nowrap text-text-inverse transition-all hover:bg-brand-cyan-dark'
const ghostButton =
  'rounded-pill border border-brand-navy px-4 py-2 font-heading text-sm font-semibold whitespace-nowrap text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse'

// Root error boundary: any server component or render error below the root
// layout that lacks a closer boundary lands here instead of a blank 500.
export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[error-boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-6">
      <div className="flex max-w-lg flex-col items-center gap-4 text-center">
        <h1 className="font-heading text-xl font-bold text-brand-navy">Something went wrong</h1>
        <p className="font-body text-sm text-text-secondary">
          An unexpected error interrupted this page. Try again — if it keeps happening, let us
          know and we&apos;ll take a look.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button onClick={reset} className={primaryButton}>
            Try again
          </button>
          <Link href="/" className={ghostButton}>
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
