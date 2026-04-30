# Step 14 — Testing & Hardening

**Depends on:** All previous steps (01–13)
**Unlocks:** Production launch
**Estimated time:** Day 21–22

---

## What This Step Accomplishes

Full end-to-end flow verified against a real MFP. Edge cases handled gracefully. Security checklist completed. Performance targets confirmed. This step is a systematic pass through everything built — not optional before launch.

---

## End-to-End Test Flow

Run this manually, in order, before declaring ready for production. Use the Korbey Lague MFP as the test fixture.

### Step 1 — Session creation
1. Log into admin dashboard at `https://onboard.countingfive.com/admin`
2. Click "New Session"
3. Upload `mfp-korbeylague-com-2026-04-24.md`
4. Verify parse preview shows correct firm name, team count, services count, gap count
5. Click "Create Session"
6. Copy the generated client URL

**Verify:**
```sql
SELECT id, website_url, status, current_phase, json_array_length(gap_list::json) as gaps
FROM sessions ORDER BY created_at DESC LIMIT 1;
```
Expected: `status = 'pending'`, `current_phase = 0`, `gaps > 0`.

### Step 2 — Client session (Phase 1)
7. Open the client URL in an incognito window (no admin session should bleed through)
8. Confirm the agent sends a greeting automatically
9. Provide contact info: first name, last name, email, phone
10. Confirm the URL when the agent presents it

**Verify:**
```sql
SELECT schema_data->'contact' FROM sessions WHERE id = 'SESSION_ID';
```
Expected: All 4 contact fields populated.

### Step 3 — WHOIS (Phase 2)
11. After URL is confirmed, the agent should say it's pulling technical info
12. Wait a moment — WHOIS runs automatically

**Verify:**
```sql
SELECT schema_data->'technical'->>'registrar' as registrar, current_phase
FROM sessions WHERE id = 'SESSION_ID';
```
Expected: `registrar` is non-empty, `current_phase = 3`.

### Step 4 — MFP Review (Phase 3)
13. Walk through Chunk 1: confirm locations, domain info, social channels, affiliations
14. Provide registrar username/PIN when asked
15. Walk through Chunk 2: confirm team members, services, choose a positioning option

**Verify:**
```sql
SELECT schema_data->'business'->>'positioningOption', current_phase
FROM sessions WHERE id = 'SESSION_ID';
```
Expected: Positioning option is set, `current_phase = 4`.

### Step 5 — Gap filling (Phase 4)
16. Answer all Tier 1 gap questions (founding year, firm history, mission/values, differentiators, how clients find them, client needs, geographic scope, age ranges)
17. Answer Tier 2 questions if time permits
18. Close with "anything else?" — provide a response or say no

**Verify:**
```sql
SELECT jsonb_array_elements(gap_list) FROM sessions WHERE id = 'SESSION_ID';
```
Expected: All Tier 1 gaps have `"resolved": true`.

### Step 6 — Assets (Phase 5)
19. When prompted, state which team members have headshots
20. Say whether office photos are available
21. Upload 1 test file (a small PNG logo)
22. Confirm the agent acknowledges the upload

**Verify:**
```sql
SELECT file_name, mime_type, asset_category FROM assets WHERE session_id = 'SESSION_ID';
```
Expected: One asset row exists.

### Step 7 — Final summary (Phase 6)
23. The agent presents the full data summary
24. Confirm everything looks right
25. Session advances to Phase 7

**Verify:**
```sql
SELECT status, current_phase, completed_at FROM sessions WHERE id = 'SESSION_ID';
```
Expected: `status = 'completed'`, `current_phase = 7`, `completed_at` is set.

### Step 8 — Admin approval
26. Back in the admin dashboard, find the session
27. Click into the session detail
28. Review the schema data and chat transcript
29. Edit one field inline to test the admin override
30. Click "Approve"

**Verify:**
- PDF generated and downloadable from admin dashboard
- Basecamp project created with correct name
- Intake summary message posted to Basecamp message board
- PDF attached to Basecamp message
- Asset file attached to Basecamp message
```sql
SELECT status, approved_at, basecamp_project_id, content_generation_ready
FROM sessions WHERE id = 'SESSION_ID';
```
Expected: All fields populated.

### Step 9 — Completion screen
31. Return to the client URL in the incognito window
Expected: Shows "You're all set!" completion screen, not the chat interface.

### Step 10 — Inactivity reminder
32. Manually set `last_activity_at` for a *different* test session to 4 days ago
```sql
UPDATE sessions SET last_activity_at = NOW() - INTERVAL '4 days'
WHERE id = 'OTHER_TEST_SESSION_ID';
```
33. Call the cron route manually:
```bash
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
Expected: Reminder email received by admin (and client if email was collected).

---

## Security Checklist

Run each of these before going live.

### S1 — Service role key not in client code
```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app --include="*.tsx" --include="*.ts"
```
Expected: Zero results.

### S2 — Admin routes return 401/403 on auth failure
```bash
curl https://onboard.countingfive.com/admin/dashboard
# Should return 302 to /admin/login — not 200
curl https://onboard.countingfive.com/api/sessions -X POST
# Should return 401 or 403 if no admin session
```

### S3 — Cron routes reject unauthorized requests
```bash
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity
# Expected: 401
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity \
  -H "Authorization: Bearer wrong_secret"
# Expected: 401
```

### S4 — File upload validates by magic bytes
Upload a file renamed to `.jpg` but with `.exe` binary content.
Expected: Confirm route rejects with 400, file deleted from storage.

### S5 — Session IDs are UUID v4 (not guessable)
```sql
SELECT id FROM sessions ORDER BY created_at DESC LIMIT 5;
```
Expected: All IDs are UUID v4 format (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`). No sequential integers.

### S6 — Signups are disabled
```bash
# In browser console on the login page:
const { error } = await supabase.auth.signUp({ email: 'hacker@test.com', password: 'password123' })
console.log(error?.message)
# Expected: "Signups not allowed for this instance"
```

### S7 — Basecamp tokens stored in DB, not env vars
```bash
grep -r "BASECAMP_ACCESS_TOKEN" . --include="*.ts" --include="*.tsx"
# Expected: No results (tokens are only in the DB, not env vars)
```

### S8 — Admin rate limiting is active
Supabase Auth applies rate limiting to login attempts by default. Verify no custom login logic bypasses it.

---

## Performance Checklist

### P1 — Token usage per exchange is within budget
Check Vercel Function logs for `[tokens]` lines. No exchange should exceed 5,000 input tokens. Investigate any that do.

### P2 — Session list is paginated
In the admin dashboard, verify sessions are paginated (not loading all at once). With 50+ sessions, the page should still load in < 2 seconds.

### P3 — Message history is trimmed
Check the `[messages]` log lines. After 20 messages in a session, `trimmed` should always be 20 regardless of total.

### P4 — Full conversation completes in 5–7 minutes
Time a complete walkthrough from Phase 1 to Phase 6 confirmation. If it exceeds 7 minutes, identify which phase ran long and review the phase instructions.

---

## Error Handling Checklist

### E1 — Claude API failure shows friendly error
Temporarily set `ANTHROPIC_API_KEY` to an invalid value. Send a message in a test session.
Expected: User sees a "Something went wrong — please try again" message. No raw error exposed. `processing` flag is cleared. Message history is preserved.

### E2 — WHOIS failure does not block the session
Temporarily use an invalid domain. Verify the session still advances to Phase 3 with empty `technical.*` fields.

### E3 — File upload failure shows retry option
Upload a malformed file. Verify the chat UI shows an error and the upload button is still available for retry. Chat state does not advance as if the upload succeeded.

### E4 — Basecamp API failure blocks approval
Temporarily revoke the Basecamp token. Click Approve.
Expected: Admin sees an error message with retry option. Session is NOT marked as approved. Session status remains `completed`.

### E5 — PDF failure blocks approval
Add a deliberate throw to `generateIntakePdf`. Click Approve.
Expected: Admin sees an error. Session not marked approved.

---

## Pre-Launch Final Checklist

- [ ] All env vars set in Vercel (not just `.env.local`)
- [ ] Supabase RLS enabled on all tables (rerun S1-S7 above)
- [ ] Supabase Auth signups disabled
- [ ] Storage bucket `session-assets` created, private
- [ ] DNS `CNAME onboard` propagated, SSL active
- [ ] Basecamp OAuth app registered with correct redirect URI
- [ ] Basecamp connected in admin dashboard (OAuth completed)
- [ ] Resend domain verified, from-address matches
- [ ] Vercel Cron configured in `vercel.json` and visible in Vercel dashboard
- [ ] `CRON_SECRET` set in Vercel env vars
- [ ] First admin user created in Supabase Auth + `admins` table
- [ ] MFP parser unit-tested against Korbey Lague MFP
- [ ] Full end-to-end flow completed successfully at least once
- [ ] All security checklist items passed
- [ ] All performance targets met
- [ ] All error scenarios tested and handled gracefully
