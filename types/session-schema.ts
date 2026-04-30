export type SessionSchema = {
  _meta?: {
    phase3_completed_chunks: string[]
    phase4_resolved_tiers: { tier1_done: boolean; tier2_done: boolean }
    phase4_flagged_for_followup: string[]
    admin_overrides: Record<string, boolean>
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
    googleBusinessProfileUrl: string
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
  }>
  services?: Array<{
    name: string
    description: string
    offerings: string[]
  }>
  niches?: Array<{
    name: string
    description: string
    icp: string
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
  }
  culture?: {
    missionVisionValues: string
    teamDescription: string
    socialMediaChannels: string[]
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
}
