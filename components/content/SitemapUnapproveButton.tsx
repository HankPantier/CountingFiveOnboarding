'use client'

import { useState } from 'react'

export default function SitemapUnapproveButton({
  contentJobId,
}: {
  contentJobId: string
}) {
  const [busy, setBusy] = useState(false)

  const unapprove = async () => {
    if (
      !window.confirm(
        'Un-approve the sitemap to revise it? Re-confirming will rebuild research, outlines, and any generated page content for this job.'
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/sitemap/unapprove`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to un-approve')
      window.location.reload()
    } catch {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={unapprove}
      disabled={busy}
      className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-colors hover:bg-surface-subtle disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? 'Reopening…' : 'Un-approve & revise'}
    </button>
  )
}
