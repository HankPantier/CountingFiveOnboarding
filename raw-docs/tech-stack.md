# Tech Stack Reference

**Project:** CountingFive AI Onboarding Agent
**Updated:** 2026-04-30
**Deployment target:** `onboard.countingfive.com`

---

## Stack Overview

| Layer | Choice | Version / Notes |
|---|---|---|
| **Framework** | Next.js (App Router) | v15 — server components, streaming API routes |
| **Language** | TypeScript | Strict mode throughout |
| **Hosting** | Vercel | Free Hobby or Pro — zero-config Next.js deploys |
| **Database** | Supabase (Postgres) | Existing account — sessions, messages, assets, reminders |
| **File Storage** | Supabase Storage | Logo, headshot, photo uploads — separate bucket |
| **Admin Auth** | Supabase Auth | Email + password — admin-only; clients use UUID URL |
| **AI** | Vercel AI SDK + Anthropic | `ai` + `@ai-sdk/anthropic` — streaming built in |
| **Email** | Resend | Inactivity reminders + admin notifications |
| **Cron** | Vercel Cron Jobs | Scheduled daily inactivity check |
| **Basecamp** | Basecamp 4 API (OAuth 2.0) | Admin-triggered project creation + message board |
| **PDF** | `@react-pdf/renderer` | Server-side PDF from session schema |
| **UI** | Tailwind CSS + shadcn/ui | Component library for both admin and client UI |
| **WHOIS** | `whoiser` | Domain lookup for registrar/expiry data |

---

## Environment Variables

All variables live in Vercel's environment settings and a local `.env.local` for development.

### Supabase
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # server-side only — never expose to client
```

### Anthropic
```
ANTHROPIC_API_KEY=
```

### Resend
```
RESEND_API_KEY=
RESEND_FROM_EMAIL=onboarding@countingfive.com
```

### Basecamp
```
BASECAMP_CLIENT_ID=
BASECAMP_CLIENT_SECRET=
BASECAMP_REDIRECT_URI=https://onboard.countingfive.com/api/basecamp/callback
BASECAMP_ACCOUNT_ID=
BASECAMP_ACCESS_TOKEN=             # stored in DB after OAuth, not env
BASECAMP_REFRESH_TOKEN=            # stored in DB after OAuth, not env
```

### App
```
NEXT_PUBLIC_APP_URL=https://onboard.countingfive.com
CRON_SECRET=                       # random string — validates Vercel cron requests
```

---

## External Services & Accounts

| Service | Purpose | Cost | When needed |
|---|---|---|---|
| **Vercel** | Hosting + cron + deploys | Free / $20/mo Pro | Phase 1 |
| **Supabase** | DB + auth + file storage | Free tier | Phase 1 |
| **Anthropic** | Claude API | Pay-per-use | Phase 5 |
| **Resend** | Transactional email | Free (3k/mo) | Phase 9 |
| **Basecamp** | Project management integration | Existing account | Phase 10 |
| **GitHub** | Version control + Vercel deploy hook | Free | Phase 1 |

---

## Subdomain Setup (one-time DNS)

In your DNS provider (wherever `countingfive.com` is managed):

```
Type:  CNAME
Name:  onboard
Value: cname.vercel-dns.com
```

Then add `onboard.countingfive.com` as a custom domain in the Vercel project settings. Vercel provisions SSL automatically.

---

## Project Structure

```
/
├── app/
│   ├── (admin)/              # Admin routes — protected by middleware
│   │   ├── login/
│   │   ├── dashboard/
│   │   └── sessions/[id]/
│   ├── session/[id]/         # Client-facing chat — auth via UUID only
│   └── api/
│       ├── chat/             # Claude streaming endpoint
│       ├── sessions/         # Session CRUD
│       ├── upload/           # File uploads to Supabase Storage
│       ├── cron/             # Inactivity monitor (called by Vercel Cron)
│       └── basecamp/         # OAuth callback + project creation
├── components/
│   ├── chat/                 # Chat UI components
│   └── admin/                # Admin dashboard components
├── lib/
│   ├── supabase/             # Client + server Supabase instances
│   ├── mfp-parser/           # MFP .md → session schema
│   ├── agent/                # System prompt builder, phase logic
│   ├── basecamp/             # Basecamp API client
│   └── pdf/                  # PDF generation
└── types/
    └── database.ts           # Generated Supabase types
```

---

## Key Architectural Decisions

**Client access = UUID only.** The `/session/[uuid]` URL is the authentication token. No login required. All client API calls go through Next.js server-side routes using the Supabase service role key — the client has no direct Supabase access.

**Schema state lives in the database.** Every agent exchange updates `sessions.schema_data` (JSONB). Resuming a session = loading this JSON and the message history. No client-side state.

**Claude tool calling for data extraction.** Rather than a second extraction API call, Claude is given a `update_session_data` tool. It uses this tool to update schema fields during the natural conversation flow — structured and reliable.

**Streaming via Vercel AI SDK.** The `ai` package + `useChat` hook handles all stream parsing on the client. The `/api/chat` route uses `streamText` from the AI SDK — minimal boilerplate, maximum reliability.

**Basecamp is admin-triggered.** Nothing posts to Basecamp automatically. The admin reviews collected data, clicks Approve, and the system handles the rest.
