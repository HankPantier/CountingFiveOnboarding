'use client'
import { useEffect } from 'react'
import { focusMbpField } from '@/components/admin/mbp/focus-field'

// Honors a `#mbp-field-<path>` deep link (e.g. from the session detail page's
// "fill missing fields" CTA): on load, open that field's section and focus its
// editor. Renders nothing.
export default function MbpDeepLinkFocus() {
  useEffect(() => {
    const prefix = '#mbp-field-'
    const hash = window.location.hash
    if (!hash.startsWith(prefix)) return
    const path = decodeURIComponent(hash.slice(prefix.length))
    // Defer so MbpDocument's sections/rows are mounted before we target them.
    const t = setTimeout(() => focusMbpField(path), 100)
    return () => clearTimeout(t)
  }, [])
  return null
}
