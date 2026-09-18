import type { SessionSchema } from '@/types/session-schema'
import { activeNiches } from './active-niches'
import { activeServices } from './active-services'
import { activeSubCategories } from './active-subcategories'
import { slugify } from './sitemap-utils'

// Resolves the operator's Audit Review page-vs-block decision into structure the
// sitemap + page-intent layers consume. `pageTreatment` is a SECOND dimension on
// top of status: an item that reaches here is already active (status !== dropped)
// via the active* choke points; this only splits the survivors into "gets its own
// page" vs "renders as a section on a parent page."
//
// Defaults matter and differ by kind:
//  - services / niches: absent pageTreatment ⇒ own PAGE (legacy behavior — every
//    kept service/niche got a page).
//  - sub-services: absent pageTreatment ⇒ BLOCK (they have always rendered as
//    sections on their niche page; only an explicit 'page' promotes one).

type Niche = NonNullable<SessionSchema['niches']>[number]
type Service = NonNullable<SessionSchema['services']>[number]
type SubCategory = NonNullable<Niche['subCategories']>[number]

// Canonical URL key for parent matching — trims, drops trailing slashes,
// lowercases (mirrors normUrl in sitemap-proposer without importing it, to avoid
// a cycle: sitemap-proposer imports this module).
const normUrl = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase()

export function partitionServices(schema: Pick<SessionSchema, 'services'>): {
  pageServices: Service[]
  blockServices: Service[]
} {
  const pageServices: Service[] = []
  const blockServices: Service[] = []
  for (const s of activeServices(schema)) {
    if (s.pageTreatment === 'block') blockServices.push(s)
    else pageServices.push(s)
  }
  return { pageServices, blockServices }
}

export function partitionNiches(schema: Pick<SessionSchema, 'niches'>): {
  pageNiches: Niche[]
  blockNiches: Niche[]
} {
  const pageNiches: Niche[] = []
  const blockNiches: Niche[] = []
  for (const n of activeNiches(schema)) {
    if (n.pageTreatment === 'block') blockNiches.push(n)
    else pageNiches.push(n)
  }
  return { pageNiches, blockNiches }
}

export function partitionSubCategories(niche: Pick<Niche, 'subCategories'>): {
  pageSubs: SubCategory[]
  blockSubs: SubCategory[]
} {
  const pageSubs: SubCategory[] = []
  const blockSubs: SubCategory[] = []
  for (const s of activeSubCategories(niche)) {
    if (s.pageTreatment === 'page') pageSubs.push(s)
    else blockSubs.push(s)
  }
  return { pageSubs, blockSubs }
}

// The parent page a block item renders on. An operator-picked `parent` (a sitemap
// URL) always wins; otherwise the category-hub default. Sub-services default to
// their owning niche page (caller supplies its slug).
export function resolveBlockParent(
  item: { parent?: string },
  kind: 'service' | 'niche' | 'sub',
  ctx?: { nicheSlug?: string },
): string {
  const picked = item.parent?.trim()
  if (picked) return picked
  if (kind === 'service') return '/services'
  if (kind === 'niche') return '/industries'
  return ctx?.nicheSlug ? `/industries/${ctx.nicheSlug}` : '/industries'
}

export interface PageBlocks {
  services: string[]
  niches: string[]
  subs: Array<{ niche: string; name: string }>
}

// The block items (by name) that must render AS SECTIONS on the given page URL.
// Used by page-intent to append an "ALSO INCLUDE" directive to that page's
// outline so a block service/niche/sub-service still gets covered — just not on
// its own URL.
export function blocksForPage(schema: SessionSchema, pageUrl: string): PageBlocks {
  const target = normUrl(pageUrl)
  const out: PageBlocks = { services: [], niches: [], subs: [] }

  const { blockServices } = partitionServices(schema)
  for (const s of blockServices) {
    if (s.name?.trim() && normUrl(resolveBlockParent(s, 'service')) === target) out.services.push(s.name)
  }

  const { blockNiches, pageNiches } = partitionNiches(schema)
  for (const n of blockNiches) {
    if (n.name?.trim() && normUrl(resolveBlockParent(n, 'niche')) === target) out.niches.push(n.name)
  }

  // Block sub-services default to their owning niche page. Only kept (page/legacy)
  // niches host sub-services; a block niche has no page to host them on.
  for (const n of pageNiches) {
    if (!n.name?.trim()) continue
    const nicheSlug = slugify(n.name)
    const { blockSubs } = partitionSubCategories(n)
    for (const sub of blockSubs) {
      if (sub.name?.trim() && normUrl(resolveBlockParent(sub, 'sub', { nicheSlug })) === target) {
        out.subs.push({ niche: n.name, name: sub.name })
      }
    }
  }

  return out
}

// True when the page has any block items to fold in — lets callers skip the
// directive entirely for the common case.
export function hasBlocks(b: PageBlocks): boolean {
  return b.services.length > 0 || b.niches.length > 0 || b.subs.length > 0
}
