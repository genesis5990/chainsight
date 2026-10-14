'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

/** Signed-in email + sign-out, shown on protected pages. */
export function AuthBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user?.email ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!email) return null;
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-2 text-xs text-context-600 border-b border-context-200 bg-white">
      <span>{email}</span>
      <form action="/auth/signout" method="post">
        <button type="submit" className="text-context-700 hover:text-context-900 underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
