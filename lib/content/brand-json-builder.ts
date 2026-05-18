import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { BrandJson, SocialLink, Certification, Address } from '@/types/brand-json'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

type SocialPlatform = SocialLink['platform']

function detectPlatform(url: string): SocialPlatform {
  try {
    const { hostname } = new URL(url)
    if (hostname.includes('linkedin.com')) return 'linkedin'
    if (hostname.includes('facebook.com')) return 'facebook'
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter'
    if (hostname.includes('instagram.com')) return 'instagram'
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube'
    return 'other'
  } catch {
    return 'other'
  }
}

function parseSocialLinks(
  channels: string[] | undefined,
  linkedInUrl: string | null | undefined
): SocialLink[] {
  const seen = new Set<string>()
  const links: SocialLink[] = []

  const candidates = [...(channels ?? [])]

  // Add linkedIn.url to candidates if it is non-empty and not already in list
  if (nonEmpty(linkedInUrl)) {
    candidates.push(linkedInUrl)
  }

  for (const raw of candidates) {
    if (!nonEmpty(raw)) continue
    // Validate URL
    let normalized: string
    try {
      normalized = new URL(raw).href
    } catch {
      continue
    }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    links.push({ platform: detectPlatform(raw), url: normalized })
  }

  return links
}

function buildAddress(loc: NonNullable<SessionSchema['locations']>[number]): Address | undefined {
  if (!nonEmpty(loc.street)) return undefined
  const addr: Address = {
    street: loc.street,
    city: loc.city,
    state: loc.state,
    zip: loc.zip,
  }
  if (nonEmpty(loc.line2)) addr.line2 = loc.line2
  return addr
}

function buildCertifications(affiliations: string[] | undefined): Certification[] {
  if (!affiliations) return []
  return affiliations
    .filter(nonEmpty)
    .map((aff): Certification => ({ src: '', alt: aff }))
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBrandJson(schema: SessionSchema, palette: PaletteData): BrandJson {
  const business = schema.business
  const culture = schema.culture
  const assets = schema.assets
  const firstLocation = schema.locations?.[0]

  // ---- Firm ----
  const firmName = nonEmpty(business?.name) ? business!.name : ''
  const firm: BrandJson['firm'] = { name: firmName }
  if (nonEmpty(business?.tagline)) firm.tagline = business!.tagline
  if (nonEmpty(business?.foundingYear)) firm.foundingYear = business!.foundingYear

  // ---- Contact ----
  const contact: BrandJson['contact'] = {}
  if (firstLocation) {
    const address = buildAddress(firstLocation)
    if (address) contact.address = address
    if (nonEmpty(firstLocation.phone)) contact.phone = firstLocation.phone
    if (nonEmpty(firstLocation.fax)) contact.fax = firstLocation.fax
    if (nonEmpty(firstLocation.email)) contact.email = firstLocation.email
    if (firstLocation.hours && Object.keys(firstLocation.hours).length > 0) {
      contact.hours = firstLocation.hours
    }
  }

  // ---- Palette ----
  const paletteOut: BrandJson['palette'] = {
    primary: palette.primary.hex,
    secondary: palette.secondary.hex,
    complementary: palette.complementary.hex,
    action: palette.action.hex,
    nearBlack: palette.nearBlack.hex,
    nearWhite: palette.nearWhite.hex,
  }

  // ---- Social ----
  const social = parseSocialLinks(
    culture?.socialMediaChannels,
    culture?.linkedIn?.url
  )

  // ---- Certifications ----
  const certifications = buildCertifications(business?.affiliations)

  // ---- Logo ----
  const primaryLogo = assets?.logosUploaded?.[0] ?? ''
  const logoAlt = nonEmpty(firmName) ? `${firmName} logo` : 'Logo'
  const logo: BrandJson['logo'] = { primary: primaryLogo, alt: logoAlt }

  return {
    firm,
    contact,
    palette: paletteOut,
    social,
    certifications,
    logo,
  }
}
