# Agent Conversation Flow

**Updated:** 2026-04-30
**Change:** (1) Added missing schema fields from original intake form cross-reference: registrar credentials (username, PIN), and a separate administrative/technical contact. (2) Restructured Phase 3 from 6 sequential sub-sections into 2 consolidated chunks to meet the 5–7 minute session target. (3) Added batching rules and priority tiers to Phase 4.

---

## Session Time Target

**The full client conversation — Phases 1 through 6 — must complete in 5–7 minutes.**

This is achievable because the MFP pre-populates 70–80% of the data. The agent's job is not discovery — it's confirmation + targeted gap-filling. To stay in budget:

- **Present MFP data in bulk, not field-by-field.** The agent shows whole sections at once and asks "anything to correct?" rather than reading out each item.
- **Batch Phase 4 questions.** Each Phase 4 exchange should cover 2–3 related gaps, not one at a time.
- **Respect the priority tiers.** Tier 1 questions are asked no matter what. Tier 2 only if the session is under 5 minutes. Tier 3 is skippable — the agent flags them for follow-up instead of asking.
- **Avoid back-and-forth on individual details.** If a client gives a thin answer to a high-value question, the agent may probe once. If the answer is still thin, record it and move on — do not stall the session.

---

## Guardrail: Structured Data Schema

The agent maintains a JSON data object throughout the conversation. Every exchange updates it. The agent **cannot complete the session** until all required fields have been addressed (collected or explicitly skipped by the user).

```json
{
  "contact": {
    "firstName": "",
    "lastName": "",
    "email": "",
    "phone": ""
  },
  "websiteUrl": "",
  "technical": {
    "registrar": "",
    "registrationDate": "",
    "expiryDate": "",
    "nameservers": [],
    "registrarUsername": "",
    "registrarPin": "",
    "registrarPasswordNote": "share via secure channel — do not enter here",
    "adminContact": {
      "name": "",
      "phone": "",
      "email": ""
    },
    "hostingProvider": "",
    "hostingContact": "",
    "hostingPhone": "",
    "hostingEmail": "",
    "redirectDomains": [],
    "googleBusinessProfileUrl": ""
  },
  "locations": [
    {
      "name": "",
      "street": "",
      "line2": "",
      "city": "",
      "state": "",
      "zip": "",
      "phone": "",
      "fax": "",
      "email": "",
      "hours": {}
    }
  ],
  "team": [
    {
      "name": "",
      "title": "",
      "certifications": [],
      "bio": "",
      "specializations": []
    }
  ],
  "services": [
    {
      "name": "",
      "description": "",
      "offerings": []
    }
  ],
  "niches": [
    {
      "name": "",
      "description": "",
      "icp": ""
    }
  ],
  "business": {
    "name": "",
    "tagline": "",
    "positioningOption": "",
    "positioningStatement": "",
    "foundingYear": "",
    "firmHistory": "",
    "idealClients": [],
    "geographicScope": "",
    "clientAgeRanges": [],
    "customerNeeds": "",
    "customerDescription": "",
    "differentiators": "",
    "affiliations": [],
    "clientSuccessStories": [],
    "clientMixBreakdown": "",
    "howClientsFind": ""
  },
  "culture": {
    "missionVisionValues": "",
    "teamDescription": "",
    "socialMediaChannels": []
  },
  "assets": {
    "headshotsAvailable": [],
    "officePhotosAvailable": false,
    "testimonialsAvailable": [],
    "logosUploaded": [],
    "photosUploaded": []
  },
  "additional": {
    "otherDetails": "",
    "uploadedFiles": []
  }
}
```

---

## Phase 0: MFP Seed (agent setup — before first message to client)

**Goal:** Pre-populate the schema from the MFP file before the conversation begins. The agent enters the conversation already knowing most of what it would have had to discover from scratch.

**Agent actions:**

1. **Parse the MFP** provided at session initialization. Extract and map confirmed data to the schema:

| MFP Section | Schema Fields Populated |
|---|---|
| Section 1 — Firm Identity | `business.name`, `websiteUrl`, `locations[]` (address, phone, fax, email, hours) |
| Section 2 — Firm Narrative | `business.tagline`, `business.positioningStatement` (3 options held for Phase 3d) |
| Section 3 — Accreditations | `business.affiliations[]` (confirmed ones only; ❓ items flagged for verification) |
| Section 4 — Social & Digital | `culture.socialMediaChannels[]` (confirmed ones; ❓ items flagged for collection) |
| Section 5 — Who They Serve | `niches[]`, `business.idealClients[]`, `niches[].icp` |
| Section 6 — Services | `services[]` (name, description, offerings) |
| Section 7 — Team | `team[]` (name, title where known, certifications; ❓ titles flagged for collection) |

2. **Build a gap list** — all fields still empty or flagged ❓ after parsing. This drives Phase 4.

3. **Do not crawl the existing site.** The MFP was generated from a full site audit; re-crawling is redundant. Exception: WHOIS/technical lookup in Phase 2 (the MFP does not include registrar or nameserver data).

---

## Phase 1: Welcome & Identify

**Goal:** Collect the human's basic contact info and confirm the URL. Set expectations for the session.

**Agent says (warmly, briefly):**
> "Hi — I'm glad you're here. Before we dive in, I want to let you know that our team has already done some research on your firm. I'm going to walk you through what we've put together, confirm it's accurate, and ask about a handful of things we weren't able to find on our own. This should go pretty quickly — most of it is just confirming, not starting from scratch."

**Agent asks:**
1. Name (first + last) → `contact.firstName`, `contact.lastName`
2. Email → `contact.email`
3. Phone → `contact.phone`
4. Confirm URL: *"We have your website as [websiteUrl from MFP] — is that the site we're working with?"* → confirm or correct `websiteUrl`

**Data captured:** `contact.*`, `websiteUrl` confirmed

---

## Phase 2: Technical Lookup (agent works, user waits)

**Goal:** Collect domain and hosting technical data that the MFP doesn't include.

**Agent tells the user:**
> "Give me just a moment to pull some technical info on your domain..."

### Tools called:

| Tool | Data Extracted |
|---|---|
| **WHOIS lookup** | `technical.registrar`, `technical.registrationDate`, `technical.expiryDate`, `technical.nameservers` |

**Note:** Web crawl is **skipped** — the MFP has already captured site content. The agent proceeds directly to Phase 3 after the WHOIS lookup.

---

## Phase 3: MFP Review — Confirm What We Know

**Goal:** Present the MFP-seeded data for client confirmation. Present in two consolidated chunks — not six sequential sub-sections. The client should be able to scan each chunk and say "looks right" or call out specific corrections. This entire phase should take **2–3 exchanges and under 2 minutes.**

The agent leads with: *"Our team already did a full research pass on your firm. I'm going to show you what we found in two quick sections — just flag anything that's off, and we'll fix it as we go."*

---

### Chunk 1 — Practical Info (locations, technical, social, affiliations)

Present all of the following together in one formatted message:

**Office location(s):** name, address, phone, fax, email, hours for each location.
**Domain:** registrar, registration date, expiry date, nameservers (from WHOIS).
**Hosting:** provider name and contact (if known from MFP; otherwise leave blank and ask).
**Social channels:** all confirmed social media URLs/handles.
**Professional affiliations:** all confirmed memberships and certifications (✅ items only; ❓ items noted as "unconfirmed").

After presenting:
> *"Does all of that look right? Any corrections, additions, or missing locations?"*

Then ask together (bundle — do not make these separate exchanges):
- *"We have your domain registrar as [X]. Do you have the account username and PIN handy? For the password, please share that separately via a secure channel — don't enter it here."* → `technical.registrarUsername`, `technical.registrarPin`
- *"Is there a separate administrative or technical contact we should have on file — someone who handles IT or domain access?"* → `technical.adminContact`
- *"Any other domains that should redirect to the main site?"* → `technical.redirectDomains[]`
- *"Any affiliations we missed — Massachusetts Society of CPAs, chamber of commerce, BBB, local business awards?"* → `business.affiliations[]`
- *"For social — we saw Instagram and LinkedIn linked on your site. Do you have those handles or URLs?"* → `culture.socialMediaChannels[]`

---

### Chunk 2 — Content (team, services, niches, positioning)

Present all of the following together in one formatted message:

**Team:** each member with name, title (or ❓ if unknown), certifications, specializations.
**Services:** each service with name and brief description.
**Industries served:** each niche with ICP summary.

After presenting:
> *"Does the team and service list look complete? Anything to add, remove, or correct?"*

For team members flagged ❓ (missing title): ask for their title and a one-line role description in the same exchange.

Then present the three positioning options:
> *"We drafted three ways to position the firm — each leads with a different strength. Take a quick read and let me know which direction feels most like you, or if you'd like to blend elements."*

Present Option A, B, C (from MFP Section 2).

- Client selects → `business.positioningOption`, `business.positioningStatement`

---

## Phase 4: Fill the MFP Gaps

**Goal:** Collect everything the MFP couldn't surface. The agent works through the gap list, but not exhaustively — topics are tiered by priority. This phase should take **2–3 exchanges and under 3 minutes.**

**Batching rule:** Each exchange must cover 2–3 related gap questions. Never ask one question, wait, then ask another. Group by theme.

**Priority tiers:**
- **Tier 1 (always ask):** Firm history, differentiators in own words, culture/values, client age/geography/type (from original form), customer needs and how clients find them
- **Tier 2 (ask if under 5 min elapsed):** Advisory/CFO specifics, client success stories, PFS credential details
- **Tier 3 (skip if running long — flag for follow-up):** Competitive landscape, Google Business Profile, detailed client mix breakdown

---

### Exchange 1 — Firm Story + Culture (Tier 1, always ask)

Batch these together in one message:

- *"What year was the firm founded — or the predecessor firm, if it goes back further?"* → `business.foundingYear`
- *"Tell us a bit about the firm's origin and how it got to where it is today — even a few sentences. Our writers use this for the About page."* → `business.firmHistory`
- *"What are your firm's mission and values — what would you want a potential client to know about the people and culture here?"* → `culture.missionVisionValues`, `culture.teamDescription`

---

### Exchange 2 — Clients + Differentiators (Tier 1, always ask)

Batch these together:

- *"Who are your ideal clients? We have you serving contractors, nonprofits, and service businesses — is that the right picture? Any segments you're trying to grow or pull back from?"* → `business.idealClients[]`, `business.clientAgeRanges[]`, `business.geographicScope`
- *"What are the typical needs and concerns your clients bring to you?"* → `business.customerNeeds`
- *"In your own words — what sets you apart from other CPA firms in your area? What would a happy client say about you?"* → `business.differentiators`, `business.customerDescription`
- *"How do most new clients find you?"* → `business.howClientsFind`

---

### Exchange 3 — Advisory/CFO + Success Stories (Tier 2, ask if time allows)

- *"For your Advisory and Virtual CFO work — how many active clients do you have, and can you share one or two specific outcomes? Before-and-after situations, dollars found, decisions you helped a client make — even rough examples are great."* → `business.clientSuccessStories[]`
- *"Ron's PFS credential is a real differentiator — fewer than 8,000 CPAs hold it. Do you actively offer financial planning and wealth advisory services under that, or is it more of a direction you'd like to build toward?"*

---

### Tier 3 Topics (skip if running long — flag for follow-up)

If the session is approaching 6 minutes and Tier 1 and 2 are complete, skip these and log them as `_meta.flaggedForFollowup`. The admin will follow up separately.

**Competitive Landscape:**
- *"Are there any competitor names that come up when prospects are shopping around — anyone new in the Tyngsborough/Lowell area we should know about?"*

**Google Business Profile:**
- *"Do you have a Google Business Profile set up? If so, do you have the URL handy?"* → `technical.googleBusinessProfileUrl`

---

### Final wrap: Anything Else (always ask — takes 10 seconds)

After the tiered exchanges, always close Phase 4 with:
- *"Is there anything else about the firm that's important for us to know? Anything on the current site you definitely want to keep, or something you'd really like to change?"* → `additional.otherDetails`

---

**Key behavior throughout Phase 4:**
- Work through Tier 1 exchanges first, in order. Move to Tier 2 only when Tier 1 is done.
- If the user volunteers info that answers a future question, record it and skip that question.
- If new services, team members, niches, or locations come up, add them to the schema.
- One natural follow-up probe is allowed on a thin Tier 1 answer. After that, record what you have and move on — do not stall the session chasing detail.
- Tier 3 topics not reached: log them as `_meta.flaggedForFollowup` so the admin knows to collect them.

---

## Phase 5: Assets

**Goal:** Confirm what visual assets exist and collect uploads.

> "Almost done — let's talk about photos and logos."

- *"Which team members have current, professional headshots?"* → `assets.headshotsAvailable[]`
- *"Do you have exterior or interior office photos?"* → `assets.officePhotosAvailable`
- *"Can you provide 3–5 client testimonials, or would you be able to reach out to a few happy clients for quotes before we start writing?"* → `assets.testimonialsAvailable[]`
- *"Please upload your logo files here — ideally all formats you have, zipped together if possible. Any other photos you'd like included on the new site can go here too."* → `assets.logosUploaded[]`, `assets.photosUploaded[]`

Accept: jpg, gif, png, tif, pdf (up to 300MB)

Agent confirms receipt of each file.

---

## Phase 6: Final Summary & Confirmation

**Goal:** Present the complete collected dataset for final sign-off.

The agent presents a full summary organized by section:
1. Contact info
2. Locations (all)
3. Team members (all — confirmed data + new info collected)
4. Services & offerings (all)
5. Industry niches + ICP summaries
6. Positioning selection
7. Technical / domain info
8. Client & market info (mix, geographic scope, age ranges, how they find you)
9. Differentiators (in their own words)
10. Success stories
11. Firm history & story
12. Culture & values
13. Social media & affiliations
14. Google Business Profile status
15. Assets (headshots, photos, testimonials, uploads)
16. Additional details

**Guardrail check:** Before presenting, the agent reviews the schema for any required fields still empty. If found:
> *"I notice I still don't have [X]. Can you provide that, or should we skip it for now?"*

After presenting:
> *"Does everything look right? Anything you'd like to change or add before I submit?"*

User confirms.

---

## Phase 7: Submission & Basecamp Setup

**Goal:** Persist data + create Basecamp project.

Once the user confirms:
1. Save complete data object to database
2. Generate PDF summary from collected data
3. Save PDF to storage
4. Create Basecamp project (e.g., "Korbey Lague PLLP — Website Build")
5. Upload PDF as attachment → get `attachable_sgid`
6. Upload any client logos/photos as attachments
7. Post intake summary as rich-text message on project message board (with PDF attached via `<bc-attachment>`)
8. Add PDF + logos to project vault
9. Confirm to user:
   > *"All set! Your project has been created and our team will be in touch soon. Thanks for taking the time to go through this with us."*

---

## Guardrail Summary

| Guardrail | How It Works |
|---|---|
| **MFP seed** | Schema is pre-populated from the MFP before the conversation begins; the agent enters already knowing most answers. |
| **Structured schema** | Every data point maps to a field in the JSON schema. Agent tracks what's filled vs. empty. |
| **Confirmation-first** | MFP-seeded data is always presented for human confirmation before being accepted as final. |
| **Gap detection** | After Phase 3, agent checks which fields are still empty and only asks about those in Phase 4. |
| **Final validation** | Before submission, agent reviews the full schema and flags any remaining gaps. |
| **Incidental capture** | If the user mentions new info during any phase, agent records it in the appropriate schema field. |
| **Explicit skip** | Empty fields are only acceptable if the user explicitly says to skip them. |
| **No redundant crawl** | The MFP replaces Phase 2 web crawl; only a WHOIS lookup is run. |
