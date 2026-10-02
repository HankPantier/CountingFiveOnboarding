// Server-only (GitHub read). The sections a page renders, as heading → block
// id, read from its draft markdown's `<!-- block: … -->` annotations (the
// template's own section grammar). The design chat quotes it so "lock the What
// we do area" resolves to [data-block="service-cards"] instead of a guess.
// Never throws: an unreadable page is simply an empty list.
import { templateSectionPattern } from '@/lib/editor/block-annotation'
import { urlToContentPath } from '@/lib/editor/content-paths'
import { readOptional } from './apply-bundle'
import { isCssTarget, type CssTarget } from './css-targets'

export type PageSection = { heading: string; block: CssTarget }

const MAX_SECTIONS = 30
const MAX_HEADING = 80

export function pageContentPath(page: string): string | null {
  return page === '/' ? 'content/pages/home.md' : urlToContentPath(page)
}

export function parsePageSections(markdown: string): PageSection[] {
  const out: PageSection[] = []
  for (const m of markdown.matchAll(templateSectionPattern())) {
    const block = m[1]
    const heading = (m[7] ?? '').replace(/[*_`#]/g, '').trim().slice(0, MAX_HEADING)
    if (isCssTarget(block) && heading) out.push({ heading, block })
    if (out.length >= MAX_SECTIONS) break
  }
  return out
}

export async function readPageSections(githubRepo: string, page: string): Promise<PageSection[]> {
  const path = pageContentPath(page)
  if (!path) return []
  try {
    const file = await readOptional(githubRepo, path)
    return file ? parsePageSections(file.content) : []
  } catch (err) {
    console.warn('[design-chat] page sections unavailable', err)
    return []
  }
}
