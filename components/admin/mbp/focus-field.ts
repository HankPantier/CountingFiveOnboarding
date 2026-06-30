// Client-only helper shared by the completeness "fill" links and the on-load
// deep-link handler: open the field's section, scroll the field row into view,
// and tell that field's inline editor to enter edit mode. fieldPath uses dot
// form (e.g. business.foundingYear, niches.0.painPoints) — the same paths the
// MBP document renders as `mbp-field-${fieldPath}` row ids.
export const MBP_FOCUS_EVENT = 'mbp:focus-field'

export function focusMbpField(fieldPath: string): void {
  const sectionKey = fieldPath.split('.')[0]
  const section = document.getElementById(`mbp-${sectionKey}`)
  if (section instanceof HTMLDetailsElement) section.open = true
  // Defer so the just-opened <details> lays out its rows before we scroll/focus.
  requestAnimationFrame(() => {
    const row = document.getElementById(`mbp-field-${fieldPath}`)
    ;(row ?? section)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.dispatchEvent(new CustomEvent(MBP_FOCUS_EVENT, { detail: fieldPath }))
  })
}
