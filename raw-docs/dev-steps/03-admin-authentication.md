# Step 03 — Admin Authentication

**Depends on:** Steps 01–02
**Unlocks:** Steps 04, 08 (admin dashboard)
**Estimated time:** Day 2

---

## What This Step Accomplishes

Admin login page working. All `/admin` routes protected by middleware. First admin user created manually in Supabase. No self-signup is possible — admin accounts are invitation-only.

---

## Implementation Tasks

### 1. Configure Supabase Auth settings

In Supabase → Authentication → Providers:
- Enable **Email** provider
- Disable all other providers (Google, GitHub, etc.) for now

In Supabase → Authentication → Settings:
- **Disable email confirmation** — admins are created manually, not via self-signup flow
- **Disable user signups** — toggle "Disable signups" to ON. Without this, anyone who finds the login URL could register.

### 2. Build the login page

`app/(admin)/login/page.tsx`:
```typescript
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/admin/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Admin Login</h1>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="w-full border rounded px-3 py-2"
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          required
          className="w-full border rounded px-3 py-2"
        />
        <button type="submit" disabled={loading} className="w-full bg-black text-white py-2 rounded">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
```

### 3. Update middleware route protection

Update `lib/supabase/middleware.ts` to enforce route protection:
```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Protect /admin routes (except /admin/login)
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    if (!user) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/admin/login'
      return NextResponse.redirect(loginUrl)
    }
  }

  // Protect /api/cron routes with CRON_SECRET
  if (pathname.startsWith('/api/cron')) {
    const authHeader = request.headers.get('authorization')
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`
    if (authHeader !== expectedToken) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  // /session/* routes: always allow through — no auth required
  return supabaseResponse
}
```

### 4. Build admin logout

`app/(admin)/dashboard/actions.ts` (server action):
```typescript
'use server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signOut() {
  const supabase = createServerClient()
  await supabase.auth.signOut()
  redirect('/admin/login')
}
```

Add a logout button to the dashboard layout that calls this action.

### 5. Stub the dashboard page

`app/(admin)/dashboard/page.tsx`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
      <p className="text-gray-500 mt-2">Signed in as {user.email}</p>
      {/* Session list goes here in Step 08 */}
    </div>
  )
}
```

### 6. Create the first admin user

In Supabase → Authentication → Users → Add User:
- Enter email and password for the admin
- Do NOT use "Send invite" — create directly

Then in Supabase → SQL Editor, insert the matching admin record:
```sql
INSERT INTO admins (id, name, email)
SELECT id, 'Hank Pantier', 'webhank@gmail.com'
FROM auth.users
WHERE email = 'webhank@gmail.com';
```

---

## Test Process

### T1 — Unauthenticated access to /admin redirects to login
Open `https://onboard.countingfive.com/admin/dashboard` in an incognito window.
Expected: Redirected to `/admin/login`.

### T2 — Login with valid credentials succeeds
On `/admin/login`, enter valid admin credentials.
Expected: Redirected to `/admin/dashboard`. Dashboard shows signed-in email.

### T3 — Login with invalid credentials shows error
Enter wrong password.
Expected: Error message appears ("Invalid login credentials" or similar). No redirect.

### T4 — Session persists after page refresh
Log in, then refresh `/admin/dashboard`.
Expected: Still logged in, no redirect back to login.

### T5 — Logout clears session
Click the logout button.
Expected: Redirected to `/admin/login`. Navigating to `/admin/dashboard` redirects back to login.

### T6 — /session/* routes are accessible without auth
Open `https://onboard.countingfive.com/session/test-id` in incognito.
Expected: Page loads (even if it 404s on the session ID — the key is no redirect to admin login).

### T7 — /api/cron/* requires CRON_SECRET
```bash
# Should fail
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity
# Expected: 401

# Should pass (once route exists in Step 11)
curl -X POST https://onboard.countingfive.com/api/cron/check-inactivity \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expected: 200
```

### T8 — Signups are disabled
Attempt to create a new Supabase user via the client SDK:
```javascript
const { error } = await supabase.auth.signUp({ email: 'test@test.com', password: 'test1234' })
console.log(error?.message) // Expected: "Signups not allowed for this instance"
```

---

## Common Failure Points

- **Session tokens expiring silently** — the Supabase SSR pattern with `updateSession` in middleware refreshes tokens automatically. If you skip the middleware cookie handling, admins get randomly logged out. Follow the Supabase SSR docs exactly.
- **Signups still enabled** — double-check the Supabase dashboard after disabling. This is a critical security hole if left open.
- **First admin row missing from `admins` table** — the `auth.users` record alone is not enough. The `admins` table must also have a matching row or the admin dashboard will break in later steps when it queries `admins`.
- **`/admin/login` must not be protected** — the middleware should skip its auth check for `/admin/login` itself, or you'll create an infinite redirect loop.
