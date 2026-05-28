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
  }>
  services?: Array<{
    name: string
    description: string
    offerings: string[]
    rewriteDirection?: string
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
  reputation?: {
    googleRating?: string
    yelpRating?: string
    reviewSummary?: string
    trustSignalGaps: string[]
    pressAndMedia: string[]
  }
  content_gaps?: {
    nicheGaps: string[]
    authorityGaps: string[]
    conversionGaps: string[]
    teamExpertiseGaps: string[]
  }
}
