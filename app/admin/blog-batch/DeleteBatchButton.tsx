'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Delete a batch. `redirect` sends the operator back to the list (detail page);
// omit it to refresh in place (list rows).
export default function DeleteBatchButton({
  batchId,
  redirect,
  label = 'Delete',
  size = 'md',
}: {
  batchId: string
  redirect?: string
  label?: string
  size?: 'sm' | 'md'
}) {
  const sizeClasses = size === 'sm' ? 'text-[11px] px-2.5 py-1' : 'text-xs px-3.5 py-1.5'
  const [state, setState] = useState<'idle' | 'deleting' | 'error'>('idle')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleDelete() {
    if (
      !confirm(
        'Delete this batch? The client drafts already generated stay in each client’s repo — this removes the batch grouping only and cannot be undone.'
      )
    )
      return
    setState('deleting')
    setError('')
    try {
      const res = await fetch(`/api/blog-batches/${batchId}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Delete failed')
        setState('error')
        return
      }
      if (redirect) router.push(redirect)
      else router.refresh()
    } catch {
      setError('Delete failed. Please try again.')
      setState('error')
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={state === 'deleting'}
        className={`inline-flex items-center rounded-pill border border-error/20 text-error font-heading font-semibold ${sizeClasses} transition-all hover:bg-error/10 hover:border-error/50 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {state === 'deleting' ? 'Deleting…' : label}
      </button>
      {error && <span className="text-error text-xs font-body">{error}</span>}
    </span>
  )
}
