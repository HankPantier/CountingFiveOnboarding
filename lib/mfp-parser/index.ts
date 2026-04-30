import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

export function parseMFP(markdown: string): { schema: SessionSchema; gaps: GapItem[] } {
  const gaps: GapItem[] = []
  const schema: SessionSchema = {
    business: {
      name: '',
      tagline: '',
      positioningOption: '',
      positioningStatement: '',
      foundingYear: '',
      firmHistory: '',
      idealClients: [],
      geographicScope: '',
      clientAgeRanges: [],
      customerNeeds: '',
      customerDescription: '',
      differentiators: '',
      affiliations: [],
      clientSuccessStories: [],
      clientMixBreakdown: '',
      howClientsFind: '',
      pricing: '',
      growthGoals: '',
    },
    locations: [],
    team: [],
    services: [],
    niches: [],
    brand: {
      currentTone: '',
      aspirationalTone: '',
      toneAdjectives: [],
      toneToAvoid: [],
      voiceExample: '',
      brandPersonality: '',
      primaryColors: '',
      typography: '',
      logoStyle: '',
      hasBrandGuide: false,
    },
    culture: {
      missionVisionValues: '',
      teamDescription: '',
      socialMediaChannels: [],
    },
  }

  const sections: Array<[string, () => void]> = [
    ['Section 1', () => parseSection1(markdown, schema)],
    ['Section 2', () => parseSection2(markdown, schema)],
    ['Section 3', () => parseSection3(markdown, schema, gaps)],
    ['Section 4', () => parseSection4(markdown, schema, gaps)],
    ['Section 5', () => parseSection5(markdown, schema)],
    ['Section 6', () => parseSection6(markdown, schema)],
    ['Section 7', () => parseSection7(markdown, schema, gaps)],
  ]

  for (const [label, fn] of sections) {
    try {
      fn()
    } catch (err) {
      console.warn('[MFP Parser] ' + label + ' failed — returning partial result:', err)
    }
  }

  addPhase4Gaps(gaps, schema)
  return { schema, gaps }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSection(markdown: string, sectionNumber: number): string | null {
  const pattern = new RegExp('##\\s+Section\\s+' + sectionNumber + '\\b[^\\n]*\\n', 'i')
  const match = markdown.match(pattern)
  if (!match || match.index === undefined) {
    console.warn('[MFP Parser] Section ' + sectionNumber + ' not found')
    return null
  }
  const start = match.index + match[0].length
  const nextSection = markdown.indexOf('\n## ', start)
  return nextSection > -1 ? markdown.slice(start, nextSection) : markdown.slice(start)
}

function fieldValue(section: string, fieldName: string): string {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp('\\|\\s*\\*{0,2}' + escaped + '\\*{0,2}\\s*\\|\\s*([^|\\n]+)', 'i')
  const match = section.match(regex)
  if (!match) return ''
  return match[1]
    .trim()
    .replace(/\s*\*[^*\n]+\*\s*$/, '')
    .trim()
}

function tableRows(text: string): string[][] {
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim()
      return t.startsWith('|') && !/^\|[\s|:-]+\|/.test(t)
    })
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length >= 2)
}

function parseAddress(raw: string): { street: string; city: string; state: string; zip: string } {
  const match = raw.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/)
  if (!match) return { street: raw, city: '', state: '', zip: '' }
  return { street: match[1].trim(), city: match[2].trim(), state: match[3].trim(), zip: match[4].trim() }
}

// ─── Section parsers ──────────────────────────────────────────────────────────

function parseSection1(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 1)
  if (!section) return

  schema.business!.name = fieldValue(section, 'Firm Name')
  schema.websiteUrl = fieldValue(section, 'URL')

  const locStart = section.indexOf('### Location')
  const locSection = locStart > -1 ? section.slice(locStart) : section

  const address = fieldValue(locSection, 'Address')
  const phone = fieldValue(locSection, 'Phone')
  const fax = fieldValue(locSection, 'Fax')
  const email = fieldValue(locSection, 'Email')

  const hours: Record<string, string> = {}
  const taxHours = fieldValue(locSection, 'Tax Season Hours')
  const stdHours = fieldValue(locSection, 'Standard Hours')
  if (taxHours) hours['Tax Season'] = taxHours
  if (stdHours) hours['Standard'] = stdHours

  if (address || phone) {
    const { street, city, state, zip } = parseAddress(address)
    schema.locations!.push({ name: 'Primary Office', street, line2: '', city, state, zip, phone, fax, email, hours })
  }
}

function parseSection2(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 2)
  if (!section) return

  const business = schema.business!

  const taglineMatch = section.match(/>\s*\*"([^"]+)"\*/)
  if (taglineMatch) business.tagline = taglineMatch[1].trim()

  const optionMatches = [...section.matchAll(/>\s*\*\*Option\s+[A-C]/g)]
  const positions = optionMatches.map(m => m.index!)

  const optionTexts: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]
    const end = i + 1 < positions.length ? positions[i + 1] : section.length
    const block = section
      .slice(start, end)
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n')
      .trim()
    optionTexts.push(block)
  }

  if (optionTexts.length > 0) {
    business.positioningStatement = optionTexts.join('\n\n---\n\n')
  }
}

function parseSection3(markdown: string, schema: SessionSchema, gaps: GapItem[]): void {
  const section = extractSection(markdown, 3)
  if (!section) return

  const affiliations: string[] = []
  const SKIP = new Set(['organization', 'field'])

  for (const row of tableRows(section)) {
    const name = row[0].replace(/\*+/g, '').trim()
    if (!name || SKIP.has(name.toLowerCase())) continue
    if (row.join(' ').includes('❓')) {
      gaps.push({ field: 'business.affiliations[' + name + ']', label: 'Affiliation: ' + name, phase: 3, resolved: false })
    } else {
      affiliations.push(name)
    }
  }

  schema.business!.affiliations = affiliations
}

function parseSection4(markdown: string, schema: SessionSchema, gaps: GapItem[]): void {
  const section = extractSection(markdown, 4)
  if (!section) return

  const channels: string[] = []
  const SKIP = new Set(['platform', 'field'])

  for (const row of tableRows(section)) {
    const platform = row[0].replace(/\*+/g, '').trim()
    if (!platform || SKIP.has(platform.toLowerCase())) continue
    const url = row[1] ?? ''
    if (row.join(' ').includes('❓')) {
      gaps.push({
        field: 'culture.socialMediaChannels[' + platform.toLowerCase() + ']',
        label: 'Social Media: ' + platform,
        phase: 3,
        resolved: false,
      })
    } else if (url.startsWith('http')) {
      channels.push(platform + ': ' + url)
    }
  }

  schema.culture!.socialMediaChannels = channels
}

function parseSection5(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 5)
  if (!section) return

  const business = schema.business!
  const idealClients: string[] = []
  const SKIP = new Set(['industry', 'field'])

  for (const row of tableRows(section)) {
    const industry = row[0].replace(/\*+/g, '').trim()
    if (!industry || SKIP.has(industry.toLowerCase())) continue
    const confidence = (row[1] ?? '').toLowerCase()
    if (confidence.includes('confirmed')) idealClients.push(industry)
  }
  business.idealClients = idealClients

  const niches: NonNullable<SessionSchema['niches']> = []
  const blocks = section.split(/\n---\n/)
  for (const block of blocks) {
    const icpMatch = block.match(/\*\*([^*]+?)\s+ICP\*\*/)
    if (!icpMatch) continue
    const name = icpMatch[1].trim()
    const typeMatch = block.match(/\*\*Business type:\*\*\s*([^\n]+)/)
    const description = typeMatch ? typeMatch[1].trim() : ''
    const signalMatch = block.match(/\*\*Ideal signal:\*\*\s*\*"([^"]+)"\*/)
    const icp = signalMatch ? signalMatch[1] : ''
    niches.push({ name, description, icp, painPoints: '', valueProp: '' })
  }
  schema.niches = niches
}

function parseSection6(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 6)
  if (!section) return

  // Only parse the "### Confirmed Services" table; stop at the next ### heading
  const confirmedStart = section.indexOf('### Confirmed Services')
  const subsection = confirmedStart > -1 ? section.slice(confirmedStart) : section
  const nextHeading = subsection.indexOf('\n### ', 1)
  const servicesBlock = nextHeading > -1 ? subsection.slice(0, nextHeading) : subsection

  const services: NonNullable<SessionSchema['services']> = []
  const SKIP = new Set(['service', 'field'])

  for (const row of tableRows(servicesBlock)) {
    const name = row[0].replace(/\*+/g, '').trim()
    if (!name || SKIP.has(name.toLowerCase())) continue
    const description = (row[3] ?? row[2] ?? '').replace(/\*+/g, '').trim()
    services.push({ name, description, offerings: [] })
  }

  schema.services = services
}

function parseSection7(markdown: string, schema: SessionSchema, gaps: GapItem[]): void {
  const section = extractSection(markdown, 7)
  if (!section) return

  const team: NonNullable<SessionSchema['team']> = []
  const memberMatches = [...section.matchAll(/###\s+([^\n]+)/g)]
  const positions = memberMatches.map(m => ({ name: m[1].trim(), index: m.index! }))

  for (let i = 0; i < positions.length; i++) {
    const { name, index } = positions[i]
    const end = i + 1 < positions.length ? positions[i + 1].index : section.length
    const block = section.slice(index, end)

    const titleMatch = block.match(/\*\*Title:\*\*\s*([^\n]+)/)
    const titleRaw = titleMatch ? titleMatch[1].trim() : ''
    const missingTitle = titleRaw.includes('❓') || !titleRaw
    const title = missingTitle ? '' : titleRaw.replace(/\*[^*\n]+\*/g, '').trim()

    const credsMatch = block.match(/\|\s*\*{0,2}Credentials\*{0,2}\s*\|\s*([^|\n]+)/)
    const credsRaw = credsMatch ? credsMatch[1].trim() : ''
    const certifications =
      credsRaw && credsRaw !== 'None listed' && !credsRaw.includes('❓')
        ? credsRaw.split(/[,/]/).map((c: string) => c.trim()).filter(Boolean)
        : []

    team.push({ name, title, certifications, bio: '', specializations: [] })

    if (missingTitle) {
      gaps.push({
        field: 'team[' + (team.length - 1) + '].title',
        label: name + ' — Title',
        phase: 3,
        resolved: false,
      })
    }
  }

  schema.team = team
}

// ─── Phase 4 gaps (always present — MFP never covers these) ──────────────────

function addPhase4Gaps(gaps: GapItem[], schema?: SessionSchema): void {
  // Firm background
  gaps.push(
    { field: 'business.foundingYear', label: 'Founding Year', phase: 4, tier: 1, resolved: false },
    { field: 'business.firmHistory', label: 'Firm History / Origin Story', phase: 4, tier: 1, resolved: false },
  )
  // Client & revenue
  gaps.push(
    { field: 'business.geographicScope', label: 'Geographic Scope', phase: 4, tier: 1, resolved: false },
    { field: 'business.clientAgeRanges', label: 'Client Age Ranges', phase: 4, tier: 1, resolved: false },
    { field: 'business.customerNeeds', label: 'Client Needs & Pain Points', phase: 4, tier: 1, resolved: false },
    { field: 'business.howClientsFind', label: 'How Clients Find the Firm', phase: 4, tier: 1, resolved: false },
    { field: 'business.pricing', label: 'Pricing / Fee Structure', phase: 4, tier: 1, resolved: false },
    { field: 'business.clientSuccessStories', label: 'Client Success Stories (1–2 examples)', phase: 4, tier: 1, resolved: false },
  )
  // Differentiators & growth
  gaps.push(
    { field: 'business.differentiators', label: 'Differentiators (in their own words)', phase: 4, tier: 1, resolved: false },
    { field: 'business.growthGoals', label: 'Growth Goals / Where They Want to Be in 3 Years', phase: 4, tier: 2, resolved: false },
    { field: 'business.clientMixBreakdown', label: 'Client Mix Breakdown', phase: 4, tier: 2, resolved: false },
  )
  // Culture
  gaps.push(
    { field: 'culture.missionVisionValues', label: 'Mission, Vision & Values', phase: 4, tier: 1, resolved: false },
    { field: 'culture.teamDescription', label: 'Team Culture Description', phase: 4, tier: 1, resolved: false },
  )
  // Brand & Tone (always collected in Phase 4)
  gaps.push(
    { field: 'brand.currentTone',       label: 'Current Brand Voice',                     phase: 4, tier: 1, resolved: false },
    { field: 'brand.aspirationalTone',  label: 'Aspirational Voice (how they want to sound)', phase: 4, tier: 1, resolved: false },
    { field: 'brand.toneAdjectives',    label: 'Tone Adjectives (words that feel like them)', phase: 4, tier: 1, resolved: false },
    { field: 'brand.toneToAvoid',       label: 'Tone to Avoid',                            phase: 4, tier: 2, resolved: false },
    { field: 'brand.voiceExample',      label: 'Voice Example Phrase',                     phase: 4, tier: 2, resolved: false },
    { field: 'brand.primaryColors',     label: 'Brand Colors',                             phase: 4, tier: 1, resolved: false },
    { field: 'brand.hasBrandGuide',     label: 'Has Existing Brand Guide',                 phase: 4, tier: 1, resolved: false },
    { field: 'brand.logoStyle',         label: 'Logo / Visual Style (modern, traditional, etc.)', phase: 4, tier: 2, resolved: false },
  )
  // Per-niche pain points & value props
  if (schema?.niches?.length) {
    for (let i = 0; i < schema.niches.length; i++) {
      const niche = schema.niches[i]
      gaps.push(
        { field: `niches[${i}].painPoints`, label: `${niche.name} — Pain Points`, phase: 4, tier: 1, resolved: false },
        { field: `niches[${i}].valueProp`, label: `${niche.name} — Value Proposition`, phase: 4, tier: 2, resolved: false },
      )
    }
  }
  // Misc
  gaps.push(
    { field: 'technical.googleBusinessProfileUrl', label: 'Google Business Profile URL', phase: 4, tier: 3, resolved: false },
  )
}
