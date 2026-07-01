'use client'

import Link from 'next/link'

const primaryButton =
  'rounded-pill bg-brand-cyan px-4 py-2 font-heading text-sm font-semibold whitespace-nowrap text-text-inverse transition-all hover:bg-brand-cyan-dark'
const ghostButton =
  'rounded-pill border border-brand-navy px-4 py-2 font-heading text-sm font-semibold whitespace-nowrap text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse'

// Route-level error boundary for the audit report. A completed audit's `result`
// is an editable JSONB blob, so a malformed shape (e.g. from an Edit-with-AI
// write) can throw during render. The render path guards known fields, but this
// is the backstop: degrade to a recoverable page instead of a full 500.
export default function AuditReportError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="font-heading text-xl font-bold text-brand-navy">
        This audit couldn&apos;t be displayed
      </h1>
      <p className="font-body text-sm text-text-secondary">
        The report data appears to be malformed — this can happen after an edit. Try again,
        or head back and re-run the audit if the problem persists.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={reset} className={primaryButton}>
          Try again
        </button>
        <Link href="/admin/audits" className={ghostButton}>
          Back to audits
        </Link>
      </div>
    </div>
  )
}
