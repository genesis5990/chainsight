/**
 * Centralized env validation. Fails fast on boot if anything required is missing.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().optional(), // for legacy JWT verification
  SUPABASE_JWKS_URL: z.string().url().optional(), // preferred path

  // Redis (Upstash or local)
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // KMS (AWS)
  AWS_REGION: z.string().default('us-east-2'),
  AWS_KMS_KEY_ID: z.string().optional(), // not needed in dev; required in prod

  // Math service
  MATH_SERVICE_URL: z.string().default('http://localhost:50051'),

  // Pack signing (Sigstore-style detached signatures)
  // PACK_SIGNER_ID: stable UUID for this deployment's signing identity.
  // PACK_SIGNER_PRIVATE_KEY_B64: base64-encoded PKCS#8 DER ed25519 private key.
  // PACK_SIGNER_PUBLIC_KEY_B64:  base64-encoded SPKI DER ed25519 public key.
  // If any are missing, packs are persisted unsigned and verifiers report 'unsigned'.
  PACK_SIGNER_ID: z.string().uuid().optional(),
  PACK_SIGNER_PRIVATE_KEY_B64: z.string().optional(),
  PACK_SIGNER_PUBLIC_KEY_B64: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
