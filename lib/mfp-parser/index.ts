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
    ['Section 8', () => parseSection8(markdown, schema)],
    ['Section 9', () => parseSection9(markdown, schema)],
    ['Section 10A', () => parseSection10A(markdown, schema)],
    ['Section 10B', () => parseSection10B(markdown, schema)],
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
  let linkedInCaptured = false

  for (const row of tableRows(section)) {
    const platform = row[0].replace(/\*+/g, '').trim()
    if (!platform || SKIP.has(platform.toLowerCase())) continue
    const url = row[1] ?? ''
    const platformLc = platform.toLowerCase()
    const rowJoined = row.join(' ')
    const flagged = rowJoined.includes('❓')

    // LinkedIn gets a structured field; do not also append to socialMediaChannels.
    if (platformLc === 'linkedin') {
      const hasUrl = !flagged && url.startsWith('http')
      schema.culture!.linkedIn = { url: hasUrl ? url : null }
      if (!hasUrl) {
        gaps.push({
          field: 'culture.linkedIn.url',
          label: 'LinkedIn URL',
          phase: 3,
          resolved: false,
        })
      }
      linkedInCaptured = true
      continue
    }

    if (flagged) {
      gaps.push({
        field: 'culture.socialMediaChannels[' + platformLc + ']',
        label: 'Social Media: ' + platform,
        phase: 3,
        resolved: false,
      })
    } else if (url.startsWith('http')) {
      channels.push(platform + ': ' + url)
    }
  }

  schema.culture!.socialMediaChannels = channels

  // If the MFP didn't list LinkedIn at all, still seed the field so the agent
  // knows to ask about it during Phase 3 confirmation.
  if (!linkedInCaptured) {
    schema.culture!.linkedIn = { url: null }
    gaps.push({
      field: 'culture.linkedIn.url',
      label: 'LinkedIn URL',
      phase: 3,
      resolved: false,
    })
  }

  // Google Business Profile is typically described in prose below the social
  // table (e.g. "**Google Business Profile:** *(not directly confirmed)*").
  // Parse the prose for a URL or "no listing" cue; otherwise seed null + gap.
  const gbpMatch = section.match(/Google Business Profile[\s\S]*?(?:\n\n|\n>|$)/i)
  let gbpUrl: string | null = null
  let gbpHint: string | undefined
  if (gbpMatch) {
    const gbpText = gbpMatch[0]
    const urlMatch = gbpText.match(/https?:\/\/[^\s)]+/)
    if (urlMatch) gbpUrl = urlMatch[0]
    if (/no listing|no google|not directly confirmed|unclaimed|no reviews|no photos/i.test(gbpText)) {
      gbpHint = gbpText.replace(/\*+/g, '').trim().slice(0, 240)
    }
  }
  schema.business!.googleBusinessProfile = {
    url: gbpUrl,
    ...(gbpHint ? { roomForImprovement: gbpHint } : {}),
  }
  if (!gbpUrl) {
    gaps.push({
      field: 'business.googleBusinessProfile.url',
      label: 'Google Business Profile URL',
      phase: 3,
      resolved: false,
    })
  }
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

// ─── Sections 8–10B (content generation data) ────────────────────────────────

function parseSection8(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 8)
  if (!section) return

  const reputation: NonNullable<SessionSchema['reputation']> = {
    trustSignalGaps: [],
    pressAndMedia: [],
  }

  const googleMatch = section.match(/\*\*Google Rating:\*\*\s*([^\n]+)/)
  if (googleMatch) reputation.googleRating = googleMatch[1].trim()

  const yelpMatch = section.match(/\*\*Yelp Rating:\*\*\s*([^\n]+)/)
  if (yelpMatch) reputation.yelpRating = yelpMatch[1].trim()

  const sentimentMatch = section.match(/\*\*Overall Sentiment:\*\*\s*([^\n]+)/)
  if (sentimentMatch) reputation.reviewSummary = sentimentMatch[1].trim()

  // Trust Signal Gaps — bulleted list after the heading
  const trustGapStart = section.indexOf('### Trust Signal Gaps')
  if (trustGapStart > -1) {
    const trustBlock = section.slice(trustGapStart)
    const nextHeading = trustBlock.indexOf('\n### ', 1)
    const block = nextHeading > -1 ? trustBlock.slice(0, nextHeading) : trustBlock
    const bullets = block.match(/^- \*\*[^*]+\*\*[^\n]*/gm)
    if (bullets) {
      reputation.trustSignalGaps = bullets.map(b =>
        b.replace(/^- \*\*/, '').replace(/\*\*/, '').trim()
      )
    }
  }

  // Press & Media
  const pressStart = section.indexOf('### Press & Media')
  if (pressStart > -1) {
    const pressBlock = section.slice(pressStart)
    const nextHeading = pressBlock.indexOf('\n### ', 1)
    const block = nextHeading > -1 ? pressBlock.slice(0, nextHeading) : pressBlock
    const bullets = block.match(/^- .+/gm)
    if (bullets) {
      reputation.pressAndMedia = bullets.map(b => b.replace(/^- /, '').trim())
    }
  }

  schema.reputation = reputation
}

function parseSection9(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 9)
  if (!section) return

  const content_gaps: NonNullable<SessionSchema['content_gaps']> = {
    nicheGaps: [],
    authorityGaps: [],
    conversionGaps: [],
    teamExpertiseGaps: [],
  }

  const subsections: Array<[string, keyof typeof content_gaps]> = [
    ['### Niche Gaps', 'nicheGaps'],
    ['### Authority Gaps', 'authorityGaps'],
    ['### Conversion Gaps', 'conversionGaps'],
    ['### Team Expertise Gaps', 'teamExpertiseGaps'],
  ]

  for (const [heading, key] of subsections) {
    const start = section.indexOf(heading)
    if (start === -1) continue
    const block = section.slice(start)
    const nextHeading = block.indexOf('\n### ', 1)
    const subsection = nextHeading > -1 ? block.slice(0, nextHeading) : block
    const bullets = subsection.match(/^- \*\*[^*]+\*\*[^\n]*/gm)
    if (bullets) {
      content_gaps[key] = bullets.map(b =>
        b.replace(/^- \*\*/, '').replace(/\*\*/, '').trim()
      )
    }
  }

  schema.content_gaps = content_gaps
}

function parseSection10A(markdown: string, schema: SessionSchema): void {
  // Section 10A uses a custom header pattern
  const pattern = /##\s+Section\s+10A\b[^\n]*\n/i
  const match = markdown.match(pattern)
  if (!match || match.index === undefined) return

  const start = match.index + match[0].length
  const nextSection = markdown.indexOf('\n## ', start)
  const section = nextSection > -1 ? markdown.slice(start, nextSection) : markdown.slice(start)

  // Parse the Redirect Planning Table
  const tableStart = section.indexOf('### Redirect Planning Table')
  if (tableStart === -1) return

  const tableBlock = section.slice(tableStart)
  const rows = tableRows(tableBlock)
  const current_sitemap: NonNullable<SessionSchema['current_sitemap']> = []

  for (const row of rows) {
    if (row.length < 4) continue
    const currentUrl = row[0].replace(/\*+/g, '').trim()
    const pageTitle = row[1].replace(/\*+/g, '').trim()
    const actionRaw = row[2].replace(/\*+/g, '').trim()
    const newUrl = row[3].replace(/[→→]\s*/, '').replace(/\*+/g, '').trim()

    // Skip header row
    if (actionRaw.toLowerCase() === 'action') continue

    let action: 'keep' | 'redirect' | 'consolidate' | 'new'
    if (actionRaw.toLowerCase().includes('no change')) action = 'keep'
    else if (actionRaw.toLowerCase().includes('consolidate')) action = 'consolidate'
    else if (actionRaw.toLowerCase().includes('new page')) action = 'new'
    else action = 'redirect'

    // Determine if live — redirects to homepage or JS-rendered are not live
    const isNewPage = currentUrl.includes('no current URL') || currentUrl === '*(no current URL)*'
    const live = !isNewPage && action !== 'new'

    current_sitemap.push({
      url: isNewPage ? '' : currentUrl,
      title: pageTitle,
      action,
      new_url: newUrl || undefined,
      live,
    })
  }

  schema.current_sitemap = current_sitemap
}

function parseSection10B(markdown: string, schema: SessionSchema): void {
  // Section 10B uses a custom header pattern
  const pattern = /##\s+Section\s+10B\b[^\n]*\n/i
  const match = markdown.match(pattern)
  if (!match || match.index === undefined) return

  const start = match.index + match[0].length
  const nextSection = markdown.indexOf('\n## ', start)
  const section = nextSection > -1 ? markdown.slice(start, nextSection) : markdown.slice(start)

  // Find the text tree (after "Site Map — Text Tree" heading, inside a code block)
  const textTreeStart = section.indexOf('**Site Map — Text Tree**')
  if (textTreeStart === -1) return

  const codeBlockStart = section.indexOf('```', textTreeStart)
  if (codeBlockStart === -1) return
  const codeBlockContentStart = section.indexOf('\n', codeBlockStart) + 1
  const codeBlockEnd = section.indexOf('```', codeBlockContentStart)
  if (codeBlockEnd === -1) return

  const textTree = section.slice(codeBlockContentStart, codeBlockEnd)

  // URL mapping from the sitemap structure
  const urlMap: Record<string, string> = {
    'Home': '/',
    'About': '/about',
    'Our Story': '/about/our-story',
    'Our Team': '/about/our-team',
    'Services': '/services',
    'Advisory & Virtual CFO': '/services/virtual-cfo-advisory',
    'Tax': '/services/tax',
    'Personal Tax': '/services/tax/personal-tax',
    'Business Tax': '/services/tax/business-tax',
    'Audit Representation': '/services/tax/audit-representation',
    'Bookkeeping & Payroll': '/services/bookkeeping-payroll',
    'Financial Reporting': '/services/financial-reporting',
    'Nonprofit Accounting': '/industries/nonprofits',
    'Wealth & Retirement Planning': '/services/wealth-retirement-planning',
    'Business Startup Accounting': '/services/business-startup-accounting',
    'Industries / Who We Serve': '/industries',
    'Healthcare Professionals': '/industries/healthcare-professionals',
    'Contractors & Trades': '/industries/contractors-trades',
    'Retail & Manufacturing': '/industries/retail-manufacturing',
    'Service Businesses': '/industries/service-businesses',
    'Nonprofits': '/industries/nonprofits',
    'Closely Held Family Businesses': '/industries/family-businesses',
    'Resources': '/resources',
    'Articles & Magazine': '/resources/articles',
    'Refund Tracker': '/resources/refund-tracker',
    'Client Portal': '/resources/client-portal',
    'Contact': '/contact',
  }

  const proposed_sitemap: NonNullable<SessionSchema['proposed_sitemap']> = []
  const seenUrls = new Set<string>()
  const parentStack: Array<{ indent: number; url: string }> = []

  for (const line of textTree.split('\n')) {
    if (!line.trim()) continue

    // Determine indentation level (count leading chars before the title)
    const indentMatch = line.match(/^([│├└\s─]+)/)
    const indent = indentMatch ? indentMatch[1].length : 0

    // Extract title and status emoji
    const titleMatch = line.match(/(?:[│├└\s─]+)?([^📈🆕✅\n]+)\s*(📈|🆕|✅)/)
    if (!titleMatch) continue

    const title = titleMatch[1].trim()
    const emoji = titleMatch[2]

    let status: 'new' | 'update' | 'existing'
    if (emoji === '🆕') status = 'new'
    else if (emoji === '📈') status = 'update'
    else status = 'existing'

    // Generate URL from title
    const url = urlMap[title] ?? '/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')

    // Determine parent from indentation
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
      parentStack.pop()
    }
    const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1].url : undefined

    parentStack.push({ indent, url })

    // Sitemap nodes can cross-link to the same destination URL (e.g. "Nonprofits"
    // listed under both Services and Industries). Each URL maps to one page in
    // the research/outline/generation pipeline, so dedupe by URL.
    if (seenUrls.has(url)) continue
    seenUrls.add(url)

    proposed_sitemap.push({ url, title, status, parent })
  }

  schema.proposed_sitemap = proposed_sitemap
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
}
