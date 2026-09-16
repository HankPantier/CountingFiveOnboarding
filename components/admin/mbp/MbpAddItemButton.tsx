'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ARRAY_ITEM_TEMPLATES, ARRAY_ITEM_LABELS } from '@/lib/mbp/section-templates'

// Appends a blank templated item to an MBP array section so its subfields render
// as editable blanks. Writes directly (a manual admin edit — the human is the
// check), reusing the session PATCH route + deepSetPath's index-append semantics.
export default function MbpAddItemButton({
  sessionId,
  sectionKey,
  count,
}: {
  sessionId: string
  sectionKey: string
  count: number
}) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const template = ARRAY_ITEM_TEMPLATES[sectionKey]
  const label = ARRAY_ITEM_LABELS[sectionKey] ?? 'item'
  if (!template) return null

  async function add() {
    setBusy(true)
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldPath: `${sectionKey}.${count}`,
          value: template,
          isAdminOverride: true,
        }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy}
      className="mt-1 mb-2 text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors disabled:opacity-50"
    >
      {busy ? 'Adding…' : `＋ Add ${label}`}
    </button>
  )
}
