'use client'

// Anchor from "Still needed" to the document section that holds that field —
// expands the collapsed block and scrolls it into view.
export default function MbpSectionLink({
  sectionKey,
  label,
}: {
  sectionKey: string
  label: string
}) {
  function go() {
    const el = document.getElementById(`mbp-${sectionKey}`)
    if (!el) return
    if (el instanceof HTMLDetailsElement) el.open = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <button
      onClick={go}
      className="text-sm font-body text-brand-cyan hover:text-brand-navy hover:underline text-left transition-colors"
    >
      {label}
    </button>
  )
}
