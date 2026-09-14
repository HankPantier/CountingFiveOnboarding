'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NoGoPhraseSummary } from '@/types/no-go-phrases'

const actionBtn =
  'rounded-pill border border-border-default px-3 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-all hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50'

export default function NoGoPhraseRow({ phrase }: { phrase: NoGoPhraseSummary }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [phraseText, setPhraseText] = useState(phrase.phrase)
  const [note, setNote] = useState(phrase.note ?? '')
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy('save')
    setError(null)
    try {
      const res = await fetch(`/api/admin/no-go-phrases/${phrase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase: phraseText, note }),
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to save')
        return
      }
      setEditing(false)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!confirm(`Remove “${phrase.phrase}” from the no-go list?`)) return
    setBusy('delete')
    setError(null)
    try {
      const res = await fetch(`/api/admin/no-go-phrases/${phrase.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to delete')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const inputCls =
    'w-full rounded-card border border-border-default px-2.5 py-1.5 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/15'

  return (
    <>
      <tr className="border-b border-border-default last:border-0 hover:bg-surface-subtle">
        <td className="px-4 py-3 font-heading font-semibold text-text-primary">
          {editing ? (
            <input className={inputCls} value={phraseText} onChange={(e) => setPhraseText(e.target.value)} />
          ) : (
            phrase.phrase
          )}
        </td>
        <td className="px-4 py-3 font-body text-text-secondary">
          {editing ? (
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
          ) : (
            phrase.note ?? <span className="text-text-muted">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2">
            {editing ? (
              <>
                <button
                  onClick={save}
                  disabled={busy !== null || !phraseText.trim()}
                  className="rounded-pill bg-brand-cyan px-3 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:opacity-50"
                >
                  {busy === 'save' ? '…' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setPhraseText(phrase.phrase)
                    setNote(phrase.note ?? '')
                    setError(null)
                  }}
                  disabled={busy !== null}
                  className={actionBtn}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} disabled={busy !== null} className={actionBtn}>
                  Edit
                </button>
                <button
                  onClick={remove}
                  disabled={busy !== null}
                  className="rounded-pill border border-error/30 px-3 py-1.5 font-heading text-xs font-semibold text-error transition-all hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === 'delete' ? '…' : 'Delete'}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {error && (
        <tr className="border-b border-border-default bg-surface-subtle">
          <td colSpan={3} className="px-4 py-3">
            <p className="rounded-card bg-error/10 px-3 py-2 font-body text-sm text-error">{error}</p>
          </td>
        </tr>
      )}
    </>
  )
}
