import type { SessionSchema } from '@/types/session-schema'
import type { Database } from '@/types/database'
import { parentChain, slugify } from './sitemap-utils'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']
type SitemapPage = { url: string; title: string; parent?: string; status: string }
type Location = NonNullable<SessionSchema['locations']>[number]
type TeamMember = NonNullable<SessionSchema['team']>[number]

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function originOf(websiteUrl: string): string {
  return websiteUrl.replace(/\/$/, '')
}

function absoluteUrl(websiteUrl: string, path: string): string {
  return originOf(websiteUrl) + (path.startsWith('/') ? path : `/${path}`)
}

export function locationSlug(loc: Location): string {
  const base = nonEmpty(loc.name) ? loc.name : nonEmpty(loc.city) ? loc.city : 'office'
  return slugify(base)
}

function locationId(websiteUrl: string, loc: Location): string {
  return `${originOf(websiteUrl)}/#location-${locationSlug(loc)}`
}

// /locations/tyngsborough → "tyngsborough"
function urlLeafSlug(url: string): string | null {
  const match = url.replace(/\/$/, '').match(/\/locations\/([a-z0-9-]+)$/i)
  return match ? match[1].toLowerCase() : null
}

function sameAsLinks(schema: SessionSchema): string[] {
  const links: string[] = []
  const channels = schema.culture?.socialMediaChannels ?? []
  for (const entry of channels) {
    // entries are formatted "Platform: https://..."
    const url = entry.split(/:\s*/).slice(1).join(': ').trim()
    if (url.startsWith('http')) links.push(url)
  }
  if (nonEmpty(schema.culture?.linkedIn?.url)) links.push(schema.culture!.linkedIn!.url as string)
  if (nonEmpty(schema.business?.googleBusinessProfile?.url)) {
    links.push(schema.business!.googleBusinessProfile!.url as string)
  }
  return Array.from(new Set(links))
}

function buildOrganization(schema: SessionSchema, websiteUrl: string): Record<string, unknown> {
  const firmName = schema.business?.name ?? 'Firm'
  const origin = originOf(websiteUrl)
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: firmName,
    url: origin,
    logo: `${origin}/logo.png`,
  }
  const sameAs = sameAsLinks(schema)
  if (sameAs.length) node.sameAs = sameAs
  if (nonEmpty(schema.business?.foundingYear)) {
    node.foundingDate = schema.business!.foundingYear
  }
  return node
}

function buildLocalBusinessForLocation(
  schema: SessionSchema,
  websiteUrl: string,
  loc: Location,
  multiLocation: boolean
): Record<string, unknown> | null {
  if (!loc || !nonEmpty(loc.city)) return null
  const firmName = schema.business?.name ?? 'Firm'
  const origin = originOf(websiteUrl)

  const address: Record<string, unknown> = { '@type': 'PostalAddress' }
  const street = [loc.street, loc.line2].filter(nonEmpty).join(' ').trim()
  if (street) address.streetAddress = street
  if (nonEmpty(loc.city)) address.addressLocality = loc.city
  if (nonEmpty(loc.state)) address.addressRegion = loc.state
  if (nonEmpty(loc.zip)) address.postalCode = loc.zip
  address.addressCountry = 'US'

  // Disambiguate names when multiple offices ship on the same page.
  const displayName = multiLocation
    ? `${firmName} — ${loc.name && loc.name.trim() ? loc.name : loc.city}`
    : firmName

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'AccountingService',
    '@id': locationId(websiteUrl, loc),
    name: displayName,
    url: origin,
    address,
  }
  if (nonEmpty(loc.phone)) node.telephone = loc.phone
  if (nonEmpty(loc.email)) node.email = loc.email

  // Prefer structured service areas (geo landing-page targeting) over the
  // free-text geographicScope when present.
  const areas = schema.business?.serviceAreas ?? []
  if (areas.length) {
    node.areaServed = areas
      .map(a => {
        const name = [a.city, a.county, a.state].filter(nonEmpty).join(', ')
        if (!name) return null
        // A county-only entry is an AdministrativeArea; anything with a city is a City.
        return { '@type': nonEmpty(a.city) ? 'City' : 'AdministrativeArea', name }
      })
      .filter((x): x is { '@type': string; name: string } => x !== null)
  } else if (nonEmpty(schema.business?.geographicScope)) {
    node.areaServed = schema.business!.geographicScope
  }

  const openingHours = (loc.openingHours ?? []).filter(
    h => Array.isArray(h.dayOfWeek) && h.dayOfWeek.length > 0 && nonEmpty(h.opens) && nonEmpty(h.closes)
  )
  if (openingHours.length) {
    node.openingHoursSpecification = openingHours.map(h => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.dayOfWeek,
      opens: h.opens,
      closes: h.closes,
    }))
  }

  if (loc.geo && typeof loc.geo.lat === 'number' && typeof loc.geo.lng === 'number') {
    node.geo = { '@type': 'GeoCoordinates', latitude: loc.geo.lat, longitude: loc.geo.lng }
  }

  if (nonEmpty(schema.business?.priceRange)) node.priceRange = schema.business!.priceRange
  if (nonEmpty(loc.gbpUrl)) node.sameAs = [loc.gbpUrl]

  // Aggregate rating only on the primary (first) location to avoid claiming the
  // same rating for every office.
  const rating = schema.reputation?.googleRating
  if (rating && schema.locations?.[0] === loc) {
    const ratingMatch = String(rating).match(/([\d.]+)/)
    if (ratingMatch) {
      node.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: ratingMatch[1],
        reviewCount: '1',
      }
    }
  }

  return node
}

function buildAllLocalBusinesses(schema: SessionSchema, websiteUrl: string): Array<{ loc: Location; node: Record<string, unknown> }> {
  const locations = schema.locations ?? []
  const multi = locations.length > 1
  const out: Array<{ loc: Location; node: Record<string, unknown> }> = []
  for (const loc of locations) {
    const node = buildLocalBusinessForLocation(schema, websiteUrl, loc, multi)
    if (node) out.push({ loc, node })
  }
  return out
}

function buildBreadcrumbList(
  page: GeneratedPage,
  sitemap: SitemapPage[],
  websiteUrl: string
): Record<string, unknown> | null {
  const byUrl = new Map(sitemap.map(p => [p.url, p]))
  const chain = parentChain(page.page_url, byUrl)
  if (chain.length === 0) return null

  const items = chain.map((entry, idx) => ({
    '@type': 'ListItem',
    position: idx + 1,
    name: entry.title,
    item: absoluteUrl(websiteUrl, entry.url),
  }))

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  }
}

function buildFAQPage(page: GeneratedPage): Record<string, unknown> | null {
  const faq = (page.faq_block as Array<{ question: string; answer: string }> | null) ?? []
  if (!Array.isArray(faq) || faq.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq
      .filter(f => nonEmpty(f.question) && nonEmpty(f.answer))
      .map(f => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
  }
}

function buildPageTypeNode(
  page: GeneratedPage,
  schema: SessionSchema,
  websiteUrl: string,
  locations: Array<{ loc: Location; node: Record<string, unknown> }>
): Record<string, unknown> {
  const origin = originOf(websiteUrl)
  const url = nonEmpty(page.canonical_url) ? page.canonical_url : absoluteUrl(websiteUrl, page.page_url)
  const firmName = schema.business?.name ?? 'Firm'

  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.meta_title ?? page.page_title,
    url,
    description: page.meta_description ?? '',
    isPartOf: { '@type': 'WebSite', name: firmName, url: origin },
  }

  // If this is a /locations/<slug> page, bind it to that LocalBusiness.
  const leaf = urlLeafSlug(page.page_url)
  if (leaf) {
    const match = locations.find(({ loc }) => locationSlug(loc) === leaf)
    if (match) {
      base.mainEntity = { '@id': match.node['@id'] }
      return base
    }
  }

  // Home page is the canonical destination for the primary LocalBusiness.
  // Bind it to the first location's @id so crawlers know "/" represents the firm.
  const isHome = page.page_url === '/' || page.page_url === ''
  if (isHome && locations.length > 0) {
    base.mainEntity = { '@id': locations[0].node['@id'] }
    return base
  }

  const type = (page.schema_markup_type ?? '').trim()
  if (type === 'Service' || type === 'AccountingService') {
    base['@type'] = 'Service'
    base.provider = { '@type': 'Organization', name: firmName, url: origin }
    base.serviceType = page.page_title
    const audienceNiches = schema.niches?.map(n => n?.name).filter(nonEmpty) ?? []
    if (audienceNiches.length) {
      base.audience = audienceNiches.map(name => ({ '@type': 'Audience', audienceType: name }))
    }
  } else if (type === 'Article' || type === 'BlogPosting') {
    base['@type'] = type
    base.author = { '@type': 'Organization', name: firmName, url: origin }
    base.publisher = { '@type': 'Organization', name: firmName, url: origin }
  }

  return base
}

function buildPerson(
  member: TeamMember,
  firmName: string,
  origin: string
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: member.name,
    worksFor: { '@type': 'Organization', name: firmName, url: origin },
  }
  if (nonEmpty(member.title)) node.jobTitle = member.title
  if (nonEmpty(member.bio)) node.description = member.bio

  const credentials = (member.certifications ?? []).filter(nonEmpty)
  if (credentials.length) {
    node.hasCredential = credentials.map(cred => ({
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: cred,
    }))
  }

  const knowsAbout = [...(member.specializations ?? []), ...(member.expertise ?? [])].filter(nonEmpty)
  if (knowsAbout.length) node.knowsAbout = Array.from(new Set(knowsAbout))

  if (nonEmpty(member.education)) {
    node.alumniOf = { '@type': 'EducationalOrganization', name: member.education }
  }

  return node
}

const TEAM_PAGE_URL = /^\/(about|team|our-team|meet-the-team|people|our-people|staff)(\/|$)/i
const TEAM_SCHEMA_TYPE = /^(about|aboutpage|team|people)/i

function isTeamPage(page: GeneratedPage): boolean {
  if (TEAM_PAGE_URL.test(page.page_url)) return true
  const type = (page.schema_markup_type ?? '').trim()
  return type.length > 0 && TEAM_SCHEMA_TYPE.test(type)
}

function buildPeople(schema: SessionSchema, websiteUrl: string): Record<string, unknown>[] {
  const firmName = schema.business?.name ?? 'Firm'
  const origin = originOf(websiteUrl)
  return (schema.team ?? [])
    .filter(m => nonEmpty(m?.name))
    .map(m => buildPerson(m, firmName, origin))
}

function asScript(obj: Record<string, unknown>): string {
  // Escape `</` so a user-supplied string containing `</script>` can't break out
  // of the inline script tag. Standard inline-JSON XSS guard.
  const safe = JSON.stringify(obj, null, 2).replace(/<\/(script)/gi, '<\\/$1')
  return `<script type="application/ld+json">\n${safe}\n</script>`
}

export function buildJsonLdForPage(inputs: {
  schema: SessionSchema
  websiteUrl: string
  page: GeneratedPage
  sitemap: SitemapPage[]
}): string {
  const blocks: string[] = []

  blocks.push(asScript(buildOrganization(inputs.schema, inputs.websiteUrl)))

  const locations = buildAllLocalBusinesses(inputs.schema, inputs.websiteUrl)
  for (const { node } of locations) {
    blocks.push(asScript(node))
  }

  const breadcrumb = buildBreadcrumbList(inputs.page, inputs.sitemap, inputs.websiteUrl)
  if (breadcrumb) blocks.push(asScript(breadcrumb))

  const faq = buildFAQPage(inputs.page)
  if (faq) blocks.push(asScript(faq))

  // Team Person nodes (E-E-A-T) live only on the about/team page, so they're not
  // duplicated across the whole site.
  if (isTeamPage(inputs.page)) {
    for (const person of buildPeople(inputs.schema, inputs.websiteUrl)) {
      blocks.push(asScript(person))
    }
  }

  blocks.push(asScript(buildPageTypeNode(inputs.page, inputs.schema, inputs.websiteUrl, locations)))

  return blocks.join('\n')
}
