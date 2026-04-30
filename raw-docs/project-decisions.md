# Project Decisions & Requirements

**Updated:** 2026-03-09

---

## Concept

Convert the existing CountingFive website development questionnaire (Gravity Forms intake form) into an AI-powered conversational onboarding chat agent.

**Source form:** https://countingfive.com/website-development-questionnaire/
**Full form data:** See `website-development-questionnaire.md`

---

## Key Decisions

### Platform & Stack
- **App framework:** Next.js
- **AI provider:** Claude API (Anthropic)
- **Model:** Sonnet (claude-sonnet-4-6) — best balance of speed, cost, and tool-use capability for real-time chat

### Chat Flow
1. Chat starts by asking the human for their **name** and the **URL** they are looking to convert
2. Agent uses tools (WHOIS, web crawling) to **auto-discover** technical info: registrar, hosting, business address, social media channels, business description, etc.
3. Agent **presents findings** to the user for confirmation/edits/additions/deletions before proceeding
4. Agent conducts a **conversational interview** to collect remaining business info (ideal clients, niches, services, team culture, etc.)
5. Any incidental info that surfaces during the chat is captured too

### Authentication & Access
- **No login required** — clients receive a **unique link** (likely query string param, e.g., `?session=abc123`)
- Need a mechanism for generating and managing these unique URLs
- CountingFive team sends the link to the client

### Session Persistence
- **To be explored** — option for clients to leave and return to finish later

### Data That Will NOT Be Collected via Chat
- Domain registrar credentials (username/password/PIN) — security concern, handled separately

### Data Destination
- **Database** for archival of all collected data
- **Basecamp integration** — fully automated end-of-chat flow:
  1. Generate PDF summary of collected data
  2. Save PDF to database/storage for archival
  3. Create new Basecamp project for the client (via `POST /projects.json`)
  4. Post intake summary as rich-text message on project message board (via `POST /message_boards/{id}/messages.json`)
  5. Upload PDF + client logos/photos to project vault (via `POST /attachments.json` + `POST /vaults/{id}/uploads.json`)
  6. Attach the PDF to the intake message as well (via `<bc-attachment>` rich text embedding)
  - **Auth:** Basecamp uses OAuth 2.0 — one-time setup for CountingFive account, then app acts on their behalf
  - **API rate limit:** 50 requests per 10 seconds per IP (not a concern for this use case)
- **Admin dashboard** — CountingFive team needs visibility into in-progress and completed sessions

### File Uploads
- **Explore in-chat file upload** for logos and photos (within the agent chat UI)

### Auto-Discovery Tools Needed
- **WHOIS lookup** — determine domain registrar, registration dates, nameservers
- **Web crawling/scraping** — extract business address, phone, social media links, business description, team info from existing site
- **DNS lookup** — determine hosting provider from DNS records

### Vertical Focus
- Current form is accounting/CPA focused but the agent should be built flexibly
- Content/prompts can be tailored per client vertical
