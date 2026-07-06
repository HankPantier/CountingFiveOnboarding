import Link from 'next/link'

const primaryButton =
  'rounded-pill bg-brand-cyan px-4 py-2 font-heading text-sm font-semibold whitespace-nowrap text-text-inverse transition-all hover:bg-brand-cyan-dark'

// Branded 404 for every notFound() call (session, review, audits, content)
// and unknown URLs — replaces the framework default.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-6">
      <div className="flex max-w-lg flex-col items-center gap-4 text-center">
        <p className="font-heading text-sm font-semibold tracking-wide text-brand-cyan">404</p>
        <h1 className="font-heading text-xl font-bold text-brand-navy">Page not found</h1>
        <p className="font-body text-sm text-text-secondary">
          This page doesn&apos;t exist or the link has expired. Check the URL, or head back home.
        </p>
        <Link href="/" className={`mt-2 ${primaryButton}`}>
          Go home
        </Link>
      </div>
    </div>
  )
}
