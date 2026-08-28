import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import { slugify } from '@/lib/content/sitemap-utils'

// Phase-4 gaps for an already-populated schema (e.g. an AI-drafted profile from
// the audit→session bridge), using the same field set + semantics as MBP-seeded
// sessions so the agent collects the same things regardless of the seed source.
export function computePhase4Gaps(schema: SessionSchema): GapItem[] {
  const gaps: GapItem[] = []
  addPhase4Gaps(gaps, schema)
  return gaps
}

export function parseMBP(markdown: string): { schema: SessionSchema; gaps: GapItem[] } {
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
    ['Section 11', () => parseSection11(markdown, schema)],
    ['Review Prompts', () => parseReviewPrompts(markdown, schema)],
    ['Sitemap location augmentation', () => augmentSitemapWithLocations(schema)],
  ]

  for (const [label, fn] of sections) {
    try {
      fn()
    } catch (err) {
      console.warn('[MBP Parser] ' + label + ' failed — returning partial result:', err)
    }
  }

  addPhase4Gaps(gaps, schema)
  return { schema, gaps }
}

// When a firm has multiple offices, ensure the proposed sitemap has a
// /locations parent and a /locations/<slug> page per office. The MBP usually
// already covers this, but auto-injection guards against omissions and gives
// the LLM a per-location landing page to populate during research/generation.
function augmentSitemapWithLocations(schema: SessionSchema): void {
  const locations = schema.locations ?? []
  if (locations.length < 2) return

  const sitemap = (schema.proposed_sitemap ?? []) as NonNullable<SessionSchema['proposed_sitemap']>
  const seenUrls = new Set(sitemap.map(p => p.url))

  if (!seenUrls.has('/locations')) {
    sitemap.push({ url: '/locations', title: 'Locations', status: 'new', parent: undefined })
    seenUrls.add('/locations')
  }

  for (const loc of locations) {
    const slug = locationSlugForSitemap(loc)
    if (!slug) continue
    const url = `/locations/${slug}`
    if (seenUrls.has(url)) continue
    const title =
      (loc.name && loc.name.trim()) ||
      (loc.city && loc.city.trim() ? `${loc.city} Office` : 'Office')
    sitemap.push({ url, title, status: 'new', parent: '/locations' })
    seenUrls.add(url)
  }

  schema.proposed_sitemap = sitemap
}

function locationSlugForSitemap(loc: NonNullable<SessionSchema['locations']>[number]): string {
  const base = (loc.name && loc.name.trim()) || (loc.city && loc.city.trim()) || ''
  return slugify(base)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSection(markdown: string, sectionNumber: number): string | null {
  const pattern = new RegExp('##\\s+Section\\s+' + sectionNumber + '\\b[^\\n]*\\n', 'i')
  const match = markdown.match(pattern)
  if (!match || match.index === undefined) {
    console.warn('[MBP Parser] Section ' + sectionNumber + ' not found')
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

  // Section 1 sometimes carries Year Established / Former Name / Firm Size.
  // ❓-flagged values mean the analyst couldn't confirm — treat as empty so
  // the Phase 4 gap remains.
  const yearRaw = fieldValue(section, 'Year Established')
  if (yearRaw && !yearRaw.includes('❓')) {
    schema.business!.foundingYear = yearRaw
  }
  const formerName = fieldValue(section, 'Former Name')
  if (formerName && !formerName.includes('❓')) {
    schema.business!.formerName = formerName
  }
  const firmSize = fieldValue(section, 'Firm Size Estimate')
  if (firmSize && !firmSize.includes('❓')) {
    schema.business!.firmSizeEstimate = firmSize
  }

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

  // Firm history lives in the "### History & Background" subsection as plain
  // prose. Capture everything up to the next subheading or blockquote so the
  // agent can confirm it in Phase 3 rather than re-asking in Phase 4.
  const historyStart = section.indexOf('### History & Background')
  if (historyStart > -1) {
    const tail = section.slice(historyStart + '### History & Background'.length)
    const stopAt = (() => {
      const candidates = [tail.indexOf('\n### '), tail.indexOf('\n> '), tail.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : tail.length
    })()
    const history = tail.slice(0, stopAt).trim()
    if (history) business.firmHistory = history
  }

  const taglineMatch = section.match(/>\s*\*"([^"]+)"\*/)
  if (taglineMatch) business.tagline = taglineMatch[1].trim()

  const optionMatches = [...section.matchAll(/>\s*\*\*Option\s+[A-C]/g)]
  const positions = optionMatches.map(m => m.index!)

  const optionTexts: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]
    const hardEnd = i + 1 < positions.length ? positions[i + 1] : section.length
    // Each option is a contiguous blockquote. Stop at the first non-quote line
    // so the LAST option doesn't swallow the trailing analyst note, the
    // blockquoted "Client Review Action" prompt, or the Competitive Context
    // table that follow it in the section.
    const quoted: string[] = []
    for (const line of section.slice(start, hardEnd).split('\n')) {
      if (!line.trimStart().startsWith('>')) {
        if (quoted.length) break
        continue
      }
      quoted.push(line.replace(/^\s*>\s?/, ''))
    }
    const block = quoted.join('\n').trim()
    if (block) optionTexts.push(block)
  }

  if (optionTexts.length > 0) {
    business.positioningStatement = optionTexts.join('\n\n---\n\n')
  }

  // Current Positioning prose — the analyst's explanation of how the firm
  // currently positions itself (distinct from the tagline blockquote above).
  const currentStart = section.indexOf('### Current Positioning')
  if (currentStart > -1) {
    const tail = section.slice(currentStart + '### Current Positioning'.length)
    const stopAt = (() => {
      const candidates = [tail.indexOf('\n### '), tail.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : tail.length
    })()
    const block = tail.slice(0, stopAt)
    // Skip the blockquote tagline; keep prose paragraphs only.
    const prose = block
      .split('\n')
      .filter(line => !line.trim().startsWith('>') && line.trim() !== '')
      .join(' ')
      .trim()
    if (prose) business.currentPositioning = prose
  }

  // Competitive Context table (only present in some MBPs).
  const competitiveStart = section.indexOf('### Competitive Context')
  if (competitiveStart > -1) {
    const tail = section.slice(competitiveStart)
    const stopAt = (() => {
      const candidates = [tail.indexOf('\n### '), tail.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : tail.length
    })()
    const block = tail.slice(0, stopAt)

    const competitors: NonNullable<typeof business.competitors> = []
    const SKIP = new Set(['firm', 'field'])
    for (const row of tableRows(block)) {
      if (row.length < 5) continue
      const name = row[0].replace(/\*+/g, '').trim()
      if (!name || SKIP.has(name.toLowerCase())) continue
      competitors.push({
        name,
        location: row[1].replace(/\*+/g, '').trim(),
        size: row[2].replace(/\*+/g, '').trim(),
        nicheClaim: row[3].replace(/\*+/g, '').trim(),
        positioningNotes: row[4].replace(/\*+/g, '').trim(),
      })
    }
    if (competitors.length > 0) business.competitors = competitors

    // "Key Competitive Takeaways" bullets often follow the table.
    const takeawaysIdx = block.indexOf('**Key Competitive Takeaways:**')
    if (takeawaysIdx > -1) {
      const tBlock = block.slice(takeawaysIdx)
      const bullets = tBlock.match(/^- \*\*[^*]+\*\*[^\n]*/gm)
      if (bullets) {
        business.competitiveContext = bullets
          .map(b => b.replace(/^- \*\*/, '').replace(/\*\*/, '').trim())
          .join('\n')
      }
    }
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

  // If the MBP didn't list LinkedIn at all, still seed the field so the agent
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
      // Only the GBP line itself — `gbpText` may run to the next blank line and
      // pull in the following field (e.g. "Review Summary:"); keep line one.
      gbpHint = gbpText.split('\n')[0].replace(/\*+/g, '').trim().slice(0, 240)
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

  // Locate each ICP block by its heading and slice between them. Stop at the
  // sub-category heading so prose text from later subsections doesn't bleed in.
  // Korbey MBPs use `\n---\n` separators; Barwick does not — heading-position
  // slicing handles both shapes.
  const niches: NonNullable<SessionSchema['niches']> = []
  const subAssessmentIdx = section.indexOf('### Industry Sub-Category Assessment')
  const icpScope = subAssessmentIdx > -1 ? section.slice(0, subAssessmentIdx) : section
  const headingPositions = [...icpScope.matchAll(/\*\*([^*]+?)\s+ICP\*\*/g)]
    .map(m => ({ name: m[1].trim(), start: m.index! }))

  for (let i = 0; i < headingPositions.length; i++) {
    const { name, start } = headingPositions[i]
    const end = i + 1 < headingPositions.length ? headingPositions[i + 1].start : icpScope.length
    const block = icpScope.slice(start, end)
    const typeMatch = block.match(/\*\*Business type:\*\*\s*([^\n]+)/)
    const description = typeMatch ? typeMatch[1].trim() : ''
    const signalMatch = block.match(/\*\*Ideal signal:\*\*\s*\*"([^"]+)"\*/)
    const icp = signalMatch ? signalMatch[1] : ''
    const fearMatch = block.match(/\*\*What they fear:\*\*\s*([^\n]+)/)
    const painPoints = fearMatch ? fearMatch[1].trim() : ''
    const valueMatch = block.match(/\*\*What they value:\*\*\s*([^\n]+)/)
    const valueProp = valueMatch ? valueMatch[1].trim() : ''
    const triggerMatch = block.match(/\*\*What triggers a search:\*\*\s*([^\n]+)/)
    const customerTrigger = triggerMatch ? triggerMatch[1].trim() : ''
    const sizeMatch = block.match(/\*\*Size range:\*\*\s*([^\n]+)/)
    const typicalRevenueSize = sizeMatch ? sizeMatch[1].trim() : ''
    niches.push({
      name,
      description,
      icp,
      painPoints,
      valueProp,
      ...(customerTrigger ? { customerTrigger } : {}),
      ...(typicalRevenueSize ? { typicalRevenueSize } : {}),
    })
  }
  schema.niches = niches

  // Industry Sub-Category Assessment — multiple tables, one per industry,
  // each preceded by **<Industry>** as a bolded heading line.
  const subAssessIdx = section.indexOf('### Industry Sub-Category Assessment')
  if (subAssessIdx > -1) {
    const subBlock = section.slice(subAssessIdx)
    const stopAt = (() => {
      const candidates = [subBlock.indexOf('\n### ', 1), subBlock.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : subBlock.length
    })()
    const scope = subBlock.slice(0, stopAt)

    // Find each industry sub-section by its **Name** heading followed by a table.
    const industryHeadingRe = /\n\*\*([^*]+?)\*\*[^\n]*\n/g
    const matches = [...scope.matchAll(industryHeadingRe)]
    for (let i = 0; i < matches.length; i++) {
      const headingName = matches[i][1].trim()
      const start = matches[i].index! + matches[i][0].length
      const end = i + 1 < matches.length ? matches[i + 1].index! : scope.length
      const tableBlock = scope.slice(start, end)
      const subRows = tableRows(tableBlock)
      const subCategories: NonNullable<NonNullable<SessionSchema['niches']>[number]['subCategories']> = []
      const SUB_SKIP = new Set(['sub-category', 'subcategory', 'field'])
      for (const row of subRows) {
        const subName = row[0].replace(/\*+/g, '').trim()
        if (!subName || SUB_SKIP.has(subName.toLowerCase())) continue
        const statusRaw = (row[1] ?? '').trim()
        let status: 'confirmed' | 'likely' | 'verify'
        if (statusRaw.includes('✅')) status = 'confirmed'
        else if (statusRaw.includes('🔍')) status = 'likely'
        else status = 'verify'
        const notes = (row[2] ?? '').replace(/\*+/g, '').trim()
        subCategories.push({ name: subName, status, ...(notes ? { notes } : {}) })
      }
      if (subCategories.length === 0) continue

      // Match heading to a niche by stem-based token overlap. Handles plurals
      // (Churches ↔ Church), hyphenated niches (Service-based Businesses ↔
      // Service Businesses), and multi-word names with extensions
      // (Church / Faith-Based ↔ Churches).
      const stem = (w: string) => w.replace(/(es|s)$/, '')
      const tokenize = (s: string) =>
        s.toLowerCase().split(/[^a-z]+/).filter(t => t.length > 2).map(stem)
      const headingTokens = new Set(tokenize(headingName))
      const target = niches.find(n => {
        const nameTokens = tokenize(n.name)
        return nameTokens.some(t => headingTokens.has(t))
      })
      if (target) target.subCategories = subCategories
    }
  }

  // Team-Derived Audience Opportunities — bullets after the heading.
  const audienceIdx = section.indexOf('### Team-Derived Audience Opportunities')
  if (audienceIdx > -1) {
    const block = section.slice(audienceIdx)
    const stopAt = (() => {
      const candidates = [block.indexOf('\n### ', 1), block.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : block.length
    })()
    const scoped = block.slice(0, stopAt)
    const bullets = scoped.match(/^- \*\*[^\n]+/gm)
    if (bullets && bullets.length > 0) {
      ensureMeta(schema)
      ensureOpportunities(schema)
      schema._meta!.opportunities!.audienceOpportunities = bullets.map(b =>
        b.replace(/^- /, '').trim()
      )
    }
  }
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

  // Detect column layout. Newer MBPs use:
  //   | Service | Clarity | Current Framing | Rewrite Direction |
  // Older MBPs use:
  //   | Service | Tier | Notes | Description |
  // We look at the header row to decide whether row[3] is rewriteDirection
  // (preferred) or just a description.
  let rewriteCol = -1
  const descCol = 3
  const headerMatch = servicesBlock.match(/^\|\s*\*?\*?Service[^\n]+/m)
  if (headerMatch) {
    const cols = headerMatch[0]
      .split('|')
      .slice(1, -1)
      .map(c => c.replace(/\*+/g, '').trim().toLowerCase())
    const rIdx = cols.findIndex(c => c.includes('rewrite'))
    if (rIdx >= 0) rewriteCol = rIdx
  }

  for (const row of tableRows(servicesBlock)) {
    const name = row[0].replace(/\*+/g, '').trim()
    if (!name || SKIP.has(name.toLowerCase())) continue
    const description = (row[descCol] ?? row[2] ?? '').replace(/\*+/g, '').trim()
    const rewriteDirection = rewriteCol >= 0
      ? (row[rewriteCol] ?? '').replace(/\*+/g, '').trim()
      : ''
    services.push({
      name,
      description,
      offerings: [],
      ...(rewriteDirection ? { rewriteDirection } : {}),
    })
  }

  schema.services = services

  // High-Opportunity Niches table — strategic recommendations for content gen.
  const highOppIdx = section.indexOf('### High-Opportunity Niches')
  if (highOppIdx > -1) {
    const block = section.slice(highOppIdx)
    const stopAt = (() => {
      const candidates = [block.indexOf('\n### ', 1), block.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : block.length
    })()
    const scoped = block.slice(0, stopAt)
    const niches: string[] = []
    const SKIP_NICHE = new Set(['niche', 'field'])
    for (const row of tableRows(scoped)) {
      const name = row[0].replace(/\*+/g, '').trim()
      if (!name || SKIP_NICHE.has(name.toLowerCase())) continue
      const rationale = (row[1] ?? '').replace(/\*+/g, '').trim()
      niches.push(rationale ? `${name} — ${rationale}` : name)
    }
    if (niches.length > 0) {
      ensureMeta(schema)
      ensureOpportunities(schema)
      schema._meta!.opportunities!.highOpportunityNiches = niches
    }
  }

  // Team-Derived Service Opportunities — bullets.
  const serviceOppIdx = section.indexOf('### Team-Derived Service Opportunities')
  if (serviceOppIdx > -1) {
    const block = section.slice(serviceOppIdx)
    const stopAt = (() => {
      const candidates = [block.indexOf('\n### ', 1), block.indexOf('\n## ')]
        .filter(i => i > -1)
      return candidates.length ? Math.min(...candidates) : block.length
    })()
    const scoped = block.slice(0, stopAt)
    const bullets = scoped.match(/^- \*\*[^\n]+/gm)
    if (bullets && bullets.length > 0) {
      ensureMeta(schema)
      ensureOpportunities(schema)
      schema._meta!.opportunities!.serviceOpportunities = bullets.map(b =>
        b.replace(/^- /, '').trim()
      )
    }
  }
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

    const credsRaw = teamTableValue(block, 'Credentials')
    const certifications =
      credsRaw && credsRaw !== 'None listed' && !credsRaw.includes('❓')
        ? credsRaw.split(/[,/]/).map((c: string) => c.trim()).filter(Boolean)
        : []

    const expertise = parseTeamList(teamTableValue(block, 'Areas of Expertise'))
    const associations = parseTeamList(teamTableValue(block, 'Associations'))
    const press = parseTeamList(teamTableValue(block, 'Published / Speaking'))
    const previousEmployers = parseTeamList(teamTableValue(block, 'Previous Employers'))

    const footprintMatch = block.match(/\*\*External Footprint:\*\*\s*([^\n]+)/i)
    const footprintRaw = footprintMatch ? footprintMatch[1].trim().toLowerCase() : ''
    const externalFootprint =
      footprintRaw.includes('high') ? 'high' as const
      : footprintRaw.includes('moderate') ? 'moderate' as const
      : footprintRaw.includes('minimal') || footprintRaw.includes('low') ? 'minimal' as const
      : undefined

    // Bio Summary paragraph between **Bio Summary:** and the next bold heading
    // (Leverage Opportunities) or the end of the member block.
    let bio = ''
    const bioMatch = block.match(/\*\*Bio Summary:\*\*\s*([\s\S]*?)(?=\n\*\*[A-Z]|\n###|\n$)/)
    if (bioMatch) {
      bio = bioMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
    }

    // Best-effort education extraction from the bio paragraph.
    let education: string | undefined
    if (bio) {
      const eduMatch = bio.match(/University of [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?|[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)? University/)
      if (eduMatch) education = eduMatch[0]
    }

    team.push({
      name,
      title,
      certifications,
      bio,
      specializations: [],
      ...(expertise.length ? { expertise } : {}),
      ...(associations.length ? { associations } : {}),
      ...(press.length ? { press } : {}),
      ...(previousEmployers.length ? { previousEmployers } : {}),
      ...(education ? { education } : {}),
      ...(externalFootprint ? { externalFootprint } : {}),
    })

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

function teamTableValue(block: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('\\|\\s*\\*{0,2}' + escaped + '\\*{0,2}\\s*\\|\\s*([^|\\n]+)', 'i')
  const m = block.match(re)
  return m ? m[1].trim() : ''
}

function parseTeamList(raw: string): string[] {
  if (!raw) return []
  if (raw.includes('(not found)') || raw.includes('(none surfaced)') || raw.includes('(none found)')) return []
  return raw
    .split(/[;,]|\s+\/\s+/)
    .map(s => s.replace(/\*+/g, '').trim())
    .filter(Boolean)
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

// ─── Section 11 + Review Prompts + _meta helpers ─────────────────────────────

function ensureMeta(schema: SessionSchema): void {
  if (!schema._meta) {
    schema._meta = {
      phase3_completed_chunks: [],
      phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
      phase4_flagged_for_followup: [],
      admin_overrides: {},
    }
  }
}

function ensureOpportunities(schema: SessionSchema): void {
  ensureMeta(schema)
  if (!schema._meta!.opportunities) {
    schema._meta!.opportunities = {
      audienceOpportunities: [],
      serviceOpportunities: [],
      highOpportunityNiches: [],
    }
  }
}

function parseSection11(markdown: string, schema: SessionSchema): void {
  const section = extractSection(markdown, 11)
  if (!section) return

  const items = section.match(/^\s*-\s*\[\s*\]\s*(.+)$/gm)
  if (!items || items.length === 0) return

  const checklist = items
    .map(line => line.replace(/^\s*-\s*\[\s*\]\s*/, '').trim())
    .filter(Boolean)

  if (checklist.length > 0) {
    ensureMeta(schema)
    schema._meta!.before_you_review_checklist = checklist
  }
}

function parseReviewPrompts(markdown: string, schema: SessionSchema): void {
  const sectionPositions: Array<{ id: string; index: number }> = []
  for (const m of markdown.matchAll(/##\s+Section\s+([0-9]+[A-Z]?)\b/gm)) {
    sectionPositions.push({ id: m[1], index: m.index! })
  }
  if (sectionPositions.length === 0) return

  const prompts: Record<string, string> = {}
  const blockRe = /^>\s*📋\s*\*\*Client Review Action:\*\*\s*([\s\S]*?)(?=\n\n|\n##|\n###|$)/gm
  for (const r of markdown.matchAll(blockRe)) {
    const at = r.index!
    let owner: string | null = null
    for (let i = sectionPositions.length - 1; i >= 0; i--) {
      if (sectionPositions[i].index <= at) {
        owner = sectionPositions[i].id
        break
      }
    }
    if (!owner) continue
    const body = r[1]
      .split('\n')
      .map(line => line.replace(/^>\s?/, '').trim())
      .filter(Boolean)
      .join(' ')
      .trim()
    if (!body) continue
    const key = `section_${owner}`
    // First analyst prompt wins per section (some sections include multiple
    // inline review actions; the first is usually the highest-level).
    if (!prompts[key]) prompts[key] = body
  }

  if (Object.keys(prompts).length > 0) {
    ensureMeta(schema)
    schema._meta!.review_prompts = prompts
  }
}

// ─── Phase 4 gaps (only added when the MBP didn't populate the field) ────────

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) =>
      acc && typeof acc === 'object'
        ? (acc as Record<string, unknown>)[key]
        : undefined,
    obj
  )
}

function isPopulated(schema: SessionSchema | undefined, path: string): boolean {
  if (!schema) return false
  const v = getPath(schema, path)
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  // Booleans are initialized to `false` as schema defaults (e.g. hasBrandGuide).
  // The MBP doesn't set them, so a `false` here is never a real answer — gaps
  // for boolean fields stay until the agent collects them at runtime.
  if (typeof v === 'boolean') return false
  return true
}

function addPhase4Gaps(gaps: GapItem[], schema?: SessionSchema): void {
  // Tier numbering mirrors raw-docs/agent-conversation-flow.md Phase 4. Each
  // entry is only emitted if the MBP didn't already fill the field — chat fills
  // gaps, not duplicates.
  const candidates: GapItem[] = [
    // Firm background
    { field: 'business.foundingYear', label: 'Founding Year', phase: 4, tier: 1, resolved: false },
    { field: 'business.firmHistory', label: 'Firm History / Origin Story', phase: 4, tier: 1, resolved: false },
    // Clients
    { field: 'business.geographicScope', label: 'Geographic Scope', phase: 4, tier: 1, resolved: false },
    { field: 'business.clientAgeRanges', label: 'Client Age Ranges', phase: 4, tier: 1, resolved: false },
    { field: 'business.customerNeeds', label: 'Client Needs & Pain Points', phase: 4, tier: 1, resolved: false },
    { field: 'business.howClientsFind', label: 'How Clients Find the Firm', phase: 4, tier: 1, resolved: false },
    // Per flow doc Tier 2: success stories + pricing — ask only if time allows.
    { field: 'business.clientSuccessStories', label: 'Client Success Stories (1–2 examples)', phase: 4, tier: 2, resolved: false },
    { field: 'business.pricing', label: 'Pricing / Fee Structure', phase: 4, tier: 2, resolved: false },
    { field: 'business.pricingPagePreference', label: 'Pricing Page Preference (plans / calculator / both / none)', phase: 4, tier: 2, resolved: false },
    // Differentiators & growth
    { field: 'business.differentiators', label: 'Differentiators (in their own words)', phase: 4, tier: 1, resolved: false },
    { field: 'business.growthGoals', label: 'Growth Goals / Where They Want to Be in 3 Years', phase: 4, tier: 2, resolved: false },
    { field: 'business.clientMixBreakdown', label: 'Client Mix Breakdown', phase: 4, tier: 2, resolved: false },
    // Culture
    { field: 'culture.missionVisionValues', label: 'Mission, Vision & Values', phase: 4, tier: 1, resolved: false },
    { field: 'culture.teamDescription', label: 'Team Culture Description', phase: 4, tier: 1, resolved: false },
    // Brand & Tone
    { field: 'brand.currentTone',       label: 'Current Brand Voice',                     phase: 4, tier: 1, resolved: false },
    { field: 'brand.aspirationalTone',  label: 'Aspirational Voice (how they want to sound)', phase: 4, tier: 1, resolved: false },
    { field: 'brand.toneAdjectives',    label: 'Tone Adjectives (words that feel like them)', phase: 4, tier: 1, resolved: false },
    { field: 'brand.toneToAvoid',       label: 'Tone to Avoid',                            phase: 4, tier: 2, resolved: false },
    { field: 'brand.voiceExample',      label: 'Voice Example Phrase',                     phase: 4, tier: 2, resolved: false },
    { field: 'brand.primaryColors',     label: 'Brand Colors',                             phase: 4, tier: 1, resolved: false },
    { field: 'brand.hasBrandGuide',     label: 'Has Existing Brand Guide',                 phase: 4, tier: 1, resolved: false },
    { field: 'brand.logoStyle',         label: 'Logo / Visual Style (modern, traditional, etc.)', phase: 4, tier: 2, resolved: false },
    // brandPersonality + typography feed downstream design-token / brand-voice
    // generation (lib/content/*); ask for them when the MBP didn't supply them.
    { field: 'brand.brandPersonality',  label: 'Brand Personality (a few descriptive traits)', phase: 4, tier: 2, resolved: false },
    { field: 'brand.typography',        label: 'Typography Preference (if any)',           phase: 4, tier: 2, resolved: false },
  ]

  for (const g of candidates) {
    if (!isPopulated(schema, g.field)) gaps.push(g)
  }

  // Per-niche pain points & value props — only ask when the MBP didn't fill them.
  if (schema?.niches?.length) {
    for (let i = 0; i < schema.niches.length; i++) {
      const niche = schema.niches[i]
      if (!niche.painPoints) {
        gaps.push({ field: `niches[${i}].painPoints`, label: `${niche.name} — Pain Points`, phase: 4, tier: 1, resolved: false })
      }
      if (!niche.valueProp) {
        gaps.push({ field: `niches[${i}].valueProp`, label: `${niche.name} — Value Proposition`, phase: 4, tier: 2, resolved: false })
      }
      if (!niche.nicheOrigin) {
        gaps.push({ field: `niches[${i}].nicheOrigin`, label: `${niche.name} — How did this niche start?`, phase: 4, tier: 2, resolved: false })
      }
    }
  }
}
