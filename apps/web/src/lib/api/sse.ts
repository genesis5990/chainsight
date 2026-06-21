/**
 * useSSE — connects to /v1/events/case/:id and emits parsed JSON events.
 *
 * Authentication: EventSource cannot set arbitrary headers, so we attach the
 * Supabase JWT as a `?access_token=` query param. The API route accepts the
 * token via that mechanism for SSE.
 *
 * Re-connect on errors with exponential backoff. Caller passes onEvent +
 * optional onError; the hook keeps the connection alive while the component
 * is mounted.
 */

'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '../supabase/client';
import { API_BASE_URL } from './config';

export type SSEHandler<T> = (event: { kind: string; case_seq?: number; data: T }) => void;

export interface UseSSEOptions<T> {
  enabled?: boolean;
  onEvent: SSEHandler<T>;
  onError?: (err: Event) => void;
}

export function useSSE<T = unknown>(case_id: string | null, opts: UseSSEOptions<T>): void {
  const ref = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!case_id || opts.enabled === false) return;

    let stopped = false;
    let backoff = 1000;

    const connect = async () => {
      if (stopped) return;
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const url = new URL(`${API_BASE_URL}/v1/events/case/${case_id}`);
      if (token) url.searchParams.set('access_token', token);

      const es = new EventSource(url.toString(), { withCredentials: false });
      ref.current = es;

      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          opts.onEvent(parsed);
          backoff = 1000; // reset
        } catch {
          // ignore malformed frames
        }
      };
      es.onerror = (e) => {
        opts.onError?.(e);
        es.close();
        if (!stopped) {
          setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30_000);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      ref.current?.close();
      ref.current = null;
    };
  }, [case_id, opts.enabled, opts.onEvent, opts.onError]);
}
