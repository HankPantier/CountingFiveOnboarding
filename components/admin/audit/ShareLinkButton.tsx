'use client'

import { useState } from 'react'

const ghostButton =
  'rounded-pill border-2 border-brand-navy px-4 py-2 font-heading text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50'
const copiedButton =
  'rounded-pill border-2 border-success/50 bg-success/10 px-4 py-2 font-heading text-sm font-semibold text-success'

export function ShareLinkButton({
  auditId,
  initialToken,
}: {
  auditId: string
  initialToken: string | null
}) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    setBusy(true)
    try {
      let t = token
      if (!t) {
        const res = await fetch(`/api/audits/${auditId}/share`, { method: 'POST' })
        if (!res.ok) return
        const json = (await res.json()) as { token?: string }
        if (!json.token) return
        t = json.token
        setToken(t)
      }
      await navigator.clipboard.writeText(`${window.location.origin}/audits/${t}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!confirm('Revoke this share link? Anyone using it will lose access.')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/audits/${auditId}/share`, { method: 'DELETE' })
      if (res.ok) setToken(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={copyLink} disabled={busy} className={copied ? copiedButton : ghostButton}>
        {copied ? 'Copied!' : busy ? 'Working…' : 'Copy share link'}
      </button>
      {token && (
        <button
          onClick={revoke}
          disabled={busy}
          title="Stop sharing this report"
          className="font-body text-xs text-text-muted underline-offset-2 hover:text-error hover:underline disabled:opacity-50"
        >
          Revoke
        </button>
      )}
    </div>
  )
}
