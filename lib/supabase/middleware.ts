import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // CRON_SECRET validation — defense in depth; individual routes also validate
  if (request.nextUrl.pathname.startsWith('/api/cron/')) {
    const secret = process.env.CRON_SECRET
    const authHeader = request.headers.get('Authorization')
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  // Refresh the session cookie (required by Supabase SSR)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Admin routes require an authenticated session
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/admin') &&
    !request.nextUrl.pathname.startsWith('/admin/login')
  ) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/admin/login'
    return NextResponse.redirect(loginUrl)
  }

  // /session/* routes are always public — no auth needed
  // No explicit check needed; the default NextResponse.next() handles it

  return supabaseResponse
}
