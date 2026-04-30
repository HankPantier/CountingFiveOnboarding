import type { Database } from '@/types/database'

type Session = Database['public']['Tables']['sessions']['Row']
type SchemaObj = Record<string, unknown>

type UploadedAsset = {
  file_name: string
  storage_path: string
  asset_category: string | null
}

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  logo:        'Logo',
  brand_guide: 'Brand Guide',
  headshot:    'Headshot',
  other:       'File',
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function field(label: string, value: unknown): string {
  const v = str(value)
  return v ? `**${label}:** ${v}` : ''
}

function section(lines: string[]): string {
  return lines.filter(Boolean).join('  \n')
}

export function generateIntakeMd(session: Session, uploadedAssets: UploadedAsset[] = []): string {
  const s = (session.schema_data as SchemaObj) ?? {}
  const contact    = (s.contact    as SchemaObj) ?? {}
  const business   = (s.business   as SchemaObj) ?? {}
  const brand      = (s.brand      as SchemaObj) ?? {}
  const technical  = (s.technical  as SchemaObj) ?? {}
  const culture    = (s.culture    as SchemaObj) ?? {}
  const assets     = (s.assets     as SchemaObj) ?? {}
  const additional = (s.additional as SchemaObj) ?? {}
  const locations  = (s.locations  as SchemaObj[]) ?? []
  const team       = (s.team       as SchemaObj[]) ?? []
  const services   = (s.services   as SchemaObj[]) ?? []
  const niches     = (s.niches     as SchemaObj[]) ?? []

  const firmName = str(business.name) || session.website_url
  const approvedDate = session.approved_at
    ? new Date(session.approved_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Pending'

  const lines: string[] = []

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# Website Intake Summary — ${firmName}`, '')
  lines.push(section([
    field('Website', s.websiteUrl),
    field('Approved', approvedDate),
  ]))
  lines.push('', '---', '')

  // ── Contact ───────────────────────────────────────────────────────────────
  lines.push('## Contact', '')
  lines.push(section([
    field('Name', `${str(contact.firstName)} ${str(contact.lastName)}`.trim()),
    field('Email', contact.email),
    field('Phone', contact.phone),
  ]))
  lines.push('', '---', '')

  // ── Business & Positioning ────────────────────────────────────────────────
  lines.push('## Business & Positioning', '')
  lines.push(section([
    field('Founded', business.foundingYear),
    field('Tagline', business.tagline),
    field('Positioning Option', business.positioningOption),
    field('Geographic Scope', business.geographicScope),
    field('How Clients Find Them', business.howClientsFind),
    field('Pricing / Fee Structure', business.pricing),
  ]))
  if (str(business.positioningStatement)) {
    lines.push('', '### Positioning Statement', '', str(business.positioningStatement))
  }
  if (str(business.differentiators)) {
    lines.push('', '### Differentiators', '', str(business.differentiators))
  }
  if (str(business.firmHistory)) {
    lines.push('', '### Firm History', '', str(business.firmHistory))
  }
  if (str(business.growthGoals)) {
    lines.push('', '### Growth Goals', '', str(business.growthGoals))
  }
  const successStories = list(business.clientSuccessStories)
  if (successStories.length) {
    lines.push('', '### Client Success Stories', '')
    for (const story of successStories) lines.push(`- ${story}`)
  }
  lines.push('', '---', '')

  // ── Brand & Tone ──────────────────────────────────────────────────────────
  const hasBrand = str(brand.currentTone) || str(brand.aspirationalTone) || str(brand.primaryColors)
  if (hasBrand) {
    lines.push('## Brand & Tone', '')

    // Voice
    const toneAdj  = list(brand.toneAdjectives)
    const toneAvoid = list(brand.toneToAvoid)
    lines.push('### Voice', '')
    lines.push(section([
      field('Current Voice', brand.currentTone),
      field('Aspirational Voice', brand.aspirationalTone),
      toneAdj.length  ? `**Tone Adjectives:** ${toneAdj.join(', ')}` : '',
      toneAvoid.length ? `**Avoid:** ${toneAvoid.join(', ')}` : '',
    ]))
    if (str(brand.voiceExample)) {
      lines.push('', `> *"${str(brand.voiceExample)}"*`)
    }
    if (str(brand.brandPersonality)) {
      lines.push('', '### Brand Personality', '', str(brand.brandPersonality))
    }

    // Visual Identity
    const hasVisual = str(brand.primaryColors) || str(brand.typography) || str(brand.logoStyle)
    if (hasVisual) {
      lines.push('', '### Visual Identity', '')
      lines.push(section([
        field('Brand Colors', brand.primaryColors),
        field('Typography', brand.typography),
        field('Logo Style', brand.logoStyle),
        brand.hasBrandGuide ? '**Brand Guide:** On file — see uploaded assets' : '',
      ]))
    }

    // Uploaded brand assets
    const brandAssets = uploadedAssets.filter(a =>
      a.asset_category === 'logo' || a.asset_category === 'brand_guide'
    )
    if (brandAssets.length) {
      lines.push('', '### Uploaded Brand Assets', '')
      for (const asset of brandAssets) {
        const label = ASSET_CATEGORY_LABELS[asset.asset_category ?? 'other'] ?? 'File'
        lines.push(`- **${asset.file_name}** (${label}) — \`${asset.storage_path}\``)
      }
    }

    lines.push('', '---', '')
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  if (locations.length) {
    lines.push('## Locations', '')
    for (const loc of locations) {
      const name = str(loc.name) || 'Office'
      lines.push(`### ${name}`, '')
      const address = [loc.street, loc.city, loc.state, loc.zip].filter(Boolean).join(', ')
      lines.push(section([
        address ? `**Address:** ${address}` : '',
        field('Phone', loc.phone),
        field('Email', loc.email),
      ]))
      lines.push('')
    }
    lines.push('---', '')
  }

  // ── Team ──────────────────────────────────────────────────────────────────
  if (team.length) {
    lines.push('## Team', '')
    for (const member of team) {
      const title = str(member.title)
      lines.push(`### ${str(member.name)}${title ? ` — ${title}` : ''}`, '')
      const certs = list(member.certifications)
      const specs  = list(member.specializations)
      lines.push(section([
        certs.length ? `**Certifications:** ${certs.join(', ')}` : '',
        specs.length  ? `**Specializations:** ${specs.join(', ')}` : '',
      ]))
      if (str(member.bio)) lines.push('', str(member.bio))
      lines.push('')
    }
    lines.push('---', '')
  }

  // ── Services ──────────────────────────────────────────────────────────────
  if (services.length) {
    lines.push('## Services', '')
    for (const svc of services) {
      lines.push(`### ${str(svc.name)}`, '')
      if (str(svc.description)) lines.push(str(svc.description))
      lines.push('')
    }
    lines.push('---', '')
  }

  // ── Industries Served ─────────────────────────────────────────────────────
  if (niches.length) {
    lines.push('## Industries Served', '')
    for (const niche of niches) {
      lines.push(`### ${str(niche.name)}`, '')
      if (str(niche.description)) lines.push(str(niche.description))
      if (str(niche.icp)) lines.push('', field('Ideal Client', niche.icp))
      if (str(niche.painPoints)) lines.push('', field('Pain Points', niche.painPoints))
      if (str(niche.valueProp)) lines.push('', field('Value Proposition', niche.valueProp))
      lines.push('')
    }
    lines.push('---', '')
  }

  // ── Domain & Technical ────────────────────────────────────────────────────
  const hasTechnical = Object.values(technical).some(v => v)
  if (hasTechnical) {
    lines.push('## Domain & Technical', '')
    lines.push(section([
      field('Registrar', technical.registrar),
      field('Registration Date', technical.registrationDate),
      field('Expiry Date', technical.expiryDate),
      field('Hosting Provider', technical.hostingProvider),
      field('Registrar Username', technical.registrarUsername),
      field('Nameservers', list(technical.nameservers).join(', ')),
    ]))
    lines.push('', '---', '')
  }

  // ── Culture ───────────────────────────────────────────────────────────────
  const hasCulture = str(culture.missionVisionValues) || str(culture.teamDescription) || list(culture.socialMediaChannels).length
  if (hasCulture) {
    lines.push('## Culture', '')
    if (str(culture.missionVisionValues)) {
      lines.push('### Mission / Values', '', str(culture.missionVisionValues), '')
    }
    if (str(culture.teamDescription)) {
      lines.push('### Team Culture', '', str(culture.teamDescription), '')
    }
    const socials = list(culture.socialMediaChannels)
    if (socials.length) lines.push(field('Social Channels', socials.join(', ')), '')
    lines.push('---', '')
  }

  // ── Uploaded Files ────────────────────────────────────────────────────────
  if (uploadedAssets.length) {
    lines.push('## Uploaded Files', '')
    for (const asset of uploadedAssets) {
      const label = ASSET_CATEGORY_LABELS[asset.asset_category ?? 'other'] ?? 'File'
      lines.push(`- **${asset.file_name}** (${label}) — \`${asset.storage_path}\``)
    }
    lines.push('', '---', '')
  }

  // ── Assets inventory ──────────────────────────────────────────────────────
  const headshots    = list(assets.headshotsAvailable)
  const testimonials = list(assets.testimonialsAvailable)
  const hasAssets    = headshots.length || assets.officePhotosAvailable || testimonials.length
  if (hasAssets) {
    lines.push('## Asset Inventory', '')
    lines.push(section([
      headshots.length ? `**Headshots Available:** ${headshots.join(', ')}` : '',
      assets.officePhotosAvailable ? '**Office Photos:** Yes' : '',
      testimonials.length ? `**Testimonials:** ${testimonials.join('; ')}` : '',
    ]))
    lines.push('', '---', '')
  }

  // ── Additional ────────────────────────────────────────────────────────────
  if (str(additional.otherDetails)) {
    lines.push('## Additional Notes', '', str(additional.otherDetails), '', '---', '')
  }

  lines.push('', `*Generated by CountingFive Onboarding — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}*`)

  return lines.join('\n')
}
