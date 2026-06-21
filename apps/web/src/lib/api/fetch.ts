/**
 * Auth-aware fetch helper for the live ChainSight API.
 *
 * - Reads the Supabase session client-side (server pages should use the
 *   server helper at lib/supabase/server.ts and pass the token explicitly).
 * - Attaches Authorization: Bearer <jwt> if available.
 * - Surfaces structured API errors as ApiError so React Query / hooks can
 *   render verdict chips ("auth required", "no install", etc) without parsing
 *   message strings.
 */

import { createClient } from '../supabase/client';
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Skip the auth attach (used for /v1/health probes). */
  skipAuth?: boolean;
  /** Provide a JWT explicitly (server-side). */
  token?: string | null;
}

async function bearerToken(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  if (!init.skipAuth) {
    const token = init.token ?? (await bearerToken());
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    let detail: unknown = null;
    try { detail = await res.json(); } catch { /* swallow */ }
    const message = (detail as { error?: string; detail?: string } | null)?.error
      ?? (detail as { detail?: string } | null)?.detail
      ?? `HTTP ${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status, detail);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/** Build a signed-URL-respecting absolute API path for SSE. */
export function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
}
