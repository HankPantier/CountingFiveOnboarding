import type { Database } from '@/types/database'
import type { AgentMode } from './system-prompt'

// Narrowed: instructions only ever read schema_data (see system-prompt.ts).
type Session = Pick<Database['public']['Tables']['sessions']['Row'], 'schema_data'>

type SchemaMeta = {
  review_prompts?: Record<string, string>
  before_you_review_checklist?: string[]
  opportunities?: {
    audienceOpportunities?: string[]
    serviceOpportunities?: string[]
    highOpportunityNiches?: string[]
  }
}

type NicheLike = {
  name?: string
  subCategories?: Array<{ name: string; status: 'confirmed' | 'likely' | 'verify' }>
}

export function getPhaseInstructions(
  phase: number,
  session: Session,
  mode: AgentMode = 'client'
): string {
  switch (phase) {
    case 0:  return phase0Instructions()
    case 1:  return phase1Instructions(mode)
    case 2:  return phase2Instructions(mode)
    case 3:  return phase3Instructions(session, mode)
    case 4:  return phase4Instructions(session, mode)
    case 5:  return phase5Instructions(mode)
    case 6:  return phase6Instructions(mode)
    case 7:  return phase7Instructions(mode)
    default: return ''
  }
}

// Analyst free-text is unbounded length; cap each injected string so Phase 3/4
// prompts hold within the CLAUDE.md token budgets (a single verbose review_prompt
// could otherwise blow the 3.5k Sonnet target on its own).
function capText(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t
}

function analystPromptsBlock(meta: SchemaMeta | undefined, sectionIds: string[]): string {
  const prompts = meta?.review_prompts ?? {}
  const lines = sectionIds
    .map(id => {
      const text = prompts[`section_${id}`]
      return text ? `Section ${id}: ${capText(text, 500)}` : null
    })
    .filter((s): s is string => s !== null)
  if (lines.length === 0) return ''
  return `\n\nANALYST-WRITTEN ASKS (read these verbatim — they're the specific questions the analyst wants asked, not generic "any corrections?"):\n${lines.join('\n')}`
}

function unconfirmedSubCategoriesBlock(niches: NicheLike[]): string {
  const items: string[] = []
  for (const n of niches) {
    const verifies = (n.subCategories ?? []).filter(s => s.status === 'verify')
    if (verifies.length === 0 || !n.name) continue
    items.push(`${n.name}: ${verifies.map(s => s.name).join(', ')}`)
  }
  if (items.length === 0) return ''
  return `\n\nUNCONFIRMED SUB-SERVICES (ask the client a quick yes/no on each — capture confirmed ones by updating niches[i].subCategories to status: "confirmed"):\n${items.join('\n')}`
}

function opportunitiesBlock(meta: SchemaMeta | undefined): string {
  const opps = meta?.opportunities
  if (!opps) return ''
  const lines: string[] = []
  if (opps.highOpportunityNiches && opps.highOpportunityNiches.length > 0) {
    lines.push('HIGH-OPPORTUNITY NICHES (analyst-flagged — ask whether the client wants pages built for any):')
    for (const n of opps.highOpportunityNiches) lines.push(`- ${n}`)
  }
  if (opps.serviceOpportunities && opps.serviceOpportunities.length > 0) {
    lines.push('SERVICE OPPORTUNITIES (team capability not on the current site — ask if the client wants to externalize any):')
    for (const s of opps.serviceOpportunities) lines.push(`- ${s}`)
  }
  if (lines.length === 0) return ''
  return `\n\n${lines.join('\n')}\nCapture which the client confirms into _meta.opportunities_confirmed as a string array of the item names.`
}

function section11Block(meta: SchemaMeta | undefined): string {
  const items = meta?.before_you_review_checklist ?? []
  if (items.length === 0) return ''
  const numbered = items.slice(0, 30).map((it, i) => `${i + 1}. ${capText(it, 200)}`).join('\n')
  return `\n\nANALYST CHECKLIST FROM SECTION 11 (asks the analyst pre-wrote for this client — work through anything not already covered by the gap list above; skip anything answered earlier):\n${numbered}\nCapture answers into _meta.section11_responses keyed by a short slug of the item (e.g. "optometry-niche-origin").`
}

function readMeta(session: Session): SchemaMeta | undefined {
  return (session.schema_data as { _meta?: SchemaMeta } | null)?._meta
}

function readNiches(session: Session): NicheLike[] {
  return ((session.schema_data as { niches?: NicheLike[] } | null)?.niches) ?? []
}

type ReputationLike = { trustSignalGaps?: string[] }
type ProposedSitemapItem = { url?: string; title?: string; status?: 'new' | 'update' | 'existing' }
type CurrentSitemapItem = { url?: string; title?: string; action?: 'keep' | 'redirect' | 'consolidate' | 'new'; new_url?: string }

function readReputation(session: Session): ReputationLike {
  return ((session.schema_data as { reputation?: ReputationLike } | null)?.reputation) ?? {}
}

function readProposedSitemap(session: Session): ProposedSitemapItem[] {
  return ((session.schema_data as { proposed_sitemap?: ProposedSitemapItem[] } | null)?.proposed_sitemap) ?? []
}

function readCurrentSitemap(session: Session): CurrentSitemapItem[] {
  return ((session.schema_data as { current_sitemap?: CurrentSitemapItem[] } | null)?.current_sitemap) ?? []
}

function trustSignalsBlock(reputation: ReputationLike): string {
  const items = reputation.trustSignalGaps ?? []
  if (items.length === 0) return ''
  const numbered = items.slice(0, 12).map((it, i) => `${i + 1}. ${capText(it, 200)}`).join('\n')
  return `\n\nTRUST SIGNALS MISSING FROM CURRENT SITE (analyst-flagged — ask the client which to address on the new site; default answer is "yes to all"):\n${numbered}\nCapture confirmed items as a string array into _meta.trust_signals_confirmed using the analyst's short label for each (the bold heading is fine).`
}

function sitemapDecisionsBlock(
  proposed: ProposedSitemapItem[],
  current: CurrentSitemapItem[]
): string {
  const newPages = proposed.filter(p => p.status === 'new')
  const consolidations = current.filter(c => c.action === 'consolidate')
  const sunsets = current.filter(c => c.action !== 'keep' && c.action !== 'redirect' && c.action !== 'consolidate' && c.action !== 'new' && c.url)

  if (newPages.length === 0 && consolidations.length === 0 && sunsets.length === 0) return ''

  const lines: string[] = []
  if (newPages.length > 0) {
    lines.push(`PROPOSED NEW PAGES (default: build all — ask the client which, if any, to skip):`)
    for (const p of newPages.slice(0, 20)) lines.push(`- ${p.url}${p.title ? ` (${capText(p.title, 120)})` : ''}`)
  }
  if (consolidations.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`PROPOSED CONSOLIDATIONS (default: merge — ask if any of these should stay as standalone pages):`)
    for (const c of consolidations.slice(0, 20)) {
      const target = c.new_url ? ` → ${c.new_url}` : ''
      lines.push(`- ${c.url}${target}`)
    }
  }

  return `\n\n${lines.join('\n')}\nCapture exceptions into _meta.sitemap_decisions: { skip_new_pages: [urls client doesn't want], keep_pages: [current URLs the client wants kept instead of consolidated], notes: "any free-text concerns" }. Default both arrays to [] when the client accepts the proposal as-is.`
}

function phase0Instructions(): string {
  return `PHASE 0 — NOT YET STARTED
This phase is server-side only. Do not respond to the user.`
}

function phase1Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 1 — CONTACT INFO (staff mode)
Check COLLECTED DATA above first — notes extraction and the audit usually seed some of these. Only ask for the fields that are genuinely missing (first name, last name, email, phone, website URL). If all are already present, don't ask — call update_session_data with advancePhase: true immediately and move on.

If any are missing, ask for just those in ONE compact bulleted message — no introduction, no echo-back, accept answers in any order/format.
As soon as the required fields (contact.firstName, contact.lastName, contact.email, contact.phone, websiteUrl) are all populated, call update_session_data with them and advancePhase: true. Do not ask the staff member to confirm what they already typed.`
  }
  return `PHASE 1 — CONTACT INFO
Introduce yourself briefly: you're here to walk through a few details for their new Revaltus website. We've already researched their firm and will confirm what we found as we go — mostly confirming what we already have.
Collect in one exchange: first name, last name, email address, and phone number. Bold each ask.
Confirm back what you heard, then call update_session_data with contact.firstName, contact.lastName, contact.email, contact.phone, and advancePhase: true.
Once the tool confirms the advance, briefly acknowledge their details and continue — do not pause to ask whether they're ready for the next step.`
}

function phase2Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 2 — DOMAIN LOOKUP (staff mode)
One line: "WHOIS running — hold." Do not ask anything. Do not call advancePhase. The lookup completes server-side and moves the session to Phase 3 automatically.`
  }
  return `PHASE 2 — DOMAIN LOOKUP
Tell the client you're pulling some technical info on their domain and it'll just take a moment.
The WHOIS lookup runs automatically — do not ask the client for technical details and do NOT call advancePhase.`
}

function phase3Instructions(session: Session, mode: AgentMode): string {
  const schema = session.schema_data as Record<string, unknown> | null
  const meta = schema?._meta as Record<string, unknown> | undefined
  const completedChunks = (meta?.phase3_completed_chunks as string[]) ?? []
  const chunk1Done = completedChunks.includes('chunk1')
  // Legacy sessions wrote a single "chunk2" marker before the split. Treat
  // that as "both chunk2a and chunk2b done" so in-flight sessions don't stall.
  const legacyChunk2Done = completedChunks.includes('chunk2')
  const chunk2aDone = legacyChunk2Done || completedChunks.includes('chunk2a')
  const chunk2bDone = legacyChunk2Done || completedChunks.includes('chunk2b')

  const typedMeta = readMeta(session)
  const niches = readNiches(session)
  const chunk1Analyst = analystPromptsBlock(typedMeta, ['1', '3', '4'])
  const chunk1SubCats = unconfirmedSubCategoriesBlock(niches)
  const chunk2bAnalyst = analystPromptsBlock(typedMeta, ['2', '5', '6', '7'])
  const chunk2bOpportunities = opportunitiesBlock(typedMeta)
  const chunk2bTrustSignals = trustSignalsBlock(readReputation(session))
  const chunk2bSitemap = sitemapDecisionsBlock(readProposedSitemap(session), readCurrentSitemap(session))
  const chunk2bHasContent =
    chunk2bAnalyst.length + chunk2bOpportunities.length +
    chunk2bTrustSignals.length + chunk2bSitemap.length > 0

  if (!chunk1Done) {
    if (mode === 'staff') {
      return `PHASE 3 — MBP REVIEW, PART 1 (Practical info) — staff mode
Present known data as a compact bulleted list / markdown table in ONE message:
- Office location(s) — name, address, phone, fax, email, hours
- Domain & hosting info
- Social channels (URL each)
- Affiliations (✅ confirmed, ❓ unconfirmed)
- Company LinkedIn URL (or "none on file")
- Google Business Profile URL (or "none on file")

Then, in the SAME message, ask for everything outstanding:
- "Corrections? Additional locations / socials / affiliations?"
- "Registrar username + PIN (skip if N/A)"
- "Admin/technical contact name, phone, email"
- "Redirect domains"
- "LinkedIn URL (or 'none'); LinkedIn usefulness (low/med/high); LinkedIn roomForImprovement"
- "GBP URL (or 'none'); GBP usefulness (low/med/high); GBP roomForImprovement"

Accept everything in any format. As soon as it lands, call update_session_data with all populated fields, resolvedGaps including "culture.linkedIn.url" and "business.googleBusinessProfile.url", and "_meta": { "phase3_completed_chunks": ["chunk1"] }.${chunk1Analyst}${chunk1SubCats}`
    }
    return `PHASE 3 — MBP REVIEW, PART 1 (Practical info)
Present all of the following in one message:
- Office locations, domain/hosting info, social media channels, professional affiliations
- The seeded company LinkedIn (culture.linkedIn.url) and Google Business Profile (business.googleBusinessProfile.url) — show the URL if seeded, or note "we couldn't confirm one" if null.
Ask: "Does all of that look right? Any corrections?"
Then in one bundled follow-up exchange collect:
- Any missing affiliations or social handles, confirm the website URL, ask about professional memberships or partnerships not listed.
- LinkedIn: if no URL is on file, ask for it (or confirm they don't have a company page → set culture.linkedIn.url = null). If they have one, ask "Roughly how useful is your LinkedIn for attracting clients today — low, medium, or high?" → culture.linkedIn.usefulness. Then "Anything you'd want to improve about it?" → culture.linkedIn.roomForImprovement (free text; if the MBP seeded a hint, offer it back for confirmation).
- Google Business Profile: same pattern — URL or null; usefulness if they have one; roomForImprovement (always meaningful — if no GBP, "create and verify a GBP listing" is a fine note). Save to business.googleBusinessProfile.{url, usefulness, roomForImprovement}.
When part 1 is done, call update_session_data with the structured fields populated and resolvedGaps including "culture.linkedIn.url" and "business.googleBusinessProfile.url"; updates must include { "_meta": { "phase3_completed_chunks": ["chunk1"] } }.${chunk1Analyst}${chunk1SubCats}`
  }

  if (!chunk2aDone) {
    const bridgeNext = chunk2bHasContent
      ? "a few quick decisions the analyst flagged"
      : "the remaining questions"
    if (mode === 'staff') {
      return `PHASE 3 — MBP REVIEW, PART 2a (Content) — staff mode
Present known data as compact tables / lists in ONE message:
- Team — name | title (❓ if missing) | certifications
- Services — name + one-line description
- Niches — name + one-line ICP
- Positioning options A / B / C — bold label, one-line gist each

Then ask in the same message:
- "Corrections / additions to team, services, niches?"
- "Missing team titles?"
- "Pick a positioning option (A/B/C or a blend description)"

Accept all answers. As soon as positioning is chosen, call update_session_data with business.positioningOption, business.positioningStatement (use the chosen option's statement verbatim from the MBP), team/service/niche updates, and "_meta": { "phase3_completed_chunks": [..., "chunk2a"] }. DO NOT advance phase — ${bridgeNext} run next.`
    }
    return `PHASE 3 — MBP REVIEW, PART 2 (Content)
Present all of the following in one message:
- Team members (note any with missing titles), services, industry niches
Ask for corrections and any missing team titles.
Then present the 3 positioning options. Format them as a markdown list, one per line — do not put all three inline in a sentence:
- **Option A** — [summary]
- **Option B** — [summary]
- **Option C** — [summary]
Ask which direction resonates most, or if they'd like to blend elements.
Once positioning is captured, briefly close with a single sentence bridging to the next step: "${chunk2bHasContent
        ? "Next I'll walk through a few quick decisions the analyst flagged before we wrap up."
        : "That's the review done — next I'll fill in a few remaining details."}"
Then call update_session_data with "_meta": { "phase3_completed_chunks": [..., "chunk2a"] }. DO NOT advance phase yet — ${chunk2bHasContent ? "Part 2b (decisions) runs next." : "we advance to Phase 4 (the remaining questions) next."}`
  }

  if (!chunk2bDone) {
    // No decision content from the MBP — auto-complete and move on without
    // burning a chat turn.
    if (!chunk2bHasContent) {
      return `PHASE 3 — MBP REVIEW, PART 2b (Decisions) — NOTHING TO DECIDE

The MBP didn't surface any decisions for the client to confirm. Phase 3 is complete — immediately call update_session_data with "_meta": { "phase3_completed_chunks": [..., "chunk2b"] } and advancePhase: true to move to Phase 4 (gap-filling). No message to the user is necessary. Do NOT ask about team photos — those are pulled automatically from the client's site.`
    }

    if (mode === 'staff') {
      return `PHASE 3 — MBP REVIEW, PART 2b (Decisions) — staff mode
Present the analyst-authored decision blocks below as ONE message, grouped under their existing labels. Staff can answer in any layout (line-prefixed, key-value, comma list). Defaults: yes-to-all on opportunities and trust signals; build all proposed new pages; apply all consolidations as proposed.

When the staff member's answer lands, Phase 3 is complete — call update_session_data with the captured fields (any of _meta.opportunities_confirmed, _meta.trust_signals_confirmed, _meta.sitemap_decisions, plus any niches[i].subCategories status updates from chunk2a follow-up), "_meta": { "phase3_completed_chunks": [..., "chunk2b"] }, and advancePhase: true to move to Phase 4 (gap-filling). Do NOT ask about team photos — those are pulled automatically.${chunk2bAnalyst}${chunk2bOpportunities}${chunk2bTrustSignals}${chunk2bSitemap}`
    }
    return `PHASE 3 — MBP REVIEW, PART 2b (Decisions)
Open with a short bridge: "Before we wrap up this section, a few quick decisions our analyst flagged. Defaults are noted next to each — just call out exceptions."

Present the analyst-authored decision blocks below as ONE message, grouped under their existing labels. Keep each ask compact. Defaults: yes-to-all on opportunities and trust signals; build all proposed new pages; apply all consolidations as proposed. If the client agrees with the defaults wholesale, accept that and move on.

When the client's answer lands, Phase 3 is complete — call update_session_data with the captured fields (any of _meta.opportunities_confirmed, _meta.trust_signals_confirmed, _meta.sitemap_decisions), "_meta": { "phase3_completed_chunks": [..., "chunk2b"] }, and advancePhase: true to move to Phase 4 (gap-filling).${chunk2bAnalyst}${chunk2bOpportunities}${chunk2bTrustSignals}${chunk2bSitemap}`
  }

  // Team photos are NOT collected in the chat. High-confidence headshots are
  // auto-pulled from the client's live site at session start (lib/team-photos/
  // auto-pull.ts) and the rep fills any gaps via the session page's
  // TeamPhotoManager. Once the review chunks are done, Phase 3 is complete.
  return `PHASE 3 is complete — nothing else to collect here. Do NOT ask about team photos; they are pulled automatically from the client's site and managed on the session page. Immediately call update_session_data with advancePhase: true if you haven't already, then move into Phase 4.`
}

function phase4Instructions(session: Session, mode: AgentMode): string {
  const checklist = section11Block(readMeta(session))
  if (mode === 'staff') {
    return `PHASE 4 — GAP FILLING (staff mode)
Present every unresolved gap from the REMAINING GAPS section below as a single checklist in ONE message. Group by section heading:
- Firm background
- Clients
- Differentiators
- Culture
- Brand & Tone
- Per-niche pain points / value props (if listed)

Format example:
- business.foundingYear — Founding year:
- business.firmHistory — Firm history / origin:
- culture.missionVisionValues — Mission / vision / values:
- brand.primaryColors — Brand colors:
- ...

Accept the staff member's answer in any layout — line-prefixed, key-value, or a long prose dump. Parse it and call update_session_data with every captured field plus resolvedGaps for those gap field paths.

Tier 1 gaps MUST be answered before advancing (server-side enforced). If the staff member skips a Tier 1 item, ask for it again in a short follow-up. Tier 2 / Tier 3 may be skipped — for Tier 3, log into "_meta.phase4_flagged_for_followup".

When all Tier 1 gaps are resolved, call update_session_data with advancePhase: true. No closing pleasantry needed.${checklist}`
  }
  return `PHASE 4 — GAP FILLING
Only ask about items still in the gap list below. Anything already in COLLECTED DATA was seeded from the MBP — DO NOT re-ask. If you need light confirmation on a seeded value (e.g. firm history paragraph), do it inline within an unrelated batch, not as a standalone exchange.

Group remaining gaps into 2–3 per exchange by topic:
- Firm background (founding year, firm history if missing)
- Client questions (age ranges, how they find the firm, client needs)
- Differentiators and growth goals
- Culture (mission/values, team description)
- Client portals (see below)
- Pricing page (see below)
- Brand & Tone (see below — always last before the close)

- Tier 1: Always ask
- Tier 2: Ask unless clearly irrelevant to this firm
- Tier 3: Ask if it's relevant; otherwise add to "_meta.phase4_flagged_for_followup" for later follow-up
One natural follow-up per thin answer, then move on.

CLIENT PORTALS BLOCK — ask once, before Brand & Tone:
Ask: "Do your clients log into any outside tools or portals — QuickBooks Online, a secure file/document upload, payroll, online bill-pay, remote support? If so, what are they and where's the login link?"
For each one captured, write an entry to clientPortals[] with label, url, a short description, and a category (e.g. Documents, Payments, Support). These become the site's "Client Center" button. NEVER ask for or store portal passwords or credentials — links only; if a password comes up, decline and note it's handled through a secure channel.

PRICING PAGE BLOCK — ask once, after client portals:
Ask: "Would you like a pricing page on the new site? We can build a plans page with tiers and features, an interactive pricing calculator that estimates a monthly figure, both, or neither."
Capture the answer to business.pricingPagePreference as exactly one of: "plans", "calculator", "both", or "none". If they're already showing pricing on their current site, a plans page is usually the natural fit — offer that as the default. Don't collect prices here; the team drafts the actual numbers from the firm's fee notes in the next step.

BRAND & TONE BLOCK — ask this as the last topic, after differentiators and culture:
Ask in one exchange: "Before we wrap up, I want to capture a sense of your brand voice. How would clients describe your firm today — and how would you like them to feel after reading your new site?"
Then follow up: "Any words or phrases that feel very 'you'? Anything you'd want to avoid? And do you have existing brand colors or a style guide we should work within?"
If they say yes to a brand guide → tell them they can upload it in the next step.
Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives, brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide. If the client volunteers personality language ("we're more like a..."), capture it in brand.brandPersonality. If they offer a memorable phrase that captures their voice, capture it verbatim in brand.voiceExample.

Close Phase 4 with: "Is there anything else about the firm that's important for us to know?"
When all Tier 1 gaps are resolved and that question has been asked, call update_session_data with advancePhase: true.${checklist}`
}

function phase5Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 5 — ASSETS (staff mode)
Final step before the profile is done. In ONE compact message, ask the rep:
"Any files to add — logo, brand guide, or color palette? Upload them here, or add them later on the session page. (No need for team photos — those are pulled automatically from the client's site.)"

Use the upload button below; confirm each file by name as it lands. Don't push — a missing logo is fine (a styled wordmark is generated automatically at assembly).
As soon as files land OR the rep says there's nothing to add, call update_session_data with advancePhase: true and move straight to the close — don't ask whether they're ready.`
  }
  return `PHASE 5 — ASSETS

LOGO IS THE PRIORITY ASK — push for it specifically before moving to other assets:
"Your logo is the single most useful file you can give us — it goes in the top-left of every page on your new site. Do you have one as a file? PNG or SVG is ideal, JPG works too. Even a working draft is better than nothing."

If they say they don't have one, or don't have one handy: "Totally fine — we'll generate a styled wordmark using your firm name in your brand colors. You can swap in a real logo any time once we deliver the site." Do NOT push further; capture the answer and move on. The wordmark is generated automatically at deliverable assembly so the absence of an upload is graceful.

If they say they have one but don't have it on hand right now: encourage them to grab it ("if it's quick to find, now is the moment — otherwise we can swap it in later"). Don't block the session waiting for it.

After the logo conversation, move to other brand assets:
"What about a brand guide, color palette PDF, or any other style reference? Those help us match an existing visual identity if you have one."
(Don't ask for team headshots — those are pulled automatically from the client's site.)

Prompt for uploads via the button below. Confirm receipt of each file by name. If a client uploads a logo, acknowledge it by name explicitly so they know it landed ("Got it — drinks-logo.png saved as your primary logo.").

When done (or client confirms they have nothing more to upload), call update_session_data with advancePhase: true, then move straight into wrapping up — don't ask whether they're ready to continue.`
}

function phase6Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 6 — WRAP UP (staff mode)
Do NOT print a summary — the rep reviews the full profile on the session page, not in chat.
Immediately call update_session_data with advancePhase: true to finish. No message is necessary.`
  }
  return `PHASE 6 — WRAP UP
Present a concise summary of all collected data, organized by section.
Check the schema for any required fields still empty — ask about them before summarizing.
Ask: "Does everything look right? Anything to change before I submit?"
When confirmed, call update_session_data with advancePhase: true. After the advance, give the closing thank-you directly — do not ask the client to confirm they're ready to finish.`
}

function phase7Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 7 — COMPLETE (staff mode)
The onboarding profile is complete and the session is now marked ready. In one short message, tell the rep the profile is captured and point them to the session page to review it, upload any remaining files, and approve it for content generation. Do not collect any more information. Do not call update_session_data.`
  }
  return `PHASE 7 — COMPLETE
The onboarding is complete. Thank the client warmly and let them know the Revaltus team will be in touch shortly to begin the project.
Do not collect any more information. Do not call update_session_data.`
}
