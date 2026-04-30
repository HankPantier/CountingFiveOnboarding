'use client'
import { useState } from 'react'

export default function CopyLinkButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false)

  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/session/${sessionId}`
    : `/session/${sessionId}`

  function copy() {
    const fullUrl = `${window.location.origin}/session/${sessionId}`
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="bg-surface-card border border-border-default rounded-lg px-4 py-3 mb-4">
      <p className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide mb-2">
        Client Session Link
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs font-mono text-text-primary bg-surface-subtle rounded px-2 py-1.5 truncate">
          {url}
        </code>
        <button
          onClick={copy}
          className={`flex-shrink-0 text-xs font-heading font-semibold px-3 py-1.5 rounded-pill border transition-all ${
            copied
              ? 'border-green-300 text-green-700 bg-green-50'
              : 'border-border-default text-text-secondary hover:border-brand-cyan hover:text-brand-cyan'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
