export type SessionSchema = {
  _meta?: {
    phase3_completed_chunks: string[]
    phase4_resolved_tiers: { tier1_done: boolean; tier2_done: boolean }
    phase4_flagged_for_followup: string[]
    admin_overrides: Record<string, boolean>
    // Human-readable AI synopsis of the firm (who they are + how they sound),
    // generated on demand from the MBP so an operator can read/verify tone at a
    // glance. Not sent back into any generation prompt (serializeSchemaFull
    // strips _meta). See lib/mbp/generate-synopsis.ts.
    firm_synopsis?: { text: string; generatedAt: string }
    // Dotted field paths written by an approved MBP suggestion → ISO timestamp of
    // when it was applied. The admin MBP page highlights these fields for a few
    // days (a fading "just added" cue), then the page-level recency filter drops
    // them. See app/api/mbp/[id]/suggestions/[suggestionId] + build-document.
    recently_applied?: Record<string, string>
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
    // Record of the Phase-3 niche keep/drop review submitted via the
    // NicheReviewCard. Its presence is the advancement gate for Phase 3 → 4
    // (see lib/agent/phase-validators.ts) and drives the admin/MBP read-back.
    niche_review?: {
      reviewedAt: string
      kept: string[]
      dropped: string[]
      added: string[]
      reviewedBy?: string
    }
    // Record of the Phase-3 services keep/drop review submitted via the
    // ServiceReviewCard. Its presence is an advancement gate for Phase 3 → 4
    // (see lib/agent/phase-validators.ts), guarded on there being services to
    // review. Mirrors niche_review.
    services_review?: {
      reviewedAt: string
      kept: string[]
      dropped: string[]
      added: string[]
      reviewedBy?: string
    }
    // Record of the Phase-3 geographic scope review submitted via the
    // GeographyReviewCard. Its presence is an advancement gate for Phase 3 → 4
    // (see lib/agent/phase-validators.ts). `scope: 'national'` ⇒ areaCount 0 is
    // valid; local/regional expect confirmed service areas.
    geo_review?: {
      reviewedAt: string
      scope: 'local' | 'regional' | 'national'
      areaCount: number
      reviewedBy?: string
    }
    // Record of the Phase-3 sub-service keep/drop review submitted via the
    // SubCategoryReviewCard. Its presence is an advancement gate for Phase 3 → 4
    // (see lib/agent/phase-validators.ts), guarded on there being at least one
    // sub-service under a kept niche. `confirmed`/`dropped` carry the niche each
    // sub-service belongs to (sub-service names are not unique across niches).
    subcategories_review?: {
      reviewedAt: string
      confirmed: Array<{ niche: string; name: string }>
      dropped: Array<{ niche: string; name: string }>
      reviewedBy?: string
    }
    // Record of the team keep/remove/add review submitted from the Audit Review
    // step (applyTeamReview → lib/agent/team-review.ts). Its presence is a
    // conditional Phase 3 → 4 gate (only when the firm has team members). Mirrors
    // niche_review.
    team_review?: {
      reviewedAt: string
      kept: string[]
      removed: string[]
      added: string[]
      reviewedBy?: string
    }
    // Umbrella marker written when the operator submits the consolidated Audit
    // Review step (POST /api/sessions/[id]/audit-review). Convenience only — the
    // individual *_review markers above are the authoritative phase gates.
    audit_review?: {
      reviewedAt: string
      reviewedBy?: string
    }
    // AI-suggested treatment + rationale per item, produced once at audit→seed
    // time (lib/session-draft/suggest-audit-treatments.ts) so the Audit Review
    // step opens with each choice pre-selected — the operator confirms instead of
    // deciding blind. Kept SEPARATE from the human's decision (status/pageTreatment
    // on the items) so AI-vs-human-vs-override stays distinguishable. Keyed by item
    // name so it also covers audit-recommended items not yet in niches[]/services[].
    // Advisory only — never gates a phase; joined into the review props by name.
    audit_suggestions?: {
      services?: Array<{ name: string; treatment: 'page' | 'block' | 'exclude'; parent?: string; rationale: string; confidence?: 'high' | 'medium' | 'low' }>
      niches?: Array<{ name: string; treatment: 'page' | 'block' | 'exclude'; parent?: string; rationale: string; confidence?: 'high' | 'medium' | 'low' }>
      subCategories?: Array<{ niche: string; name: string; treatment: 'page' | 'block' | 'exclude'; parent?: string; rationale: string; confidence?: 'high' | 'medium' | 'low' }>
      team?: Array<{ name: string; decision: 'keep' | 'remove'; rationale: string; confidence?: 'high' | 'medium' | 'low' }>
      geoScope?: { scope: 'local' | 'regional' | 'national'; primaryArea?: string; rationale: string; confidence?: 'high' | 'medium' | 'low' }
      generatedAt: string
    }
    section11_responses?: Record<string, string>
    // Lightweight, advisory per-field provenance keyed by dotted path (e.g.
    // "brand.voiceExample", "niches.0.customerTrigger"). 'audit' = seeded from the
    // site audit/draft; 'notes' = filled by call-notes extraction; 'confirmed' =
    // entered/confirmed in chat or by an admin edit; 'thin' = present but likely a
    // placeholder (short/low-signal). NEVER gates a phase advance — it only lets
    // content generation down-weight thin values and the admin UI badge field
    // origin. Absent = seed/unverified. See lib/mbp/provenance.ts.
    field_provenance?: Record<string, 'audit' | 'notes' | 'confirmed' | 'thin'>
    trust_signals_confirmed?: string[]
    sitemap_decisions?: {
      skip_new_pages?: string[]
      keep_pages?: string[]
      notes?: string
    }
    // Snapshot of the last team-headshot scan of the client's live site. Written
    // by the audit → session-start auto-pull so the admin UI can show per-member
    // suggestions for the photos it did not auto-pull, without re-scraping.
    teamPhotoDiscovery?: {
      scannedPages: string[]
      suggestions: Array<{ name: string; imageUrl: string | null; confidence: 'high' | 'low' | 'none' }>
      candidates: Array<{
        imageUrl: string
        altText: string | null
        nearbyName: string | null
        filename: string
        width: number | null
        height: number | null
        sourcePageUrl: string
      }>
      /** ISO timestamp of the scan. */
      at: string
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
      // Pricing data detected on the client's CURRENT site during the audit.
      // Seeds the pricing calculator / plans editors and defaults the rep's
      // pricing-page preference. Everything optional — present only when the
      // audit found a pricing page or figures.
      pricing?: {
        pageUrl?: string
        // How the current site presents pricing, if discernible.
        strategy?: 'calculator' | 'tiers' | 'flat' | 'mixed'
        // Tier/plan cards found on the current site.
        tiers?: Array<{ name: string; price?: string; features?: string[] }>
        // Per-service rates found (e.g. "Bookkeeping — $250/mo").
        rates?: Array<{ service?: string; rate?: string }>
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
    // The operator's keep/remove decision from the Audit Review team step. Absent =
    // kept. A 'remove'd member stays in the array for read-back but is excluded from
    // all content generation via activeTeam() (lib/content/active-team.ts).
    teamDecision?: 'keep' | 'remove'
  }>
  services?: Array<{
    name: string
    description: string
    offerings: string[]
    rewriteDirection?: string
    keywords?: string[]
    // Operator's keep/drop decision from the Phase-3 service-review card. Absent =
    // active/kept. A 'dropped' service is excluded from all content generation via
    // activeServices() (lib/content/active-services.ts) but kept in the array for
    // auditability and to preserve services[i] gap-path indexes.
    status?: 'kept' | 'dropped'
    // Audit source: 'site' = detected on the client's current website; 'audit' =
    // recommended by the audit as a new addition. Drives the two-batch (existing vs
    // proposed) split in the onboarding Audit Review step. Absent ⇒ treat as 'site'.
    origin?: 'site' | 'audit'
    // The operator's page-vs-block decision from the Audit Review step. 'page' = its
    // own generated page; 'block' = rendered as a section on the `parent` page, not
    // its own URL; 'exclude' ⇒ the helper also sets status:'dropped'. Absent ⇒ own
    // page (matches legacy behavior). Read by lib/content/page-treatment.ts.
    pageTreatment?: 'page' | 'block' | 'exclude'
    // When pageTreatment==='block', the parent page this item renders on — a sitemap
    // URL ('/services') or a sibling item's name the operator picked. Absent ⇒ the
    // category-hub default resolved by resolveBlockParent().
    parent?: string
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
    // Audit-detected confidence that the firm actually serves this niche
    // (carried over from the audit's DetectedNiche.signal). Surfaced in the
    // onboarding niche-review card so the operator can scrutinize weak signals.
    signal?: 'weak' | 'moderate' | 'strong'
    // Operator's keep/drop decision from the Phase-3 niche-review card. Absent =
    // active/kept. A 'dropped' niche is excluded from all content generation via
    // activeNiches() (lib/content/active-niches.ts) but kept in the array for
    // auditability and to preserve niches[i] gap-path indexes.
    status?: 'kept' | 'dropped'
    // Audit source: 'site' = detected on the client's current website; 'audit' =
    // recommended by the audit as a new addition. Drives the two-batch (existing vs
    // proposed) split in the onboarding Audit Review step. Absent ⇒ treat as 'site'.
    origin?: 'site' | 'audit'
    // The operator's page-vs-block decision from the Audit Review step. 'page' = its
    // own generated page; 'block' = rendered as a section on the `parent` page, not
    // its own URL; 'exclude' ⇒ the helper also sets status:'dropped'. Absent ⇒ own
    // page (matches legacy behavior). Read by lib/content/page-treatment.ts.
    pageTreatment?: 'page' | 'block' | 'exclude'
    // When pageTreatment==='block', the parent page this item renders on — a sitemap
    // URL ('/industries') or a sibling item's name the operator picked. Absent ⇒ the
    // category-hub default resolved by resolveBlockParent().
    parent?: string
    customerTrigger?: string
    typicalRevenueSize?: string
    nicheOrigin?: string
    keywords?: string[]
    // Persona detail for buyer-targeted copy and content.
    revenueBand?: string
    businessStage?: string
    decisionMaker?: string
    // Sub-services under this niche. `confirmed | likely | verify` come from the
    // MBP parser's audit read; `dropped` is the operator's Phase-3 sub-service
    // review decision (SubCategoryReviewCard → _meta.subcategories_review). A
    // dropped sub-service stays in the array for read-back but is excluded via
    // activeSubCategories() (lib/content/active-subcategories.ts).
    subCategories?: Array<{
      name: string
      status: 'confirmed' | 'likely' | 'verify' | 'dropped'
      notes?: string
      // Audit source, mirroring niches[].origin. Absent ⇒ 'site'.
      origin?: 'site' | 'audit'
      // Page-vs-block decision from the Audit Review step. 'page' promotes the
      // sub-service to its own page (/industries/<niche>/<sub>); 'block' keeps it as
      // a section on the parent niche page (today's behavior); 'exclude' ⇒ status
      // 'dropped'. Absent ⇒ block (rendered on the niche page).
      pageTreatment?: 'page' | 'block' | 'exclude'
      // When pageTreatment==='block', the parent page (defaults to the owning niche
      // page). Present only when the operator overrides the default.
      parent?: string
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
    // Structured national-vs-local decision from the Phase-3 GeographyReviewCard.
    // Drives whether content-gen builds geo landing pages ('local'/'regional') or
    // leans national. Complements the free-text geographicScope above.
    serviceScope?: 'local' | 'regional' | 'national'
    // Structured local-SEO targeting. serviceAreas drives geo landing pages and
    // schema.org areaServed; targetKeywords drives on-page + content targeting.
    serviceAreas?: Array<{ city: string; county?: string; state?: string; radiusMiles?: number; primary?: boolean }>
    targetKeywords?: string[]
    // Content-scope directives the rep captures on the call (free-form notes →
    // extracted here). contentEmphasis = industries/topics/services to FEATURE;
    // contentExclusions = anything the client said to NEVER include. Enforced in
    // every generator via buildFirmContext().
    contentEmphasis?: string[]
    contentExclusions?: string[]
    // schema.org priceRange hint (e.g. "$$"), distinct from the free-text `pricing`.
    priceRange?: string
    // Which pricing page(s) the client wants on the new site, captured in Phase 4
    // (and defaulted from audit-detected pricing). Drives emission of the plans
    // page (/pricing) and/or interactive calculator (/pricing-calculator). An
    // explicit pricing_plans / pricing_calculators editor row overrides this.
    pricingPagePreference?: 'calculator' | 'plans' | 'both' | 'none'
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
  // Per-client writing direction, distinct from brand.toneToAvoid (stylistic
  // qualities) and business.contentExclusions (off-limits TOPICS). Read by
  // buildFirmContext so it reaches every generator. `avoidPhrases` is enforced
  // like the global no_go_phrases list (validateContent → flagged → retry);
  // `preferredPhrases` and `generalDirection` are prompt-only guidance.
  content_direction?: {
    generalDirection: string
    preferredPhrases: string[]
    avoidPhrases: string[]
  }
}
