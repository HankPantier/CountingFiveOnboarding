'use client'

import { useEffect, useState } from 'react'
import type { PreviewPage } from '@/lib/design/pages'
import { designApi } from './api'
import { FIELD } from './styles'

const PICK_LABELS: Record<PreviewPage['key'], string> = { home: 'Home', service: 'Service page', about: 'About', contact: 'Contact' }

// Which page of the client's site a run renders (default: home). Options come
// from GET design/pages (the draft's content pages + representative picks).
export default function PagePicker({
  sessionId,
  value,
  onChange,
  disabled,
}: {
  sessionId: string
  value: string
  onChange: (path: string) => void
  disabled?: boolean
}) {
  const [data, setData] = useState<{ picks: PreviewPage[]; pages: string[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await designApi<{ picks: PreviewPage[]; pages: string[] }>(`/api/edit/${sessionId}/design/pages`)
        if (!cancelled) setData(res)
      } catch {
        // The picker falls back to the home page only.
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const pickPaths = new Set((data?.picks ?? []).map((p) => p.path))
  const others = (data?.pages ?? []).filter((p) => !pickPaths.has(p))

  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-heading text-xs font-semibold text-text-primary">Page to design against</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={FIELD}>
        {!pickPaths.has(value) && !others.includes(value) && <option value={value}>{value}</option>}
        {(data?.picks ?? []).map((p) => (
          <option key={p.path} value={p.path}>
            {PICK_LABELS[p.key]} — {p.path}
          </option>
        ))}
        {others.length > 0 && (
          <optgroup label="Other pages">
            {others.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  )
}
