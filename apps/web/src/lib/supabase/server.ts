/**
 * Server-side Supabase client for Next.js App Router (RSC + Route Handlers).
 *
 * See: frontend_architecture.md §1.4
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (
          cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
        ) => {
          try {
            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }: {
                name: string;
                value: string;
                options?: Record<string, unknown>;
              }) => {
                cookieStore.set(name, value, options);
              },
            );
          } catch {
            // The `setAll` method was called from a Server Component. Server Components
            // cannot set cookies; this is fine because middleware refreshes the session.
          }
        },
      },
    },
  );
}
