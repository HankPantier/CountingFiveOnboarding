// Canonical empty templates for the MBP sections the admin page renders. They
// let buildMbpDocument (with { scaffold: true }) show EVERY known field as an
// editable blank even when schema_data omits it — so an empty section like
// Reputation is fillable instead of a dead "No data collected yet." Only the
// core call-captured fields are scaffolded; deep audit-derived structures
// (socialProfiles, subCategories, metrics, competitors, geo…) still render when
// present but aren't injected as blank JSON. Password fields are never included
// (CLAUDE.md security rule 5) — registrarPasswordNote is a static reminder only.

type ObjectTemplate = Record<string, unknown>

export const OBJECT_SECTION_TEMPLATES: Record<string, ObjectTemplate> = {
  contact: { firstName: '', lastName: '', email: '', phone: '' },
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
    targetKeywords: [],
    contentEmphasis: [],
    contentExclusions: [],
    priceRange: '',
    pricingPagePreference: '',
    formerName: '',
    firmSizeEstimate: '',
    currentPositioning: '',
    competitiveContext: '',
  },
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
  technical: {
    registrar: '',
    registrationDate: '',
    expiryDate: '',
    nameservers: [],
    registrarUsername: '',
    registrarPin: '',
    registrarPasswordNote: '',
    hostingProvider: '',
    hostingContact: '',
    hostingPhone: '',
    hostingEmail: '',
    redirectDomains: [],
  },
  reputation: {
    googleRating: '',
    yelpRating: '',
    reviewSummary: '',
    trustSignalGaps: [],
    pressAndMedia: [],
    reviewThemes: [],
  },
  content_gaps: {
    nicheGaps: [],
    authorityGaps: [],
    conversionGaps: [],
    teamExpertiseGaps: [],
  },
  assets: {
    headshotsAvailable: [],
    officePhotosAvailable: false,
    testimonialsAvailable: [],
    logosUploaded: [],
    photosUploaded: [],
  },
  additional: {
    otherDetails: '',
    uploadedFiles: [],
  },
  content_direction: {
    generalDirection: '',
    preferredPhrases: [],
    avoidPhrases: [],
  },
}

// Blank item appended when the operator clicks "Add …" on an array section.
// One representative item per array; subfields render as editable blanks.
export const ARRAY_ITEM_TEMPLATES: Record<string, ObjectTemplate> = {
  locations: {
    name: '',
    street: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    fax: '',
    email: '',
    gbpUrl: '',
  },
  team: {
    name: '',
    title: '',
    bio: '',
    certifications: [],
    specializations: [],
    expertise: [],
    education: '',
  },
  services: {
    name: '',
    description: '',
    offerings: [],
    rewriteDirection: '',
    keywords: [],
  },
  niches: {
    name: '',
    description: '',
    icp: '',
    painPoints: '',
    valueProp: '',
    customerTrigger: '',
    typicalRevenueSize: '',
    nicheOrigin: '',
    keywords: [],
    revenueBand: '',
    businessStage: '',
    decisionMaker: '',
  },
  clientPortals: {
    label: '',
    url: '',
    description: '',
    category: '',
  },
}

// Human-readable singular label for each array section's Add button.
export const ARRAY_ITEM_LABELS: Record<string, string> = {
  locations: 'location',
  team: 'team member',
  services: 'service',
  niches: 'niche',
  clientPortals: 'client portal',
}
