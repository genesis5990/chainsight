/**
 * Email-confirmation landing. Supabase redirects here with ?code=… (PKCE);
 * we exchange it for a session cookie and continue to ?next.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const rawNext = url.searchParams.get('next');
  const next =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/agency';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(
    new URL(
      `/login?error=${encodeURIComponent('Confirmation link is invalid or expired')}`,
      url.origin,
    ),
  );
}
