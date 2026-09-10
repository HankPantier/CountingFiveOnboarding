// Page files encode URL depth in the filename with `--`: services--tax--business-tax.md
// is /services/tax/business-tax. Shared by the file tree and the nav-aware sidebar
// so both derive segments and sort identically.

export type PageFile = { path: string; sha: string }

// Segments of a page file's URL path, from its filename.
// content/pages/services--tax.md → ['services', 'tax']
export function pageSegments(path: string): string[] {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/, '').split('--')
}

// Sort pages segment-by-segment so "about.md" sorts before "about--our-story.md"
// (plain alphabetical puts the child first because '-' < '.').
export function sortPages<T extends { path: string }>(pages: T[]): T[] {
  return [...pages].sort((a, b) => {
    const sa = pageSegments(a.path)
    const sb = pageSegments(b.path)
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if (sa[i] === undefined) return -1
      if (sb[i] === undefined) return 1
      const cmp = sa[i].localeCompare(sb[i])
      if (cmp !== 0) return cmp
    }
    return 0
  })
}
