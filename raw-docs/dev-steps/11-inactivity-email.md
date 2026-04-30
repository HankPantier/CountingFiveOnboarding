# Step 11 — Inactivity Monitoring & Email

**Depends on:** Steps 02, 03
**Unlocks:** Nothing — standalone feature
**Credentials needed:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`
**Estimated time:** Day 16

---

## What This Step Accomplishes

If a session has no activity for 3 days, a reminder email is sent to both the admin and the client (if their email has been collected). Reminders continue until the session is completed. A Vercel Cron job runs the check daily at 2pm UTC.

---

## Implementation Tasks

### 1. Generate the CRON_SECRET

```bash
openssl rand -base64 32
```

Add to `.env.local` and Vercel environment variables:
```env
CRON_SECRET=your_generated_secret_here
```

### 2. Set up Resend

1. Create account at resend.com
2. Go to Domains → Add Domain → follow DNS verification steps for `countingfive.com`
3. Go to API Keys → Create API Key → add to `.env.local` and Vercel as `RESEND_API_KEY`
4. Set `RESEND_FROM_EMAIL=onboarding@countingfive.com` (must match verified domain)

### 3. Build the email templates

Install react-email dev server (optional, for previewing):
```bash
npm install -D @react-email/components react-email
```

`emails/ClientReminderEmail.tsx`:
```typescript
import { Html, Head, Body, Container, Heading, Text, Button, Hr } from '@react-email/components'

type Props = {
  clientName: string
  sessionUrl: string
  firmName: string
  daysInactive: number
}

export default function ClientReminderEmail({ clientName, sessionUrl, firmName, daysInactive }: Props) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f9f9f9', fontFamily: 'sans-serif' }}>
        <Container style={{ maxWidth: 600, margin: '40px auto', backgroundColor: '#fff', padding: 32, borderRadius: 8 }}>
          <Heading style={{ fontSize: 22, color: '#111' }}>
            Your website intake is waiting
          </Heading>
          <Text style={{ color: '#444' }}>
            Hi {clientName} — you started your website intake for <strong>{firmName}</strong> {daysInactive} days ago.
            Your progress is saved, and it should only take a few more minutes to finish.
          </Text>
          <Button
            href={sessionUrl}
            style={{ backgroundColor: '#000', color: '#fff', padding: '12px 24px', borderRadius: 6, display: 'inline-block', textDecoration: 'none' }}
          >
            Continue your intake →
          </Button>
          <Hr style={{ margin: '24px 0', borderColor: '#eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            This is an automated reminder from CountingFive. If you've already completed this, please disregard.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```

`emails/AdminReminderEmail.tsx`:
```typescript
import { Html, Head, Body, Container, Heading, Text, Button, Hr } from '@react-email/components'

type Props = {
  websiteUrl: string
  adminSessionUrl: string
  daysInactive: number
  sessionId: string
}

export default function AdminReminderEmail({ websiteUrl, adminSessionUrl, daysInactive, sessionId }: Props) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f9f9f9', fontFamily: 'sans-serif' }}>
        <Container style={{ maxWidth: 600, margin: '40px auto', backgroundColor: '#fff', padding: 32, borderRadius: 8 }}>
          <Heading style={{ fontSize: 20, color: '#111' }}>
            Inactive session — {websiteUrl}
          </Heading>
          <Text style={{ color: '#444' }}>
            The onboarding session for <strong>{websiteUrl}</strong> has been inactive for <strong>{daysInactive} days</strong>.
          </Text>
          <Text style={{ color: '#444' }}>Session ID: <code>{sessionId}</code></Text>
          <Button
            href={adminSessionUrl}
            style={{ backgroundColor: '#000', color: '#fff', padding: '12px 24px', borderRadius: 6, display: 'inline-block', textDecoration: 'none' }}
          >
            View session in admin →
          </Button>
          <Hr style={{ margin: '24px 0', borderColor: '#eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            A client reminder email has also been sent (if their email was collected).
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```

### 4. Build the inactivity check cron route

`app/api/cron/check-inactivity/route.ts`:
```typescript
import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'
import { render } from '@react-email/render'
import ClientReminderEmail from '@/emails/ClientReminderEmail'
import AdminReminderEmail from '@/emails/AdminReminderEmail'
import { NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)
const INACTIVITY_THRESHOLD_DAYS = 3
const ADMIN_EMAIL = 'webhank@gmail.com'

export async function POST(req: Request) {
  // Validate CRON_SECRET (middleware handles this, but double-check)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Find inactive sessions
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - INACTIVITY_THRESHOLD_DAYS)

  const { data: inactiveSessions } = await supabase
    .from('sessions')
    .select('id, website_url, client_email, schema_data, reminder_count')
    .in('status', ['pending', 'in_progress'])
    .lt('last_activity_at', cutoffDate.toISOString())

  if (!inactiveSessions || inactiveSessions.length === 0) {
    return NextResponse.json({ checked: 0, reminded: 0 })
  }

  let reminded = 0

  for (const session of inactiveSessions) {
    try {
      const daysInactive = Math.floor(
        (Date.now() - new Date(session.last_activity_at ?? '').getTime()) / (1000 * 60 * 60 * 24)
      )

      const sessionUrl = `${process.env.NEXT_PUBLIC_APP_URL}/session/${session.id}`
      const adminSessionUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/sessions/${session.id}`
      const firmName = session.schema_data?.business?.name ?? session.website_url
      const clientName = session.schema_data?.contact?.firstName ?? 'there'

      // Send client email (only if email was collected)
      if (session.client_email) {
        const clientHtml = render(<ClientReminderEmail
          clientName={clientName}
          sessionUrl={sessionUrl}
          firmName={firmName}
          daysInactive={daysInactive}
        />)

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: session.client_email,
          subject: `Your website intake for ${firmName} is still waiting`,
          html: clientHtml,
        })
      }

      // Always send admin email
      const adminHtml = render(<AdminReminderEmail
        websiteUrl={session.website_url}
        adminSessionUrl={adminSessionUrl}
        daysInactive={daysInactive}
        sessionId={session.id}
      />)

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: ADMIN_EMAIL,
        subject: `[CountingFive] Inactive session — ${session.website_url} (${daysInactive} days)`,
        html: adminHtml,
      })

      // Record the reminder
      await supabase.from('reminders').insert({
        session_id: session.id,
        days_inactive: daysInactive,
      })

      await supabase.from('sessions')
        .update({ reminder_count: (session.reminder_count ?? 0) + 1 })
        .eq('id', session.id)

      reminded++
    } catch (err) {
      console.error(`[cron] Failed to send reminder for session ${session.id}:`, err)
    }
  }

  return NextResponse.json({ checked: inactiveSessions.length, reminded })
}
```

### 5. Configure Vercel Cron

Update `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/check-inactivity",
      "schedule": "0 14 * * *"
    }
  ]
}
```

This runs daily at 2pm UTC.

---

## Test Process

### T1 — Cron route rejects missing CRON_SECRET
```bash
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity
```
Expected: 401 Unauthorized.

### T2 — Cron route accepts valid CRON_SECRET
```bash
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
Expected: 200 with `{ checked: N, reminded: N }` JSON response.

### T3 — Manually trigger reminder for an inactive session
Create a test session, then manually set its `last_activity_at` to 4 days ago:
```sql
UPDATE sessions
SET last_activity_at = NOW() - INTERVAL '4 days'
WHERE id = 'YOUR_TEST_SESSION_ID';
```
Call the cron route. Check that:
1. A reminder row appears in the `reminders` table
2. `reminder_count` incremented on the session
3. Admin email received
4. Client email received (if `client_email` is set on the session)

### T4 — No email sent for approved sessions
Set a session to `status = 'approved'`, set `last_activity_at` to 4 days ago.
Call the cron route.
Expected: Session is excluded from the query, no reminder sent.

### T5 — Client email skipped when not collected
Create a session where `client_email` is null.
Call the cron route.
Expected: Admin email sent, but no client email (no error — just skipped).

### T6 — Resend domain verification works
Send a test email manually:
```typescript
const { data, error } = await resend.emails.send({
  from: 'onboarding@countingfive.com',
  to: 'webhank@gmail.com',
  subject: 'Test email from Resend',
  html: '<p>It works.</p>',
})
console.log(data, error)
```
Expected: Email arrives in inbox. No `error`.

### T7 — Vercel cron is listed in Vercel dashboard
After deploying with the updated `vercel.json`, go to Vercel → Deployments → Cron Jobs.
Expected: `/api/cron/check-inactivity` listed with the `0 14 * * *` schedule.

---

## Common Failure Points

- **Vercel Hobby cron limits** — Hobby plan supports cron jobs with a minimum 1-day interval. Our daily check fits within this. If you need more frequent checks later, upgrade to Vercel Pro.
- **CRON_SECRET not set** — without it, the route allows anyone to spam reminders. Always verify the environment variable is set in Vercel before deploying.
- **Duplicate reminders on the same day** — the cron fires once per day. If it sends a reminder on day 3 and the client doesn't respond, it sends again on day 4, 5, etc. This is intentional. The `reminders` table logs all sends for the admin to review.
- **React Email rendering** — make sure `render()` from `@react-email/render` returns an HTML string, not a React element. Pass the HTML string to `resend.emails.send()`.
- **Resend domain verification taking time** — DNS verification can take up to 48 hours. Set up the domain early and don't block deployment on it.
