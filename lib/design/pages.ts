// Pure: choose which of a client's live pages the Design Studio previews and
// renders by default (ported from the retired export-brief's
// pickRepresentativePages). Home is always first; then one service page
// (prefer a deep /services/* page — it carries the richest blocks), an
// about/team page, and contact. Missing roles are skipped. …and, on L4 sites,
// the template's /design-specimen (every block once).
import { contentPathToUrl } from '@/lib/editor/content-paths'

export const SPECIMEN_PATH = '/design-specimen'
export type PreviewPage = { key: 'home' | 'service' | 'about' | 'contact' | 'specimen'; path: string }

const ABOUT_RE = /^\/(about|about-us|who-we-are|our-firm|our-story|team|our-team)$/
const CONTACT_RE = /^\/contact(-us)?$/

export function pickRepresentativePages(
  contentPaths: string[],
  opts: { specimen?: boolean } = {}
): { picks: PreviewPage[]; pages: string[] } {
  const pages = Array.from(
    new Set(
      contentPaths
        .filter((p) => /^content\/pages\/[^/]+\.md$/.test(p))
        .map((p) => contentPathToUrl(p))
        .filter((u): u is string => typeof u === 'string')
    )
  ).sort()

  const picks: PreviewPage[] = [{ key: 'home', path: '/' }]
  const deepService = pages.find((u) => u.startsWith('/services/'))
  const service = deepService ?? pages.find((u) => u === '/services')
  if (service) picks.push({ key: 'service', path: service })
  const about = pages.find((u) => ABOUT_RE.test(u))
  if (about) picks.push({ key: 'about', path: about })
  const contact = pages.find((u) => CONTACT_RE.test(u))
  if (contact) picks.push({ key: 'contact', path: contact })
  if (opts.specimen) picks.push({ key: 'specimen', path: SPECIMEN_PATH })
  return { picks, pages }
}
