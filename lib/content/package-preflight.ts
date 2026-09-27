// Package preflight checks that run on the assembled page files before the
// deliverable ships. Pure — the assembler feeds it the built files.

// The client template's own placeholder images (scripts/generate-placeholder.ts
// in counting-five-client-template: solid #1f2937 / #334155 blocks referenced
// by its seed content/pages/home.md). The imageCoverage guard can't catch them
// because the files "exist" in every seeded repo, so a page that still points
// at one ships a dark empty rectangle as its hero (Slachta).
export const TEMPLATE_PLACEHOLDER_ASSETS = ['hero-office.png', 'team-photo.png'] as const

export type PlaceholderRef = { page: string; ref: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PLACEHOLDER_RES = TEMPLATE_PLACEHOLDER_ASSETS.map(
  (name) => [name, new RegExp(`(^|[\\s/"'(:=])${escapeRe(name)}(?=$|[\\s"')?#])`, 'm')] as const,
)
// An image with no source: markdown ![alt]() or <img src=""> — renders broken.
const EMPTY_MD_IMAGE = /!\[[^\]]*\]\(\s*\)/
const EMPTY_HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*(""|'')/i

/** Every page that references a template placeholder image or an empty image source. */
export function findPlaceholderRefs(files: Array<{ filename: string; content: string }>): PlaceholderRef[] {
  const out: PlaceholderRef[] = []
  for (const { filename, content } of files) {
    for (const [name, re] of PLACEHOLDER_RES) {
      if (re.test(content)) out.push({ page: filename, ref: name })
    }
    if (EMPTY_MD_IMAGE.test(content) || EMPTY_HTML_IMAGE.test(content)) {
      out.push({ page: filename, ref: '(image with an empty src)' })
    }
  }
  return out
}

export function placeholderRefsMessage(refs: PlaceholderRef[]): string {
  const shown = refs
    .slice(0, 5)
    .map((r) => `${r.page} → ${r.ref}`)
    .join('; ')
  const more = refs.length > 5 ? ` (and ${refs.length - 5} more)` : ''
  return `Package blocked: ${refs.length} page image reference(s) point at the site template's placeholder art or have no source, so they would ship as empty blocks: ${shown}${more}. Give those pages a real image (Re-pull images, or edit the page's hero/inline image), then package again.`
}
