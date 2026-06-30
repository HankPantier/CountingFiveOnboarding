import DOMPurify from 'isomorphic-dompurify'

// Sanitizes an uploaded SVG before it is ever stored, committed to a repo, or
// served. file-type cannot validate SVG (it's text, no magic bytes) and raw SVG
// can carry scripts / event handlers / external refs, so we run DOMPurify with
// the SVG profile and strip the dangerous bits explicitly. Returns the cleaned
// markup, or null when the input isn't a usable SVG after sanitization.
export function sanitizeSvg(input: string): string | null {
  const clean = DOMPurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick'],
  })
  if (!clean || !/<svg[\s>]/i.test(clean)) return null
  return clean
}
