# Step 01 — Project Foundation & Setup

**Depends on:** Nothing — this is first.
**Unlocks:** All subsequent steps.
**Estimated time:** Day 1

---

## What This Step Accomplishes

A working Next.js 15 app scaffolded, deployed to Vercel, connected to Supabase, reachable at `onboard.countingfive.com`. No features yet — just the skeleton everything else builds on.

---

## Pre-Requisites: Accounts & Credentials

All of these must exist before writing a single line of code. Collect every credential before starting.

| Credential | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `NEXT_PUBLIC_APP_URL` | Will be `https://onboard.countingfive.com` |

Remaining credentials (Anthropic, Resend, Basecamp) are not needed yet — leave them as empty placeholders in `.env.example`.

---

## Implementation Tasks

### 1. Scaffold the app
```bash
npx create-next-app@latest onboarding-agent --typescript --tailwind --app
cd onboarding-agent
```

### 2. Install core dependencies
```bash
npm install @supabase/supabase-js @supabase/ssr
npm install ai @ai-sdk/anthropic
npm install zod
npm install resend react-email @react-email/components
npm install whoiser
npm install @react-pdf/renderer
```

### 3. Initialize shadcn/ui
```bash
npx shadcn@latest init
# Select: TypeScript, Default style, CSS variables
npx shadcn@latest add button input table badge
```

### 4. Create environment files

Create `.env.local` (never commit this):
```env
NEXT_PUBLIC_SUPABASE_URL=your_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
NEXT_PUBLIC_APP_URL=https://onboard.countingfive.com
ANTHROPIC_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
BASECAMP_CLIENT_ID=
BASECAMP_CLIENT_SECRET=
BASECAMP_ACCOUNT_ID=
CRON_SECRET=
```

Create `.env.example` (commit this — all keys, no values):
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
BASECAMP_CLIENT_ID=
BASECAMP_CLIENT_SECRET=
BASECAMP_ACCOUNT_ID=
CRON_SECRET=
```

### 5. Set up Supabase client helpers

`lib/supabase/client.ts` — browser client (uses anon key):
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

`lib/supabase/server.ts` — server client (uses service role key):
```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createServerClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

`lib/supabase/middleware.ts` — session refresh:
```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  // Follow Supabase SSR docs exactly for cookie handling
}
```

### 6. Create root middleware

`middleware.ts`:
```typescript
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

Route protection logic (add inside `updateSession`):
- `/admin/*` → redirect to `/admin/login` if no session
- `/session/*` → always allow through (no auth)
- `/api/cron/*` → validate `Authorization: Bearer {CRON_SECRET}` header

### 7. Create stub Vercel config

`vercel.json` at project root:
```json
{
  "crons": []
}
```

### 8. Push to GitHub and connect Vercel

```bash
git init
git add .
git commit -m "Initial scaffold"
git remote add origin https://github.com/YOUR_REPO
git push -u origin main
```

Then in Vercel: import the repo, add all environment variables under Settings → Environment Variables.

### 9. Configure DNS

In your DNS provider, add:
```
CNAME  onboard  →  cname.vercel-dns.com
```

Then in Vercel → Domains, add `onboard.countingfive.com`. Add DNS record on Day 1 — propagation can take up to 48 hours.

---

## Test Process

### T1 — Local dev server starts cleanly
```bash
npm run dev
```
Expected: Server starts at `localhost:3000` with no TypeScript or build errors.

### T2 — Supabase connection works
Create a temporary test file `app/api/test/route.ts`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('_test').select('*').limit(1)
  return Response.json({ connected: !error || error.code === 'PGRST116', error: error?.message })
}
```
Hit `GET /api/test` → should return `{ connected: true }` (table doesn't exist yet — the key is no auth error).
Delete this file after verifying.

### T3 — Vercel deployment succeeds
Push a commit → Vercel dashboard shows green deployment → `https://onboard.countingfive.com` returns the default Next.js page (or a blank page — not a 500 error).

### T4 — Environment variables are present on Vercel
After deployment, check Vercel Function logs for any "undefined" env var warnings. All four Phase 1 vars should be set.

### T5 — SSL is active
`https://onboard.countingfive.com` loads without certificate warning. May need to wait for DNS propagation.

### T6 — Service role key is not in client code
```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app --include="*.tsx" --include="*.ts"
```
Expected: Zero results. If any match, fix immediately.

---

## Common Failure Points

- **DNS propagation delay** — add the CNAME on day one, not when you're ready to launch. Check propagation at `dnschecker.org`.
- **SSR client vs. browser client confusion** — `createBrowserClient` goes in components, `createServerClient` goes in API routes and server components only. Mixing them causes hydration errors or credential exposure.
- **Service role key in client components** — the anon key is safe in browser code. The service role key is not. Always check with the grep above before pushing.
- **Missing `.env.example`** — commit it. Future-you (or a second developer) will thank you.
