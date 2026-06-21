/**
 * Single source of truth for the live API base URL. In development we read
 * NEXT_PUBLIC_API_BASE_URL; defaults to the deployed dev API. The web app
 * never reads service-role keys — every call carries the user's Supabase JWT.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ??
  'https://chainsight-api-dev.fly.dev';
