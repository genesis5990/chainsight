/**
 * Next.js middleware — refreshes Supabase Auth session on every request.
 *
 * See: frontend_architecture.md §1.4
 */
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Routes that call the live API and need a signed-in user. */
const PROTECTED_PREFIXES = ['/agency', '/cases'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
        ) => {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(
            ({
              name,
              value,
              options,
            }: {
              name: string;
              value: string;
              options?: Record<string, unknown>;
            }) => response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session, then gate the live (API-backed) surfaces. Demo
  // pages, the landing page and /login stay public.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
  if (isProtected && !user) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  if (path === '/login' && user) {
    const dest = request.nextUrl.clone();
    dest.pathname = '/agency';
    dest.search = '';
    return NextResponse.redirect(dest);
  }
  return response;
}

export const config = {
  matcher: [
    // Run on all paths except static assets and the favicon.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
