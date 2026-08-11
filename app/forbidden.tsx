import Link from 'next/link'

// Rendered by forbidden() (see lib/auth/page-guards) when an authenticated user
// visits a page their capabilities don't allow. Standalone — no admin shell.
export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-page p-8">
      <div className="max-w-md rounded-xl border border-border-default bg-surface-card p-8 text-center shadow-subtle">
        <p className="font-heading text-xs font-semibold uppercase tracking-[0.11em] text-brand-cyan-dark">
          403 — Forbidden
        </p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-brand-navy">
          You don&rsquo;t have access to this page
        </h1>
        <p className="mt-2 font-body text-sm text-text-secondary">
          Your account isn&rsquo;t permitted to view this section. If you think this is a
          mistake, ask an administrator to review your access.
        </p>
        <Link
          href="/admin/home"
          className="mt-6 inline-block rounded-pill bg-brand-cyan px-5 py-2.5 font-heading text-[13px] font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark"
        >
          Back to Home
        </Link>
      </div>
    </main>
  )
}
