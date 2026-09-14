'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CreateNoGoPhraseResponse } from '@/types/no-go-phrases'

const PILL = 'rounded-pill px-3.5 py-1.5 font-heading text-xs font-semibold transition-all'

export default function AddNoGoPhraseDialog() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${PILL} bg-brand-cyan text-text-inverse shadow-cyan-base hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow`}
      >
        Add phrase
      </button>
      {open && <AddDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [phrase, setPhrase] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/no-go-phrases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, note }),
      })
      const data = (await res.json()) as CreateNoGoPhraseResponse & { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed to add phrase')
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-card border border-border-default px-3 py-2 font-body text-sm text-text-primary transition-colors focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/15'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
      <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border-default bg-surface-card p-6 shadow-subtle">
        <h2 className="font-heading text-lg font-bold text-brand-navy">Add no-go phrase</h2>
        <p className="mt-1 font-body text-sm text-text-secondary">
          Banned from every client&apos;s AI-generated content. Matching ignores case and extra
          spacing.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block font-heading text-xs font-semibold text-text-secondary">Phrase</label>
            <input
              className={inputCls}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="receipts in a shoebox"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block font-heading text-xs font-semibold text-text-secondary">Note (optional)</label>
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why it's banned — e.g. overused cliché"
            />
          </div>
          {error && <p className="rounded-card bg-error/10 px-3 py-2 font-body text-sm text-error">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className={`${PILL} border border-border-default text-text-secondary hover:bg-surface-subtle`}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !phrase.trim()}
            className={`${PILL} bg-brand-cyan text-text-inverse hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:bg-text-muted`}
          >
            {busy ? 'Adding…' : 'Add phrase'}
          </button>
        </div>
      </div>
    </div>
  )
}
