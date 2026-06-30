'use client'
import { focusMbpField } from '@/components/admin/mbp/focus-field'

// A "Still needed" item: one click opens the field's section, scrolls to it, and
// opens its inline editor focused. fieldPath is the dot-form path used by the
// MBP document row ids.
export default function MbpFillLink({
  fieldPath,
  label,
}: {
  fieldPath: string
  label: string
}) {
  return (
    <button
      onClick={() => focusMbpField(fieldPath)}
      className="text-sm font-body text-brand-cyan hover:text-brand-navy hover:underline text-left transition-colors"
    >
      {label} <span aria-hidden className="text-xs">▸</span>
    </button>
  )
}
