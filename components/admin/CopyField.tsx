'use client'

import { useState } from 'react'

// Read-only value with a copy button. Used to surface feed URLs and one-time
// secrets in the WordPress-sites admin UI.
export default function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div>
      {label && <div className="mb-1 font-heading text-xs font-semibold text-text-secondary">{label}</div>}
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 truncate rounded-card border border-border-default bg-surface-subtle px-3 py-2 text-[12.5px] text-text-primary ${mono ? 'font-mono' : ''}`}>
          {value}
        </code>
        <button
          onClick={copy}
          className={`flex-shrink-0 rounded-pill border px-3 py-1.5 font-heading text-xs font-semibold transition-all ${
            copied
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border-default text-text-secondary hover:border-brand-cyan hover:text-brand-cyan'
          }`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
