import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // /dev-ui is an auth-free layout fixture (mock data only) used to
  // reproduce and measure UI issues in a plain browser.
  if (request.nextUrl.pathname.startsWith('/dev-ui')) {
    return supabaseResponse
  }

  // Redirect unauthenticated users to /auth
  if (!user && !request.nextUrl.pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    const redirectResponse = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  // Redirect authenticated users away from /auth
  if (user && request.nextUrl.pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone()
    url.pathname = '/reader'
    const redirectResponse = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  return supabaseResponse
}

export const config = {
  // Browsers fetch manifest.json and icons without cookies (even same-origin),
  // so routing them through auth makes the proxy 307 them to /auth — Chrome
  // gets an HTML login page where it expects JSON/PNG and fails PWA
  // installability entirely. Exclude static/manifest assets from the gate.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|api|manifest\\.json|icons/|.*\\.(?:png|svg|ico|webmanifest)$).*)',
  ],
}
