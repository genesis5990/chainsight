'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';

type Mode = 'signin' | 'signup';

/** Only allow same-origin relative paths as post-login destinations. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/agency';
  return raw;
}

export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const callbackError = params.get('error');

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(callbackError);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (err) throw err;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setNotice('Check your email for a confirmation link, then sign in.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm border border-context-300 bg-white rounded-lg p-6 shadow-sm space-y-4"
      >
        <div>
          <h1 className="text-xl font-semibold text-context-900">ChainSight</h1>
          <p className="text-sm text-context-500">
            {mode === 'signin'
              ? 'Sign in to your agency workspace.'
              : 'Create an investigator account.'}
          </p>
        </div>

        <label className="block text-sm">
          <span className="text-context-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-context-300 rounded px-2 py-1.5"
          />
        </label>

        <label className="block text-sm">
          <span className="text-context-700">Password</span>
          <input
            type="password"
            required
            minLength={12}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-context-300 rounded px-2 py-1.5"
          />
          {mode === 'signup' && (
            <span className="text-xs text-context-500">At least 12 characters.</span>
          )}
        </label>

        {error && (
          <p
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5"
          >
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-700 text-white text-sm font-medium py-2 disabled:opacity-60"
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setNotice(null);
          }}
          className="w-full text-xs text-context-600 hover:text-context-900"
        >
          {mode === 'signin' ? 'Need an account? Create one' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}
