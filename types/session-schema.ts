export type SessionSchema = {
  _meta?: {
    phase3_completed_chunks: string[]
    phase4_resolved_tiers: { tier1_done: boolean; tier2_done: boolean }
    phase4_flagged_for_followup: string[]
    admin_overrides: Record<string, boolean>
    mode?: 'client' | 'staff'
    staff_note?: string
    review_prompts?: Record<string, string>
    before_you_review_checklist?: string[]
    opportunities?: {
      audienceOpportunities: string[]
      serviceOpportunities: string[]
      highOpportunityNiches: string[]
    }
    opportunities_confirmed?: string[]
    section11_responses?: Record<string, string>
    trust_signals_confirmed?: string[]
    sitemap_decisions?: {
      skip_new_pages?: string[]
      keep_pages?: string[]
      notes?: string
    }
    // Audit intelligence that has no typed schema home. Seeded by the
    // audit→session draft so the chat can confirm it and the MBP can render it,
    // instead of discarding it. Everything optional — sub-sections appear only
    // when the audit produced them.
    audit_context?: {
      narrative?: { executiveSummary?: string; recommendations?: string[] }
      techStack?: {
        cms?: string | null
        pageBuilder?: string | null
        hosting?: string | null
        frameworks?: string[]
        riskFlags?: string[]
        commentary?: string
      }
      domain?: { registered?: string | null; ageYears?: number | null; lastUpdated?: string | null }
      contentLibrary?: {
        totalPieces?: number
        formats?: Array<{ type: string; count: number; cadence: string }>
        recommendations?: string[]
      }
      competitive?: {
        keywordRankings?: Array<{ keyword: string; rank: number | null; note: string }>
        aiSearchPresence?: string
        localSeo?: string
      }
    }
  }
  contact?: {
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  websiteUrl?: string
  technical?: {
    registrar: string
    registrationDate: string
    expiryDate: string
    nameservers: string[]
    registrarUsername: string
    registrarPin: string
    registrarPasswordNote: string
    adminContact: { name: string; phone: string; email: string }
    hostingProvider: string
    hostingContact: string
    hostingPhone: string
    hostingEmail: string
    redirectDomains: string[]
  }
  locations?: Array<{
    name: string
    street: string
    line2: string
    city: string
    state: string
    zip: string
    phone: string
    fax: string
    email: string
    hours: Record<string, string>
    // Structured for schema.org OpeningHoursSpecification; `hours` above stays
    // the human-readable/display form. Times are 24h "HH:MM".
    openingHours?: Array<{ dayOfWeek: string[]; opens: string; closes: string }>
    geo?: { lat: number; lng: number }
    gbpUrl?: string
  }>
  team?: Array<{
    name: string
    title: string
    certifications: string[]
    bio: string
    specializations: string[]
    expertise?: string[]
    associations?: string[]
    press?: string[]
    previousEmployers?: string[]
    education?: string
    externalFootprint?: 'minimal' | 'moderate' | 'high'
    // Audit-derived per-member social footprint + niche-expertise mapping,
    // seeded by enrich-from-intelligence from the audit's team_social pass.
    socialProfiles?: Array<{
      platform: string
      url: string | null
      status: string
      metrics?: {
        followerCount?: number | null
        lastActivity?: string | null
        pageType?: string
      }
      usefulness?: 'low' | 'medium' | 'high'
      roomForImprovement?: string
    }>
    nicheOpportunities?: string[]
  }>
  services?: Array<{
    name: string
    description: string
    offerings: string[]
    rewriteDirection?: string
    keywords?: string[]
  }>
  // Client-facing external portals (QuickBooks, ShareFile, payroll, bill-pay,
  // remote support). Rendered on the site as the "Client Center" modal. Flat and
  // agent-fillable via update_session_data dotted paths; grouped by `category`
  // into content/client-center.json at package-assembly time. Links only —
  // portal passwords are never collected or stored (CLAUDE.md security rule 5).
  clientPortals?: Array<{
    label: string
    url: string
    description?: string
    category?: string
  }>
  niches?: Array<{
    name: string
    description: string
    icp: string
    painPoints: string
    valueProp: string
    customerTrigger?: string
    typicalRevenueSize?: string
    nicheOrigin?: string
    keywords?: string[]
    // Persona detail for buyer-targeted copy and content.
    revenueBand?: string
    businessStage?: string
    decisionMaker?: string
    subCategories?: Array<{
      name: string
      status: 'confirmed' | 'likely' | 'verify'
      notes?: string
    }>
  }>
  business?: {
    name: string
    tagline: string
    positioningOption: string
    positioningStatement: string
    foundingYear: string
    firmHistory: string
    idealClients: string[]
    geographicScope: string
    clientAgeRanges: string[]
    customerNeeds: string
    customerDescription: string
    differentiators: string
    affiliations: string[]
    clientSuccessStories: string[]
    clientMixBreakdown: string
    howClientsFind: string
    pricing: string
    growthGoals: string
    // Structured local-SEO targeting. serviceAreas drives geo landing pages and
    // schema.org areaServed; targetKeywords drives on-page + content targeting.
    serviceAreas?: Array<{ city: string; county?: string; state?: string; radiusMiles?: number; primary?: boolean }>
    targetKeywords?: string[]
    // schema.org priceRange hint (e.g. "$$"), distinct from the free-text `pricing`.
    priceRange?: string
    formerName?: string
    firmSizeEstimate?: string
    currentPositioning?: string
    competitiveContext?: string
    competitors?: Array<{
      name: string
      location: string
      size: string
      nicheClaim: string
      positioningNotes: string
    }>
    googleBusinessProfile?: {
      url: string | null
      usefulness?: 'low' | 'medium' | 'high'
      roomForImprovement?: string
    }
  }
  culture?: {
    missionVisionValues: string
    teamDescription: string
    socialMediaChannels: string[]
    linkedIn?: {
      url: string | null
      usefulness?: 'low' | 'medium' | 'high'
      roomForImprovement?: string
    }
  }
  brand?: {
    currentTone: string
    aspirationalTone: string
    toneAdjectives: string[]
    toneToAvoid: string[]
    voiceExample: string
    brandPersonality: string
    primaryColors: string
    typography: string
    logoStyle: string
    hasBrandGuide: boolean
  }
  assets?: {
    headshotsAvailable: string[]
    officePhotosAvailable: boolean
    testimonialsAvailable: string[]
    logosUploaded: string[]
    photosUploaded: string[]
  }
  additional?: {
    otherDetails: string
    uploadedFiles: string[]
  }
  proposed_sitemap?: Array<{
    url: string
    title: string
    status: 'new' | 'update' | 'existing'
    parent?: string
    notes?: string
  }>
  current_sitemap?: Array<{
    url: string
    title: string
    action: 'keep' | 'redirect' | 'consolidate' | 'new'
    new_url?: string
    live: boolean
  }>
  // Audit-derived social & local presence, quality-assessed per channel. Seeded
  // by the audit→session draft (enrich-from-intelligence); hand-written MBPs keep
  // populating the shared culture.linkedIn / business.googleBusinessProfile homes.
  socialPresence?: {
    profiles: Array<{
      platform: string
      url: string | null
      status: string
      metrics?: {
        rating?: number | null
        reviewCount?: number | null
        followerCount?: number | null
        categories?: string[]
        hoursListed?: boolean
        lastActivity?: string | null
        pageType?: string
        completeness?: string
      }
      usefulness?: 'low' | 'medium' | 'high'
      roomForImprovement?: string
    }>
  }
  reputation?: {
    googleRating?: string
    yelpRating?: string
    reviewSummary?: string
    trustSignalGaps: string[]
    pressAndMedia: string[]
    // Per-source review volume/rating for aggregate trust signals, plus recurring
    // themes surfaced from review text.
    reviewSources?: Array<{ source: string; rating?: string; count?: number }>
    reviewThemes?: string[]
  }
  content_gaps?: {
    nicheGaps: string[]
    authorityGaps: string[]
    conversionGaps: string[]
    teamExpertiseGaps: string[]
  }
}
