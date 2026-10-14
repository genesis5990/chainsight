import type { NextRequest } from 'next/server';

/**
 * Public origin for building redirects in route handlers.
 *
 * Behind Fly's proxy, `request.url` reflects the bind address
 * (http://0.0.0.0:3000), not the host the browser used. Prefer the
 * forwarded host/proto headers, then the Host header.
 */
export function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host');
  if (!host) return request.nextUrl.origin;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const proto = forwardedProto || (isLocal ? 'http' : 'https');
  return `${proto}://${host}`;
}
