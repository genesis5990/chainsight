# ChainSight v1.0 — Backend Architecture Design

> **Discipline:** Backend Architecture  
> **Author:** Backend Architecture Agent  
> **Reads:** v1.0 engineering doc, v0.2–v0.9 design pack  
> **Audience:** Solo developer implementing Phase 0–2; the AI agents co-building alongside them  
> **Status:** Deep-pass design. Code-adjacent. Honest about tradeoffs.

---

## Table of Contents

0. [Confirmed Phase 0 SaaS Blind Stack](#0-confirmed-phase-0-saas-blind-stack)
1. [Service Decomposition](#1-service-decomposition)
2. [API Contracts](#2-api-contracts)
3. [Message Schemas](#3-message-schemas)
4. [State Management Patterns](#4-state-management-patterns)
5. [Persistence Patterns](#5-persistence-patterns)
6. [Performance Targets and Capacity Planning](#6-performance-targets-and-capacity-planning)
7. [Error Handling and Retries](#7-error-handling-and-retries)
8. [Capability Router Internals](#8-capability-router-internals)
9. [Belief State Service Internals](#9-belief-state-service-internals)
10. [Phase 0 Implementation Plan](#10-phase-0-implementation-plan)
11. [Open Questions for this Discipline](#11-open-questions-for-this-discipline)

---

## 0. Confirmed Phase 0 SaaS Blind Stack

> **Status:** Locked. This section supersedes any earlier references to
> Docker-hosted Postgres, Clerk for auth, or generic "S3-compatible" storage for
> Phase 0 SaaS Blind. The On-Prem Sovereign stack is unchanged; see the delta
> column below.

---

### 0.1 Stack Table

| Concern                | Phase 0 — SaaS Blind                                                                          | On-Prem Sovereign (Phase 1+)                         | Phase 2 SOC 2 Migration                               |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| **Postgres**           | Supabase managed (AWS us-east-1, PgBouncer pooler in transaction mode)                        | Self-hosted Docker / K8s PostgreSQL 16               | AWS RDS PostgreSQL 16 (Multi-AZ)                      |
| **pgvector**           | Supabase managed (enabled in project settings)                                                | `pgvector` extension on self-hosted PG               | RDS with `pgvector` extension                         |
| **Row-Level Security** | Supabase RLS policies (first-class, see §0.2)                                                 | Same DDL — Postgres-portable                         | Same DDL — Postgres-portable                          |
| **Auth**               | Supabase Auth (PKCE flow, TOTP MFA, JWKS endpoint)                                            | Ory Kratos or Keycloak (JWKS-compatible)             | AWS Cognito or self-hosted Keycloak                   |
| **Object Storage**     | Supabase Storage (buckets: `case-documents`, `repro-packs`, `audit-exports`)                  | MinIO / Ceph / NFS (via `StorageBackend` interface)  | AWS S3 with Object Lock                               |
| **Realtime**           | Supabase Realtime — alerts + supervisor dashboard **only**                                    | Self-hosted Supabase Realtime or Redis pubsub bridge | Same as On-Prem                                       |
| **Secrets / KMS**      | Supabase Vault (pgsodium / libsodium)                                                         | HashiCorp Vault                                      | AWS KMS + re-encryption migration from Supabase Vault |
| **Queue / Cache L1**   | Upstash Redis (BullMQ + hot cache)                                                            | Self-hosted Redis or Upstash (configurable)          | Upstash or ElastiCache                                |
| **Application API**    | Fly.io — `chainsight-api` app (iad region)                                                    | Docker / K8s — same image                            | AWS ECS or EKS                                        |
| **Worker**             | Fly.io — `chainsight-worker` app (iad region)                                                 | Docker / K8s                                         | AWS ECS or EKS                                        |
| **Math Service**       | Fly.io — `chainsight-math` app (iad region)                                                   | Docker / K8s                                         | AWS ECS or EKS                                        |
| **Graph DB**           | Fly.io — `chainsight-memgraph` app + 10 GB volume (iad)                                       | Docker / K8s Memgraph                                | AWS EC2 or EKS                                        |
| **CI/CD**              | GitHub Actions (public runners Phase 0; self-hosted runners for sensitive workloads Phase 1+) | GitHub Actions self-hosted                           | GitHub Actions self-hosted                            |
| **Container Registry** | GitHub Container Registry (ghcr.io)                                                           | Self-hosted registry or GHCR                         | AWS ECR                                               |

---

### 0.2 Supabase Integration Map

Each Supabase service has a defined integration surface and a portability contract — the thing that must remain stable when On-Prem replaces Supabase with a self-hosted equivalent.

| Supabase Service | What ChainSight uses it for                                                                                               | Integration surface                                                                                      | Portability contract                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres**     | All persistent application data; pgvector embeddings; RLS-enforced multi-tenancy                                          | `DATABASE_URL` (PgBouncer transaction-mode pooler)                                                       | Any `postgres://` connection string. PgBouncer pooler URL in Phase 0; direct connection string in On-Prem.                                               |
| **Auth**         | Agency user sign-up/sign-in, TOTP MFA, JWT issuance, JWKS endpoint                                                        | `SUPABASE_AUTH_URL`, `SUPABASE_ANON_KEY`, JWKS at `{url}/auth/v1/.well-known/jwks.json`                  | `AUTH_PROVIDER=supabase\|kratos\|keycloak` env var + `AUTH_JWKS_URL` env var. The Fastify auth plugin is JWKS-generic.                                   |
| **Storage**      | Case document uploads, Reproducibility Pack ZIPs, audit export archives                                                   | `@supabase/storage-js` via `SupabaseStorageBackend` implementation of `StorageBackend` interface         | `STORAGE_BACKEND=supabase\|minio\|s3\|local_fs` env var. On-Prem swaps to `MinioStorageBackend`.                                                         |
| **Realtime**     | Deconfliction conflict alerts (§0.2a), Supervisor dashboard live feed (§0.2b) — **not** job progress, **not** canvas CRDT | `@supabase/realtime-js` subscribed to `postgres_changes` on `deconfliction_conflicts` and `cases` tables | `REALTIME_BACKEND=supabase\|redis_pubsub` env var. On-Prem uses Redis pubsub bridge for the same events.                                                 |
| **Vault**        | Per-case DEK encryption (G16: at-rest encryption mandate)                                                                 | `pgsodium.crypto_aead_det_encrypt()` and `vault.secrets` table via Supabase Vault extension              | `KmsClient` interface abstraction. On-Prem uses HashiCorp Vault. Phase 2 uses AWS KMS. DEK re-encryption is a prerequisite for KMS migration (see §0.5). |

**§0.2a — Deconfliction alert flow (Supabase Realtime):**

When a new `deconfliction_conflict` row is inserted (by the Deconfliction Engine worker job), Supabase Realtime broadcasts a `postgres_changes` event to all agency supervisors subscribed to that channel. The Next.js frontend subscribes via `@supabase/realtime-js`. This replaces a polling approach and gives sub-second alert delivery without additional WebSocket infrastructure.

**§0.2b — Supervisor dashboard live feed (Supabase Realtime):**

The supervisor dashboard (F22: Supervisor Mode) subscribes to `INSERT` and `UPDATE` events on the `cases` table filtered to `agency_id = :agencyId`. This drives real-time case status updates. Volume is low (< 50 case status changes per agency per day), making Supabase Realtime appropriate. Explicitly **not** using Supabase Realtime for: BullMQ job progress (stays Redis pubsub → SSE via Fastify), canvas CRDT sync (stays Yjs/WebSocket in Phase 2+).

---

### 0.3 Storage Backend Abstraction

The `StorageBackend` interface is the portability contract for all file operations. It is defined in `packages/shared-types` and implemented by two concrete classes: one for Supabase Storage (Phase 0 SaaS), one for MinIO (On-Prem / Phase 2 AWS S3 can reuse the MinIO-compatible S3 interface).

```typescript
// packages/shared-types/src/storage.ts

export interface StorageBackend {
  /**
   * Upload a file. Returns the canonical storage path (used as the
   * `storage_path` column in `case_documents`, `reproducibility_packs`, etc.)
   */
  upload(opts: {
    bucket: string;
    path: string;
    body: Buffer | ReadableStream;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ storagePath: string; sizeBytes: number }>;

  /** Generate a time-limited pre-signed download URL. */
  getSignedUrl(opts: { bucket: string; path: string; expiresInSeconds: number }): Promise<string>;

  /** Stream a file directly (used by the ReproPack builder to hash large ZIPs). */
  download(opts: { bucket: string; path: string }): Promise<ReadableStream>;

  /** Delete a file (only called during case purge; subject to audit). */
  delete(opts: { bucket: string; path: string }): Promise<void>;

  /** List files with a prefix (used by ReproPack collector). */
  list(opts: {
    bucket: string;
    prefix: string;
  }): Promise<Array<{ path: string; sizeBytes: number; lastModified: Date }>>;
}

// ─── Supabase Storage implementation (Phase 0 SaaS Blind) ───────────────────

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class SupabaseStorageBackend implements StorageBackend {
  private client: SupabaseClient;

  constructor(supabaseUrl: string, supabaseServiceRoleKey: string) {
    this.client = createClient(supabaseUrl, supabaseServiceRoleKey);
  }

  async upload(opts): Promise<{ storagePath: string; sizeBytes: number }> {
    const { data, error } = await this.client.storage
      .from(opts.bucket)
      .upload(opts.path, opts.body, {
        contentType: opts.contentType,
        metadata: opts.metadata,
        upsert: false, // never silently overwrite; caller must delete first
      });
    if (error) throw new StorageError(`upload failed: ${error.message}`, error);
    return {
      storagePath: data.path,
      sizeBytes: opts.body instanceof Buffer ? opts.body.length : -1,
    };
  }

  async getSignedUrl(opts): Promise<string> {
    const { data, error } = await this.client.storage
      .from(opts.bucket)
      .createSignedUrl(opts.path, opts.expiresInSeconds);
    if (error) throw new StorageError(`signed URL failed: ${error.message}`, error);
    return data.signedUrl;
  }

  async download(opts): Promise<ReadableStream> {
    const { data, error } = await this.client.storage.from(opts.bucket).download(opts.path);
    if (error) throw new StorageError(`download failed: ${error.message}`, error);
    return data.stream();
  }

  async delete(opts): Promise<void> {
    const { error } = await this.client.storage.from(opts.bucket).remove([opts.path]);
    if (error) throw new StorageError(`delete failed: ${error.message}`, error);
  }

  async list(opts) {
    const { data, error } = await this.client.storage.from(opts.bucket).list(opts.prefix);
    if (error) throw new StorageError(`list failed: ${error.message}`, error);
    return data.map((f) => ({
      path: `${opts.prefix}/${f.name}`,
      sizeBytes: f.metadata?.size ?? -1,
      lastModified: new Date(f.updated_at),
    }));
  }
}

// ─── MinIO implementation (On-Prem / AWS S3-compatible) ─────────────────────

import * as Minio from 'minio';

export class MinioStorageBackend implements StorageBackend {
  private client: Minio.Client;

  constructor(opts: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
  }) {
    this.client = new Minio.Client(opts);
  }

  async upload(opts): Promise<{ storagePath: string; sizeBytes: number }> {
    const metadata = { 'Content-Type': opts.contentType, ...opts.metadata };
    if (opts.body instanceof Buffer) {
      await this.client.putObject(opts.bucket, opts.path, opts.body, opts.body.length, metadata);
      return { storagePath: opts.path, sizeBytes: opts.body.length };
    }
    await this.client.putObject(opts.bucket, opts.path, opts.body as any, metadata as any);
    return { storagePath: opts.path, sizeBytes: -1 };
  }

  async getSignedUrl(opts): Promise<string> {
    return this.client.presignedGetObject(opts.bucket, opts.path, opts.expiresInSeconds);
  }

  async download(opts): Promise<ReadableStream> {
    const stream = await this.client.getObject(opts.bucket, opts.path);
    return stream as unknown as ReadableStream;
  }

  async delete(opts): Promise<void> {
    await this.client.removeObject(opts.bucket, opts.path);
  }

  async list(opts) {
    return new Promise<Array<{ path: string; sizeBytes: number; lastModified: Date }>>(
      (resolve, reject) => {
        const results: Array<{ path: string; sizeBytes: number; lastModified: Date }> = [];
        const stream = this.client.listObjectsV2(opts.bucket, opts.prefix, true);
        stream.on('data', (obj) =>
          results.push({ path: obj.name!, sizeBytes: obj.size, lastModified: obj.lastModified }),
        );
        stream.on('end', () => resolve(results));
        stream.on('error', reject);
      },
    );
  }
}
```

**Bucket structure (SaaS Blind Phase 0):**

| Bucket           | Path pattern                             | Contents                         |
| ---------------- | ---------------------------------------- | -------------------------------- |
| `case-documents` | `{agencyId}/{caseId}/{docId}/{filename}` | Uploaded case evidence files     |
| `repro-packs`    | `{agencyId}/{caseId}/{packId}.zip`       | Frozen Reproducibility Pack ZIPs |
| `audit-exports`  | `{agencyId}/{exportId}/{filename}`       | Court-ready audit log exports    |

All three buckets have RLS policies in Supabase Storage (bucket-level policies tied to `auth.uid()` → agency membership). Pre-signed URLs are used for all client downloads; no public buckets.

**Environment variable selection:**

```bash
# Phase 0 SaaS Blind
STORAGE_BACKEND=supabase
SUPABASE_URL=https://{project}.supabase.co
SUPABASE_SERVICE_ROLE_KEY={service_role_key}

# On-Prem Sovereign
STORAGE_BACKEND=minio
MINIO_ENDPOINT=minio.internal
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY={access_key}
MINIO_SECRET_KEY={secret_key}
```

The `storagePlugin` Fastify plugin resolves the correct implementation at startup and attaches it to `fastify.storage`. All handlers use `req.server.storage` — they never import a concrete class directly.

---

### 0.4 Auth Backend Abstraction

The Fastify auth plugin is JWKS-generic from Phase 0. Supabase Auth, Ory Kratos, and Keycloak all expose a JWKS endpoint; the only difference is the endpoint URL and the JWT claim structure.

```typescript
// apps/api/src/plugins/auth.ts

export interface AuthConfig {
  provider: 'supabase' | 'kratos' | 'keycloak';
  jwksUrl: string;
  /** JWT claim containing the user's stable ID. */
  uidClaim: string; // 'sub' for all three providers
  /** JWT claim containing the user's roles (optional; falls back to DB lookup). */
  rolesClaim?: string;
  /** Audience to validate. */
  audience?: string;
}

// Phase 0 SaaS Blind config (from env vars)
export const supabaseAuthConfig: AuthConfig = {
  provider: 'supabase',
  jwksUrl: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  uidClaim: 'sub',
  audience: process.env.SUPABASE_JWT_AUDIENCE ?? 'authenticated',
};

// On-Prem Sovereign config (from env vars)
export const kratosAuthConfig: AuthConfig = {
  provider: 'kratos',
  jwksUrl: `${process.env.KRATOS_URL}/.well-known/jwks.json`,
  uidClaim: 'sub',
};

// ─── The plugin itself ───────────────────────────────────────────────────────

import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const authPlugin = fp(async (fastify) => {
  const config = resolveAuthConfig(); // reads AUTH_PROVIDER env var
  const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

  fastify.decorate('verifyToken', async (token: string) => {
    const { payload } = await jwtVerify(token, JWKS, {
      audience: config.audience,
    });
    return {
      uid: payload[config.uidClaim] as string,
      claims: payload,
    };
  });

  fastify.addHook('onRequest', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return; // public routes handled elsewhere
    try {
      req.authUser = await fastify.verifyToken(auth.slice(7));
    } catch (err) {
      reply.code(401).send({ error: 'invalid_token' });
    }
  });
});

function resolveAuthConfig(): AuthConfig {
  const provider = process.env.AUTH_PROVIDER ?? 'supabase';
  switch (provider) {
    case 'supabase':
      return supabaseAuthConfig;
    case 'kratos':
      return kratosAuthConfig;
    default:
      throw new Error(`Unknown AUTH_PROVIDER: ${provider}`);
  }
}
```

**Key design decision:** `uid` maps to `users.auth_provider_uid` in the database (renamed from `clerk_user_id` in earlier drafts). The column is `TEXT UNIQUE NOT NULL` — provider-agnostic. The `auth_provider` column stores `'supabase' | 'kratos' | 'keycloak'` for the row's source.

**PKCE flow (Next.js ↔ Supabase Auth):**

```
Browser                     Next.js API Route             Supabase Auth
  │─── /auth/login ──────────────────────────────────────────▶│
  │                                                           │ Issues PKCE challenge
  │◀── Redirect to Supabase Auth UI ─────────────────────────│
  │─── User authenticates ──────────────────────────────────▶│
  │◀── Redirect to /auth/callback?code={code} ───────────────│
  │─── /auth/callback?code={code} ─────────────────────────▶│
  │                    │─── Exchange code for session ──────▶│
  │                    │◀── access_token + refresh_token ────│
  │                    │─── Set HttpOnly cookie ─────────────│
  │◀── Redirect to /dashboard ──────────────────────────────│
```

The Fastify API validates the `access_token` from the `Authorization: Bearer` header on every request. The Next.js frontend sends it from the cookie. TOTP MFA challenge is handled entirely in the Supabase Auth UI; the API sees only a fully authenticated JWT.

---

### 0.5 SOC 2 Migration Path: Supabase → AWS RDS + AWS KMS

Phase 2 requires SOC 2 Type II compliance (G22: deployment sovereignty). Supabase is an excellent managed service but does not satisfy the SOC 2 auditor requirement for "customer controls all infrastructure." The migration path is explicit and sequenced to minimize risk.

**Prerequisites before migration:**

- All `StorageBackend` callsites use the interface (no direct Supabase client imports in handlers) ✓ enforced by Phase 0 design
- All auth callsites use the JWKS plugin (no direct Supabase Auth imports) ✓ enforced by Phase 0 design
- All Supabase Vault (`pgsodium`) calls go through `KmsClient` interface ✓ enforced by Phase 0 design

**12-step migration procedure:**

1. **Provision AWS RDS PostgreSQL 16 Multi-AZ** in target region. Enable `pgvector` extension.
2. **Enable logical replication** on Supabase Postgres (already set: `wal_level = logical`). Create a replication slot.
3. **Run `pg_dump` → `pg_restore`** for initial schema + data load to RDS.
4. **Start logical replication stream** from Supabase → RDS to catch up live writes. Monitor replication lag.
5. **⚠️ DEK re-encryption (highest-risk step):** For every per-case DEK stored in Supabase Vault, decrypt via `pgsodium.crypto_aead_det_decrypt()`, re-encrypt via AWS KMS `GenerateDataKey`, store new ciphertext in AWS Secrets Manager or RDS with pgcrypto. This must happen while both databases are live. Estimated window: 2–4 hours for 10,000 cases; must be scripted and tested in staging first.
6. **Provision AWS Cognito** (or self-hosted Keycloak) as auth provider. Export Supabase Auth user records (email, metadata — passwords are hashed with bcrypt and are portable). Import into Cognito/Keycloak. Users will receive a password-reset email.
7. **Migrate Supabase Storage → AWS S3.** Use `rclone` to sync all three buckets. Enable S3 Object Lock on `audit-exports` bucket.
8. **Update environment variables** on all Fly.io apps: `DATABASE_URL` → RDS endpoint, `STORAGE_BACKEND=s3`, `AUTH_PROVIDER=cognito` (or `keycloak`), `KMS_PROVIDER=aws`.
9. **Blue/green cutover**: Deploy new app versions with RDS URLs. Route 5% of traffic. Monitor for 1 hour. Full cutover.
10. **Stop Supabase Realtime subscriptions**. Switch to Redis pubsub bridge or self-hosted Supabase Realtime for On-Prem parity.
11. **Audit log continuity check**: Verify `audit_log` hash chain is unbroken across the cutover boundary. The `audit.verifyChain` tRPC procedure must return `{ valid: true }` on the RDS database.
12. **Decommission Supabase project** after 30-day parallel run with zero issues.

**Risk flag on step 5 (DEK re-encryption):** This is the highest-risk operation in the entire platform lifecycle. A failed re-encryption means case data is permanently inaccessible (AES-256 GCM with a lost DEK is unrecoverable). Mitigation: (a) complete Supabase Vault backup before starting, (b) re-encrypt in batches of 100 cases with rollback capability, (c) verify each batch by decrypting a sample row with the new AWS KMS key before proceeding, (d) maintain a parallel Supabase Vault instance live for 30 days post-migration as a recovery backstop.

---

### 0.6 Fly.io Topology

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Fly.io Organization (iad region)                    │
│                                                                              │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐    │
│  │  chainsight-api  │   │ chainsight-worker │   │  chainsight-math     │    │
│  │  (Fastify)       │   │ (BullMQ workers) │   │  (Python / FastAPI)  │    │
│  │  fly.internal    │   │  fly.internal    │   │   fly.internal       │    │
│  │  :3000           │   │  :—              │   │   :8000              │    │
│  └────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘    │
│           │                      │                          │                │
│           └──────────────┬───────┘──────────────────────────┘                │
│                          │ .internal DNS (encrypted WireGuard mesh)           │
│                          │                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │               chainsight-memgraph (Fly.io volume: 10 GB)              │    │
│  │               fly.internal:7687 (Bolt protocol)                       │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
         │                              │                       │
         ▼                              ▼                       ▼
┌──────────────────┐       ┌────────────────────┐   ┌──────────────────────┐
│   Supabase       │       │   Upstash Redis     │   │   GitHub             │
│   (AWS us-east-1)│       │   (BullMQ + cache)  │   │   (source + GHCR)   │
│                  │       │   upstash.io (iad)  │   │                      │
│  • Postgres      │       │                    │   │  GitHub Actions CI   │
│  • Auth          │       │  UPSTASH_REDIS_URL  │   │  → ghcr.io images   │
│  • Storage       │       │  (TLS, REST API)    │   │  → fly deploy        │
│  • Realtime      │       │                    │   │                      │
│  • Vault         │       └────────────────────┘   └──────────────────────┘
└──────────────────┘

Inter-service communication:
  API   → Worker:        BullMQ jobs via Upstash Redis
  API   → Math:          HTTP/REST (Phase 0); gRPC Phase 1+ (fly.internal:8000)
  API   → Memgraph:      Bolt (fly.internal:7687)
  Worker → Math:         HTTP/REST (fly.internal:8000)
  Worker → Memgraph:     Bolt (fly.internal:7687)
  Worker → Supabase:     HTTPS (direct; Supabase is external to Fly)
  All   → Upstash Redis: HTTPS REST API (external; Upstash is not on Fly network)
```

**Fly.io app configuration highlights:**

```toml
# fly.toml for chainsight-api
[build]
  image = "ghcr.io/chainsight/api:${FLY_IMAGE_TAG}"

[env]
  PORT           = "3000"
  NODE_ENV       = "production"
  AUTH_PROVIDER  = "supabase"
  STORAGE_BACKEND = "supabase"

[[services]]
  internal_port = 3000
  protocol      = "tcp"

  [[services.ports]]
    port     = 443
    handlers = ["tls", "http"]

[mounts]
  # No persistent volume on API — stateless
```

```toml
# fly.toml for chainsight-memgraph
[env]
  MEMGRAPH_USER     = "memgraph"
  MEMGRAPH_DATA_DIR = "/var/lib/memgraph"

[[mounts]]
  source      = "memgraph_data"
  destination = "/var/lib/memgraph"
  size_gb     = 10
```

All Fly secrets (Supabase keys, Upstash URL, etc.) are set via `fly secrets set` and injected as environment variables at runtime. They never appear in `fly.toml` or in the GitHub repository.

---

### 0.7 GitHub CI/CD Pipeline

All deployments flow through GitHub Actions. Container images are built, Sigstore-signed (cosign), pushed to GHCR, then deployed to Fly.io via `flyctl`.

```yaml
# .github/workflows/deploy.yml (skeleton — real version in repo)
name: Build, Sign, Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      app:
        description: 'App to deploy (api | worker | math | memgraph | all)'
        required: true
        default: all

permissions:
  contents: read
  packages: write # push to GHCR
  id-token: write # Sigstore OIDC token for cosign

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck test
      - name: Run Supabase tests (local dev stack)
        run: |
          npx supabase start
          pnpm turbo run test:integration --filter=@chainsight/api
          npx supabase stop

  build-sign:
    needs: test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        app: [api, worker, math, memgraph]
    steps:
      - uses: actions/checkout@v4
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          push: true
          tags: ghcr.io/chainsight/${{ matrix.app }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Install cosign
        uses: sigstore/cosign-installer@v3
      - name: Sign image (keyless via Sigstore OIDC)
        run: |
          cosign sign --yes \
            ghcr.io/chainsight/${{ matrix.app }}@${{ steps.build.outputs.digest }}

  deploy:
    needs: build-sign
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Install flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master
      - name: Deploy API
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          flyctl deploy --app chainsight-api \
            --image ghcr.io/chainsight/api:${{ github.sha }} \
            --strategy rolling
      - name: Deploy Worker
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          flyctl deploy --app chainsight-worker \
            --image ghcr.io/chainsight/worker:${{ github.sha }} \
            --strategy rolling
      - name: Deploy Math Service
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          flyctl deploy --app chainsight-math \
            --image ghcr.io/chainsight/math:${{ github.sha }} \
            --strategy rolling
```

**Supabase migrations in CI:**

```yaml
- name: Run Supabase migrations
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
  run: |
    npx supabase db push --project-ref ${{ vars.SUPABASE_PROJECT_REF }}
```

Migrations are run against the Supabase project before the Fly.io deploy, ensuring the database schema is updated before new API code starts serving traffic. Rollback: `supabase db reset --linked` (restores to last migration point — destructive, only for dev/staging).

---

## 1. Service Decomposition

### 1.1 Architectural Philosophy

The four pillars (Belief State, Reproducibility Pack, BYOK Capability Router, Sovereign Deployment) dictate the shape of the backend before any code is written. Every service boundary is drawn to serve the pillars — not to achieve conceptual purity, not to demonstrate microservice expertise. For a solo developer, the only correct service boundary is one that: (a) enforces a hard rule the architecture requires, (b) enables independent scalability that the product needs, or (c) isolates a technology that cannot coexist in the same runtime.

The result is **six process boundaries** for v1, several of which start as in-process libraries and extract later.

### 1.2 The Service Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (Next.js)                           │
│                  tRPC ◄──────────────────────►                      │
└─────────────────────────────────────────────────────────────────────┘
                               │ REST + SSE
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Application API (Fastify)                         │
│   ┌──────────────────┐  ┌───────────────────┐  ┌─────────────────┐  │
│   │  Belief State     │  │ Capability Router  │  │ Repro Pack      │  │
│   │  Service          │  │ (library, in-proc) │  │ Builder (lib)   │  │
│   │  (logical module) │  └───────────────────┘  └─────────────────┘  │
│   └──────────────────┘  ┌───────────────────┐  ┌─────────────────┐  │
│                          │ Chain-of-Custody   │  │ Cache Layer     │  │
│                          │ Service (lib)      │  │ (lib over Redis)│  │
│                          └───────────────────┘  └─────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ BullMQ (Redis)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Worker Process                               │
│   Trace Worker │ Attribution Worker │ Report Worker │ Ingest Worker  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ gRPC (hot-path) / HTTP (bulk)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Math Service (Python / FastAPI)                   │
│   FIFO/LIFO/LIBR │ Confidence Calculus │ Fiat Conversions │ Hashing  │
└─────────────────────────────────────────────────────────────────────┘

Shared stores:
  Supabase Postgres (managed PG 16 + pgvector + RLS; PgBouncer transaction-mode pooler)
  Upstash Redis     (BullMQ queue + cache L1; accessed via HTTPS REST API)
  Memgraph          (graph traversal; Fly.io volume, fly.internal:7687)
  Supabase Storage  (SaaS Blind) / MinIO (On-Prem) — via StorageBackend interface (§0.3)
```

### 1.3 Application API (Fastify)

**What it owns:**

- Every HTTP/REST endpoint exposed to the outside world (public-facing API and agency admin operations)
- Every tRPC procedure called by the Next.js frontend
- Authentication and authorization middleware (Supabase Auth for Phase 0 SaaS Blind; JWKS-generic plugin supports Kratos/Keycloak for On-Prem — see §0.4)
- Multi-tenancy enforcement (agency isolation, row-level security enforcement)
- Request validation (Zod schemas), response serialization
- SSE streams for long-running operation progress
- Enqueuing BullMQ jobs for long-running work
- Direct Postgres reads for low-latency queries (case/IOC/node/edge reads that don't need worker processing)

**What it explicitly does not own:**

- Any heavy computation (trace analysis, wallet history scanning, report generation) — these go to Workers
- Any value arithmetic (fiat conversions, methodology math, confidence calculus) — these go to Math Service
- Any graph traversal deeper than 3 hops (these go to Workers which can talk to Memgraph directly)

**Why Fastify:**

- 2–3× Express throughput for the same handler code
- First-class TypeScript ergonomics with `fastify-plugin` patterns
- Schema-based response serialization (doubles as OpenAPI generation with `@fastify/swagger`)
- `@fastify/rate-limit` and `@fastify/helmet` are production-ready

**Critical Fastify plugins registered at startup:**

```typescript
// apps/api/src/app.ts
import Fastify from 'fastify';
// No Clerk plugin — auth is handled by the JWKS-generic authPlugin (§0.4)
// Supabase Auth for Phase 0; Kratos/Keycloak for On-Prem (AUTH_PROVIDER env var)
import { authPlugin } from './plugins/auth';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { trpcFastifyPlugin } from '@trpc/server/adapters/fastify';
import { agencyContextPlugin } from './plugins/agency-context';
import { encryptionPlugin } from './plugins/encryption';
import { dbPlugin } from './plugins/db';
import { redisPlugin } from './plugins/redis'; // Upstash Redis via ioredis
import { storagePlugin } from './plugins/storage'; // StorageBackend (§0.3)
import { capabilityRouterPlugin } from '@chainsight/capability-router';
import { beliefStatePlugin } from './plugins/belief-state';
import { auditLogPlugin } from './plugins/audit-log';
```

The `agencyContextPlugin` is the most important custom plugin: it extracts the authenticated agency from the Supabase Auth JWT (or Kratos/Keycloak JWT on On-Prem — all three are JWKS-validated by `authPlugin` before `agencyContextPlugin` runs), looks up `users` where `auth_provider_uid = req.authUser.uid`, hydrates the agency row (including KMS key reference), and attaches it to `req.agencyContext`. Every handler downstream reads `req.agencyContext.agencyId` — never extracts tenancy from user input. See §0.4 for full JWKS abstraction details.

### 1.4 Worker Process (BullMQ)

**What it owns:**

- All long-running operations (expected > 500ms): trace expansion, wallet analysis, report generation, document extraction, UTXO clustering, reproducibility pack building
- All agent orchestration calls (invoking LLMs through the Capability Router)
- All background maintenance: cache TTL eviction, sanctions-list refresh, webhook ingestion, chain-reorg detection
- Progress emission back to the API via a Redis pubsub channel (which the API converts to SSE for the browser)

**Why separate process:**

- Worker crashes must not kill the API. Node's single-threaded event loop makes a runaway trace job (e.g., an LLM call that takes 90 seconds) dangerous if colocated with the API.
- Workers can be horizontally scaled independently. If wallet analysis becomes the bottleneck, spin up more worker instances without touching the API.

**Queue structure:**

```typescript
// packages/shared-types/src/queues.ts

export const QUEUES = {
  TRACE: 'trace', // expand_trace, expand_path
  ANALYSIS: 'analysis', // wallet_analysis, utxo_cluster, inspector_analysis
  AGENT: 'agent', // any LLM-backed agent job
  REPORT: 'report', // draft_report, build_repro_pack
  INGEST: 'ingest', // doc_extract, ioc_parse, chain_ingest
  MAINTENANCE: 'maintenance', // cache_refresh, sanctions_update, chain_reorg_check
} as const;

// Priority bands per queue
export const QUEUE_PRIORITIES = {
  INTERACTIVE: 1, // user-initiated, needs fast feedback
  BACKGROUND: 5, // triggered automatically, can wait
  BATCH: 10, // overnight runs, low urgency
} as const;
```

**Concurrency settings (Phase 0 — single-instance):**

- `trace`: 4 concurrent (LLM calls are I/O-bound, safe to parallelize)
- `analysis`: 2 concurrent (wallet analysis is memory-intensive)
- `agent`: 6 concurrent (most agent calls are short)
- `report`: 2 concurrent (report generation holds case context in memory)
- `ingest`: 4 concurrent
- `maintenance`: 2 concurrent

### 1.5 Math Service (Python / FastAPI / gRPC)

**What it owns:**

- Every arithmetic operation on cryptocurrency values, fiat conversions, or confidence scores. No exceptions. The canonical rule from Part 9 of the engineering doc: "The Math Service owns every number."
- FIFO, LIFO, LIBR, pari passu, rolling charge, specific identification methodology computations
- Confidence calculus: per-hop confidence, compound confidence across a trace path, confidence decay visualization data
- Fiat conversion at a specific block timestamp (with methodology pinning)
- Content hashing for reproducibility (SHA-256 of structured data)
- Statistical operations for the ground-truth flywheel

**Why Python:**

- Python's `decimal.Decimal` module gives arbitrary-precision fixed-point arithmetic. JavaScript's `Number` type is IEEE 754 floating point — unacceptable for financial computations. `BigInt` in JavaScript can handle integers but not the mixed fractional arithmetic involved in DeFi.
- Python's scientific stack (NumPy, SciPy, Pandas) enables the statistical work without additional infrastructure.
- The ML/fine-tuning pipeline also lives in Python; sharing the runtime reduces operational overhead.

**Why gRPC for the hot path:**

- The Transaction Inspector and the trace engine call the Math Service on every hop (compute_value_at_block, compute_fee_in_fiat, apply_fifo_to_hop). At 100 hops, that's 100 synchronous calls. HTTP/1.1 REST adds ~5ms of protocol overhead per call; gRPC over HTTP/2 with connection reuse drops this to ~0.5ms. For a 100-hop trace at P99, this difference is 500ms vs. 50ms on the math-call latency alone.
- gRPC gives us strongly-typed service contracts across the language boundary (Proto IDL → TypeScript client stubs, Python server implementation).

**gRPC service definition (proto excerpt):**

```protobuf
// packages/math-client/proto/math.proto
syntax = "proto3";
package chainsight.math.v1;

service MathService {
  rpc ComputeValueAtBlock(ValueAtBlockRequest) returns (ValueAtBlockResponse);
  rpc ApplyAccountingMethodology(MethodologyRequest) returns (MethodologyResponse);
  rpc ComputeCompoundConfidence(ConfidenceRequest) returns (ConfidenceResponse);
  rpc HashContent(HashRequest) returns (HashResponse);
  rpc ComputeFiatAtTimestamp(FiatConversionRequest) returns (FiatConversionResponse);
  rpc ComputeTracePathMath(TracePathMathRequest) returns (TracePathMathResponse);
}

message ValueAtBlockRequest {
  string chain = 1;
  string token_address = 2;        // empty string for native
  string raw_amount = 3;           // string to preserve precision
  uint64 block_height = 4;
  string fiat_currency = 5;        // "USD", "EUR", etc.
  string methodology = 6;          // "spot_at_block" | "twap_7d" | "volume_weighted"
}

message ValueAtBlockResponse {
  string fiat_value = 1;           // string decimal, e.g. "423718.00"
  string rate_used = 2;
  string rate_source = 3;
  string rate_timestamp = 4;
  string methodology_version = 5;  // pinned version for reproducibility
}
```

**REST fallback:** Non-hot-path operations (building a full methodology report, computing confidence decay for the entire case graph) use the FastAPI REST interface. These don't need gRPC's sub-millisecond latency.

### 1.6 Belief State Service (Logical Module → Extractable Service)

**Phase 0 implementation:** A TypeScript module (`packages/belief-state/`) that runs inside the API process. It has its own database connection pool pointing to the `belief_atoms` and `belief_events` tables. It exposes a typed interface consumed by the API handlers and Workers.

**Why not a separate service yet:**

- The Belief State writes synchronously as part of most request handlers ("this handler ran, here is the BeliefAtom it emitted"). Crossing a network boundary for every write adds latency and failure modes.
- Solo developer: debugging a distributed write protocol is expensive. Shared-process means debugger, logging, and tracing all work without spanning services.
- The module has a clean interface: `beliefState.emit(atom)`, `beliefState.query(filter)`, `beliefState.challenge(challengeId)`. When extraction to a service becomes necessary (concurrent write pressure, cross-tenant isolation needs), the interface doesn't change — only the transport does.

**When to extract:** When the API process exceeds ~8 GB memory under load, or when the Belief State snapshot + event log queries start affecting API response latency (> 50ms P95 for normal reads). In practice, this is probably Phase 3 timing.

**Interface:**

```typescript
// packages/belief-state/src/index.ts

export interface BeliefStateService {
  // Write path
  emit(atom: BeliefAtomInput, context: AgencyContext): Promise<BeliefAtom>;
  challenge(
    atomId: string,
    challenge: ChallengeInput,
    context: AgencyContext,
  ): Promise<BeliefAtomChallenge>;
  retract(
    atomId: string,
    retraction: RetractionInput,
    context: AgencyContext,
  ): Promise<BeliefAtomRetraction>;
  supersede(atomId: string, newAtom: BeliefAtomInput, context: AgencyContext): Promise<BeliefAtom>;
  promoteToCourtGrade(
    atomId: string,
    signoff: CourtGradeSignoff,
    context: AgencyContext,
  ): Promise<BeliefAtom>;

  // Read path
  queryAtoms(filter: AtomFilter, context: AgencyContext): Promise<BeliefAtom[]>;
  getAtom(atomId: string, context: AgencyContext): Promise<BeliefAtom | null>;
  getEventLog(caseId: string, context: AgencyContext): Promise<BeliefEvent[]>;
  getSnapshot(caseId: string, asOf?: Date): Promise<CaseBeliefSnapshot>;

  // Convenience queries
  getAtomsBySubject(subjectRef: string, context: AgencyContext): Promise<BeliefAtom[]>;
  getAtomsByCase(caseId: string, context: AgencyContext): Promise<BeliefAtom[]>;
  getOpenChallenges(caseId: string): Promise<BeliefAtomChallenge[]>;
}
```

### 1.7 Capability Router (Package)

**Lives at:** `packages/capability-router/`

This is the most architecturally sensitive package in the entire codebase. The entire BYOK Pillar 3 depends on it being correct. It is a library, not a service, because:

- It must be usable from the API process and the Worker process — both need to resolve capabilities
- It reads from Postgres (agency provider installs) and Redis (cache) which are already shared
- No network hop is acceptable on the critical path of a trace operation

See Section 8 for the full internals.

### 1.8 Reproducibility Pack Builder (Package)

**Lives at:** `packages/reproducibility/`

Called from the Worker process (via the `report` queue) when a report is finalized or when an investigator explicitly requests a pack. Responsibilities:

1. Collect all frozen provider responses for the case (from the `cache_entries` table, scope = case)
2. Collect all BeliefAtoms and the full event log for the case
3. Collect the rule version manifest (pinned heuristic versions, decoder versions)
4. Collect all attribution snapshot references used
5. Collect all AgentCall records (inputs hash, outputs hash, model card)
6. Generate `replay.sh` — a shell script that, given the same inputs, reruns the same agent calls
7. Create a content-addressed ZIP in S3 with the manifest as the root file
8. Compute the manifest SHA-256 and write it to the `reproducibility_packs` table
9. Optionally anchor the hash to a public chain (per G2 — off by default, opt-in)

**Critical constraint:** The Pack builder must be a pure function of its inputs. Given the same case state, it produces the same Pack bytes. This is tested in CI with a determinism test: build a Pack from a known case state, rebuild it, assert the manifest hashes are identical.

### 1.9 Chain-of-Custody Service (Package)

**Lives at:** `packages/chain-of-custody/`

An in-process library that wraps the `chain_of_custody_records` table. F29 mandates that every view, export, print, or modification of evidence is logged to the CoC chain. This service is the only path to writing those records — no handler should write CoC records directly.

```typescript
// packages/chain-of-custody/src/index.ts

export interface ChainOfCustodyService {
  record(event: CustodyEventInput, context: AgencyContext): Promise<ChainOfCustodyRecord>;

  getRecord(artifactRef: string, context: AgencyContext): Promise<ChainOfCustodyRecord | null>;

  verifyChain(caseId: string, context: AgencyContext): Promise<ChainVerificationResult>;

  generateCourtReadyReport(caseId: string, context: AgencyContext): Promise<CourtReadyReport>;
}
```

The hash-chaining logic: each new `ChainOfCustodyRecord` for an artifact includes `prior_record_hash` (the hash of the previous record for that artifact, or null for the first record). `this_record_hash = SHA256(artifact_ref + event_json + prior_record_hash)`. Tampering with any prior record invalidates all subsequent hashes, detectable at verification time.

### 1.10 Supabase Realtime (Bounded Use Cases)

Supabase Realtime is used for exactly two real-time event categories in Phase 0. All other real-time communication uses Redis pubsub → SSE (job progress) or Yjs/WebSocket (canvas CRDT, Phase 2+).

**Bounded use case 1: Deconfliction conflict alerts**

When the Deconfliction Engine worker detects a cross-agency IOC collision and inserts a row into `deconfliction_conflicts`, Supabase Realtime broadcasts a `postgres_changes` event. The supervisor's Next.js frontend receives it within < 500ms and displays an alert banner. This satisfies F22 (Supervisor Mode) and the deconfliction requirement without requiring the API to maintain a persistent connection to each client.

```typescript
// packages/realtime-client/src/deconfliction.ts
import { createClient } from '@supabase/supabase-js';

export function subscribeDeconflictionAlerts(
  supabaseUrl: string,
  supabaseAnonKey: string,
  agencyId: string,
  onAlert: (conflict: DeconflictionConflict) => void,
) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  return supabase
    .channel(`deconfliction:${agencyId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deconfliction_conflicts',
        filter: `agency_id_a=eq.${agencyId}`,
      },
      (payload) => onAlert(payload.new as DeconflictionConflict),
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deconfliction_conflicts',
        filter: `agency_id_b=eq.${agencyId}`,
      },
      (payload) => onAlert(payload.new as DeconflictionConflict),
    )
    .subscribe();
}
```

**Bounded use case 2: Supervisor dashboard case status feed**

The supervisor's live case list subscribes to `UPDATE` events on `cases` for their agency. Case status transitions (e.g., `analyzing → review_ready`, `active → closed`) appear immediately without a manual refresh.

```typescript
// packages/realtime-client/src/cases.ts

export function subscribeCaseStatusFeed(
  supabaseUrl: string,
  supabaseAnonKey: string,
  agencyId: string,
  onUpdate: (updatedCase: CaseSummary) => void,
) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  return supabase
    .channel(`cases:${agencyId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'cases',
        filter: `agency_id=eq.${agencyId}`,
      },
      (payload) => onUpdate(payload.new as CaseSummary),
    )
    .subscribe();
}
```

**What Supabase Realtime explicitly does NOT handle:**

| Use case                                                 | Reason                                                                        | Actual mechanism                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| BullMQ job progress (trace expansion, report generation) | High-frequency events (10–100/sec per job); Realtime is not designed for this | Redis pubsub → Fastify SSE (`/v1/jobs/:jobId/progress`) |
| Canvas CRDT sync (Phase 2 collaborative canvas)          | Requires Yjs awareness protocol, not a simple pubsub                          | Yjs WebSocket server (Phase 2)                          |
| Auth session management                                  | Handled by Supabase Auth internally                                           | Supabase Auth SDK                                       |
| Worker progress heartbeats                               | Worker-internal; no browser subscriber                                        | Redis pubsub only                                       |

**On-Prem parity:** On-Prem deployments set `REALTIME_BACKEND=redis_pubsub`. The `realtimePlugin` Fastify plugin selects either the Supabase Realtime client or a Redis pubsub bridge that emits the same event shapes to the frontend via SSE. The frontend realtime client is backend-agnostic.

---

## 2. API Contracts

### 2.1 REST vs. tRPC vs. gRPC Routing Policy

| Interface              | Used for                                                              | Rationale                                                                        |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **REST (Fastify)**     | External-facing, public API, webhooks, OAuth callbacks, health checks | Interoperable with any client, standard for public APIs                          |
| **tRPC (over HTTP/2)** | All browser↔backend calls from Next.js                                | Type-safe end-to-end, zero schema duplication, automatic React Query integration |
| **gRPC**               | API/Worker → Math Service hot path                                    | Sub-millisecond protocol overhead, strongly typed across language boundary       |
| **BullMQ (Redis)**     | API → Worker job dispatch                                             | Durable, backpressure-capable, observable                                        |

The rule: if the client is the browser, use tRPC. If the call is cross-service hot-path math, use gRPC. If the client is external (API integrations, webhooks), use REST.

### 2.2 tRPC Router Structure

```typescript
// apps/api/src/trpc/router.ts

export const appRouter = router({
  // ── Case management ──────────────────────────────────────
  cases: casesRouter,
  iocs: iocsRouter,

  // ── Graph ─────────────────────────────────────────────────
  graph: graphRouter,

  // ── Belief State ──────────────────────────────────────────
  belief: beliefRouter,

  // ── Tracing operations ────────────────────────────────────
  trace: traceRouter,

  // ── Transaction Inspector ─────────────────────────────────
  inspector: inspectorRouter,

  // ── Wallet Analyzer ───────────────────────────────────────
  wallet: walletRouter,

  // ── Provider marketplace ──────────────────────────────────
  providers: providersRouter,

  // ── Documents ─────────────────────────────────────────────
  documents: documentsRouter,

  // ── Reports ───────────────────────────────────────────────
  reports: reportsRouter,

  // ── Chain of Custody ──────────────────────────────────────
  custody: custodyRouter,

  // ── Audit log ─────────────────────────────────────────────
  audit: auditRouter,

  // ── Paths ─────────────────────────────────────────────────
  paths: pathsRouter,

  // ── Attribution ───────────────────────────────────────────
  attribution: attributionRouter,

  // ── Agency admin ──────────────────────────────────────────
  agency: agencyRouter,
});

export type AppRouter = typeof appRouter;
```

### 2.3 Core tRPC Procedure Definitions

```typescript
// ── Case CRUD ─────────────────────────────────────────────────────────

const casesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(['active', 'closed', 'archived']).optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(25),
      }),
    )
    .output(
      z.object({
        cases: z.array(CaseSchema),
        nextCursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  get: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .output(CaseSchema)
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  create: protectedProcedure
    .input(
      z.object({
        codename: z.string().min(1).max(200),
        classification: z.enum(['unclassified', 'les', 'confidential', 'classified']),
        description: z.string().optional(),
        initialIocs: z.array(IocInputSchema).optional(),
      }),
    )
    .output(CaseSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Create case record with new DEK (key ref from agency KMS)
      // 2. Create audit log entry
      // 3. Emit BeliefAtom: case_created
      // 4. Create CoC record for the case artifact
      // returns full Case
    }),

  update: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        patch: CasePatchSchema,
      }),
    )
    .output(CaseSchema)
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),

  close: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        outcome: z.string(),
        buildReproPack: z.boolean().default(true),
      }),
    )
    .output(z.object({ caseId: z.string(), reproPackId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),
});

// ── IOC Management ────────────────────────────────────────────────────

const iocsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .output(z.array(IocSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  add: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        value: z.string(),
        chain: z.string().optional(), // null → auto-detect (F3 chain scope detection)
        type: z.enum(['address', 'tx_hash', 'block', 'entity', 'unknown']).optional(),
      }),
    )
    .output(IocSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Normalize & validate the IOC value
      // 2. Auto-detect chain if not provided
      // 3. Write IOC record
      // 4. Enqueue background job: ioc_first_touch_analysis (chain_ingest queue)
      // 5. Emit BeliefAtom: ioc_added
      // 6. Write CoC event: collected
    }),

  remove: protectedProcedure
    .input(z.object({ iocId: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),
});

// ── Graph Queries ─────────────────────────────────────────────────────

const graphRouter = router({
  getNodes: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        nodeIds: z.array(z.string()).optional(),
        nodeTypes: z.array(z.enum(['address', 'transaction'])).optional(),
        chains: z.array(z.string()).optional(),
      }),
    )
    .output(z.array(GraphNodeSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  getEdges: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        fromNode: z.string().optional(),
        toNode: z.string().optional(),
        limit: z.number().default(500),
      }),
    )
    .output(z.array(GraphEdgeSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  getNeighbors: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        nodeId: z.string(),
        depth: z.number().min(1).max(10).default(1),
        direction: z.enum(['in', 'out', 'both']).default('both'),
      }),
    )
    .output(
      z.object({
        nodes: z.array(GraphNodeSchema),
        edges: z.array(GraphEdgeSchema),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  expandAddress: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        addressId: z.string(),
        direction: z.enum(['in', 'out', 'both']).default('both'),
        maxTxs: z.number().max(1000).default(100),
      }),
    )
    .output(
      z.object({
        jobId: z.string(),
        message: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Enqueue trace:expand_address job; return job ID for SSE tracking
    }),
});

// ── Tracing Operations ────────────────────────────────────────────────

const traceRouter = router({
  startAutonomous: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        iocIds: z.array(z.string().uuid()).min(1),
        maxHops: z.number().max(200).default(50),
        minConfidence: z.number().min(0.5).max(1.0).default(0.75),
        direction: z.enum(['forward', 'backward', 'both']).default('both'),
        courtGradeOnly: z.boolean().default(false),
      }),
    )
    .output(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Validate budget/rate limits on BYOK providers
      // Enqueue trace:autonomous job
      // Return jobId for SSE subscription
    }),

  cancel: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      /* BullMQ job abort */
    }),

  getProgress: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .output(TraceProgressSchema)
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  subscribeProgress: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .subscription(({ ctx, input }) => {
      // Returns observable of TraceProgressEvent
      // Backed by Redis pubsub channel: `job:progress:{jobId}`
    }),
});

// ── Belief State Queries ──────────────────────────────────────────────

const beliefRouter = router({
  getAtoms: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        subjectRef: z.string().optional(),
        predicate: z.string().optional(),
        tier: z.enum(['T0', 'T1', 'T2', 'T3']).optional(),
        status: z.enum(['asserted', 'challenged', 'retracted', 'court_grade']).optional(),
        cursor: z.string().optional(),
        limit: z.number().default(50),
      }),
    )
    .output(
      z.object({
        atoms: z.array(BeliefAtomSchema),
        nextCursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  emitAtom: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        subjectType: z.enum(['address', 'transaction', 'entity', 'edge', 'hypothesis']),
        subjectRef: z.string(),
        predicate: z.string(),
        object: z.unknown(),
        confidence: z.number().min(0).max(1),
        tier: z.enum(['T0', 'T1', 'T2', 'T3']),
        provenanceJson: z.object({}).passthrough(),
        derivationJson: z.object({}).passthrough().optional(),
      }),
    )
    .output(BeliefAtomSchema)
    .mutation(async ({ ctx, input }) => {
      // Writes to belief_atoms + appends to belief_events
      // Validates tier vs. evidence (T0 must cite chain data, T1 must cite rule version, etc.)
      // Returns the full atom with generated content_hash and prior_event_hash
    }),

  challengeAtom: protectedProcedure
    .input(
      z.object({
        atomId: z.string().uuid(),
        reason: z.string(),
        evidence: z.array(EvidenceRefSchema).optional(),
      }),
    )
    .output(BeliefAtomChallengeSchema)
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),

  resolveChallenge: protectedProcedure
    .input(
      z.object({
        challengeId: z.string().uuid(),
        resolution: z.enum(['upheld', 'withdrawn', 'superseded']),
        notes: z.string().optional(),
      }),
    )
    .output(BeliefAtomChallengeSchema)
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),

  promoteToCourtGrade: protectedProcedure
    .input(
      z.object({
        atomId: z.string().uuid(),
        signoffId: z.string().uuid(),
        notes: z.string().optional(),
      }),
    )
    .output(BeliefAtomSchema)
    .mutation(async ({ ctx, input }) => {
      // Validates: confidence >= threshold, no open challenges, >= 2 independent sources
      // Enforces G1: human-in-the-loop mandatory
      // Sets status = 'court_grade', writes audit log
    }),

  getEventLog: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().default(100),
      }),
    )
    .output(
      z.object({
        events: z.array(BeliefEventSchema),
        nextCursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* ... */
    }),
});

// ── Transaction Inspector ─────────────────────────────────────────────

const inspectorRouter = router({
  analyze: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        txHash: z.string(),
        chain: z.string(),
        sections: z
          .array(
            z.enum([
              'summary', // Narrative Agent plain-language summary (Section 1)
              'structured', // T0 chain facts (Section 2)
              'decoded', // Contract calldata decode (Section 3)
              'counterparty', // Attribution from BYOK providers (Section 4)
              'obfuscation', // Obfuscation indicator check (Section 5)
              'critic', // Critic Agent notes (Section 6)
            ]),
          )
          .default(['structured', 'decoded']),
        forceRefresh: z.boolean().default(false),
      }),
    )
    .output(
      z.object({
        txHash: z.string(),
        chain: z.string(),
        jobId: z.string().optional(), // null if served from cache
        cached: z.boolean(),
        sections: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check cache first (G16 first-touch-live rule)
      // If cache hit and !forceRefresh → return immediately from cache
      // If cache miss → enqueue analysis:inspector_analyze, return jobId
    }),

  saveToCase: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        txHash: z.string(),
        chain: z.string(),
        label: z.string().optional(),
      }),
    )
    .output(z.object({ saved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // Persists Inspector analysis to the Reproducibility Pack for this case
      // Emits BeliefAtom: inspector_analysis_saved
      // Writes CoC event
    }),
});

// ── Provider Marketplace ──────────────────────────────────────────────

const providersRouter = router({
  listCatalog: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        status: z.enum(['available', 'beta', 'deprecated']).optional(),
      }),
    )
    .output(z.array(ProviderDefinitionSchema))
    .query(async ({ ctx, input }) => {
      /* Read from shipped catalog */
    }),

  listInstalled: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .output(z.array(AgencyProviderInstallSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  install: protectedProcedure
    .input(
      z.object({
        providerId: z.string(),
        credential: z.string(), // raw key/token (never persisted in cleartext)
        label: z.string(),
        capabilities: z.array(z.string()),
        priority: z.number().default(1),
        budget: BudgetSpecSchema.optional(),
      }),
    )
    .output(AgencyProviderInstallSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Encrypt credential with agency KMS root key
      // 2. Store credential_ref (never raw credential)
      // 3. Run health check (ping test_endpoint with the key)
      // 4. Write AgencyProviderInstall record
      // 5. Write audit log: provider_installed
      // 6. Populate capability resolver cache
    }),

  getCoverageMatrix: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .output(CoverageMatrixSchema)
    .query(async ({ ctx, input }) => {
      // Returns matrix: capability × installed_provider → status
    }),

  healthCheck: protectedProcedure
    .input(z.object({ installId: z.string().uuid() }))
    .output(HealthCheckResultSchema)
    .mutation(async ({ ctx, input }) => {
      /* Fires test_endpoint */
    }),

  getCostTelemetry: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        period: z.object({ start: z.date(), end: z.date() }),
      }),
    )
    .output(CostTelemetrySchema)
    .query(async ({ ctx, input }) => {
      /* Aggregates from provider_resolutions + agent_calls */
    }),
});

// ── Documents ─────────────────────────────────────────────────────────

const documentsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .output(z.array(CaseDocumentSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  requestUploadUrl: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        filename: z.string(),
        contentType: z.string(),
        documentType: z.enum([
          'subpoena_return',
          'affidavit',
          'court_order',
          'exchange_csv',
          'bank_statement',
          'osint_report',
          'expert_declaration',
          'other',
        ]),
      }),
    )
    .output(
      z.object({
        uploadUrl: z.string(), // presigned S3 URL
        documentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Create CaseDocument record with status 'upload_pending'
      // 2. Generate per-document DEK (envelope-encrypted with case DEK)
      // 3. Generate presigned S3 PUT URL (15 minute expiry)
      // 4. Write CoC event: collected
    }),

  confirmUpload: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        contentHash: z.string(), // SHA-256 of the file, computed client-side
      }),
    )
    .output(CaseDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Verify S3 object exists
      // 2. Verify content hash matches
      // 3. Update document record: status = 'uploaded', content_hash set
      // 4. Enqueue ingest:doc_extract job
    }),

  getExtractionStatus: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .output(
      z.object({
        status: z.enum(['upload_pending', 'uploaded', 'extracting', 'extracted', 'failed']),
        progress: z.number().optional(),
        jobId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* ... */
    }),
});

// ── Reports ───────────────────────────────────────────────────────────

const reportsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .output(z.array(ReportSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  draft: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        template: z.enum([
          'seizure_affidavit',
          'expert_declaration',
          'case_summary',
          'freeze_request',
          'methodology_disclosure',
          'cluster_provenance',
        ]),
        pathIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .output(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Enqueue report:draft_report
    }),

  finalize: protectedProcedure
    .input(
      z.object({
        reportId: z.string().uuid(),
        signoffId: z.string().uuid(), // mandatory per G1
      }),
    )
    .output(ReportSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Verify all sentences in report have citation tokens (Verifier gate)
      // 2. Set report status = finalized
      // 3. Enqueue report:build_repro_pack
      // 4. Write audit log + CoC event
    }),

  buildReproPack: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .output(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      /* Enqueue report:build_repro_pack */
    }),
});

// ── Paths ─────────────────────────────────────────────────────────────

const pathsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .output(z.array(TracePathSchema))
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        name: z.string(),
        color: z.string(), // hex color
        orderedSteps: z.array(PathStepSchema),
      }),
    )
    .output(TracePathSchema)
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),

  finalize: protectedProcedure
    .input(
      z.object({
        pathId: z.string().uuid(),
        signoffId: z.string().uuid(),
      }),
    )
    .output(TracePathSchema)
    .mutation(async ({ ctx, input }) => {
      // Locks the path per G5 path immutability
      // Any further edits must use supersede()
      // Writes content_hash to path record
      // Writes CoC event: sealed
    }),

  supersede: protectedProcedure
    .input(
      z.object({
        pathId: z.string().uuid(),
        name: z.string(),
        color: z.string(),
        orderedSteps: z.array(PathStepSchema),
        reason: z.string(),
      }),
    )
    .output(TracePathSchema)
    .mutation(async ({ ctx, input }) => {
      // Creates new TracePath with supersedes = pathId
      // Old path remains in DB, immutable
    }),
});

// ── Audit Log ─────────────────────────────────────────────────────────

const auditRouter = router({
  query: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid().optional(),
        actorId: z.string().uuid().optional(),
        action: z.string().optional(),
        targetRef: z.string().optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        cursor: z.string().optional(),
        limit: z.number().default(100),
      }),
    )
    .output(
      z.object({
        entries: z.array(AuditLogEntrySchema),
        nextCursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* ... */
    }),

  verifyChain: protectedProcedure
    .input(z.object({ from: z.date().optional(), to: z.date().optional() }))
    .output(
      z.object({
        valid: z.boolean(),
        entriesChecked: z.number(),
        firstBrokenAt: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      /* Hash-chain integrity verification */
    }),
});

// ── Wallet Analyzer ───────────────────────────────────────────────────

const walletRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        name: z.string(),
        addresses: z.array(z.string()).min(1).max(1000),
        chains: z.array(z.string()),
      }),
    )
    .output(WalletSchema)
    .mutation(async ({ ctx, input }) => {
      /* ... */
    }),

  startAnalysis: protectedProcedure
    .input(
      z.object({
        walletId: z.string().uuid(),
        depth: z.number().max(10).default(3),
        runClustering: z.boolean().default(false),
      }),
    )
    .output(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Enqueue analysis:wallet_analysis
    }),
});
```

### 2.4 REST API Endpoints (Public-Facing)

For external consumers (API integrations, webhook receivers, health checks):

```
GET    /health                              Health check (no auth required)
GET    /health/ready                        Readiness check (DB + Redis + Memgraph)
GET    /v1/openapi.json                     OpenAPI spec

POST   /v1/webhooks/provider/:providerId    Webhook ingestion (provider-specific HMAC validation)
POST   /v1/webhooks/supabase-auth            Supabase Auth user lifecycle webhooks (user.created, user.deleted)

GET    /v1/cases/:caseId/repro-pack         Download Reproducibility Pack (agency-scoped JWT)
GET    /v1/audit/export                     Export audit log as NDJSON (admin-scoped JWT)
```

The REST API is intentionally thin. All feature work goes through tRPC. REST is for external integrations and operations tooling.

### 2.5 Shared Type Definitions

```typescript
// packages/shared-types/src/schemas.ts

export const BeliefAtomSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  subjectType: z.enum(['address', 'transaction', 'entity', 'edge', 'hypothesis']),
  subjectRef: z.string(),
  predicate: z.string(),
  object: z.unknown(),
  confidence: z.number(),
  tier: z.enum(['T0', 'T1', 'T2', 'T3']),
  provenanceJson: z.object({}).passthrough(),
  derivationJson: z.object({}).passthrough().nullable(),
  status: z.enum(['asserted', 'challenged', 'retracted', 'court_grade']),
  signoffId: z.string().uuid().nullable(),
  supersededBy: z.string().uuid().nullable(),
  retractedBy: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  contentHash: z.string(),
  priorEventHash: z.string().nullable(),
});

export const CaseSchema = z.object({
  id: z.string().uuid(),
  agencyId: z.string().uuid(),
  codename: z.string(),
  status: z.enum(['active', 'closed', 'archived', 'on_hold']),
  classification: z.enum(['unclassified', 'les', 'confidential', 'classified']),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
  // Narrative fields omitted for brevity
});

export const GraphNodeSchema = z.discriminatedUnion('nodeType', [
  z.object({
    nodeType: z.literal('address'),
    id: z.string(),
    chain: z.string(),
    address: z.string(),
    attribution: z.array(AttributionSummarySchema).optional(),
    beliefAtoms: z.array(z.string().uuid()).optional(),
    isMixer: z.boolean().optional(),
    isSanctioned: z.boolean().optional(),
  }),
  z.object({
    nodeType: z.literal('transaction'),
    id: z.string(),
    chain: z.string(),
    txHash: z.string(),
    blockHeight: z.number(),
    timestamp: z.date(),
    status: z.enum(['success', 'failed', 'pending']),
    valueUsd: z.string().optional(),
    decodedAction: DecodedActionSchema.optional(),
  }),
]);

export const TraceProgressSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  hopsExplored: z.number(),
  nodesFound: z.number(),
  confidence: z.number(),
  currentPath: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});
```

---

## 3. Message Schemas

### 3.1 BullMQ Job Payloads

Jobs are serialized as JSON. Every payload includes `agencyId`, `caseId`, and `requestedBy` for audit trail purposes. The `idempotencyKey` prevents duplicate processing.

```typescript
// packages/shared-types/src/jobs.ts

// ── Trace Jobs ────────────────────────────────────────────────────────

export interface TraceExpandAddressJob {
  type: 'trace:expand_address';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    addressId: string;
    direction: 'in' | 'out' | 'both';
    maxTxs: number;
    parentJobId?: string; // for sub-jobs spawned by autonomous trace
  };
}

export interface TraceAutonomousJob {
  type: 'trace:autonomous';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    iocIds: string[];
    maxHops: number;
    minConfidence: number;
    direction: 'forward' | 'backward' | 'both';
    courtGradeOnly: boolean;
  };
}

// ── Analysis Jobs ─────────────────────────────────────────────────────

export interface InspectorAnalyzeJob {
  type: 'analysis:inspector_analyze';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    txHash: string;
    chain: string;
    sections: ('summary' | 'structured' | 'decoded' | 'counterparty' | 'obfuscation' | 'critic')[];
    forceRefresh: boolean;
  };
}

export interface WalletAnalysisJob {
  type: 'analysis:wallet_analysis';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    walletId: string;
    depth: number;
    runClustering: boolean;
  };
}

export interface UTXOClusterJob {
  type: 'analysis:utxo_cluster';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    seedAddressId: string;
    maxExpansionRounds: number;
    coinjoinExclusion: boolean;
  };
}

// ── Report Jobs ───────────────────────────────────────────────────────

export interface DraftReportJob {
  type: 'report:draft_report';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    reportId: string;
    template: string;
    pathIds?: string[];
  };
}

export interface BuildReproPackJob {
  type: 'report:build_repro_pack';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    reportId?: string; // null = case-level pack (not tied to a specific report)
    anchorToChain: boolean;
  };
}

// ── Ingest Jobs ───────────────────────────────────────────────────────

export interface DocExtractJob {
  type: 'ingest:doc_extract';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    documentId: string;
    documentType: string;
    s3Ref: string;
    extractionProvider: string; // from capability router: 'textract' | 'unstructured' | ...
  };
}

export interface IocFirstTouchJob {
  type: 'ingest:ioc_first_touch';
  agencyId: string;
  caseId: string;
  requestedBy: string;
  idempotencyKey: string;
  payload: {
    iocId: string;
    value: string;
    chain: string;
    iocType: string;
  };
}
```

### 3.2 Belief State Event Types (Event Log)

The Belief State is event-sourced. Every mutation emits a `BeliefEvent` appended to the `belief_events` table. The current state of any `BeliefAtom` is the result of replaying its event log.

```typescript
// packages/belief-state/src/events.ts

export type BeliefEventType =
  | 'BeliefAtomCreated'
  | 'BeliefAtomChallenged'
  | 'BeliefAtomChallengeResolved'
  | 'BeliefAtomRetracted'
  | 'BeliefAtomSuperseded'
  | 'BeliefAtomPromotedToCourtGrade'
  | 'BeliefAtomConfidenceRevised'
  | 'BeliefAtomProvenanceAdded'
  | 'BeliefAtomSignoffDelegated'; // Supervisor delegates court-grade approval

export interface BeliefEvent {
  id: string; // UUID
  caseId: string;
  atomId: string; // which BeliefAtom this event applies to
  eventType: BeliefEventType;
  payload: BeliefEventPayload;
  emittedBy: string; // actor: investigator_id or system_agent_name
  emittedAt: Date;
  seqNum: number; // monotonic per-case sequence number
  priorEventHash: string | null; // hash of the previous event in the log
  thisEventHash: string; // SHA256(seqNum + atomId + eventType + payload_json + priorEventHash)
}

// Typed payloads per event type

export interface BeliefAtomCreatedPayload {
  atom: BeliefAtomInput; // the initial atom state
}

export interface BeliefAtomChallengedPayload {
  challengeId: string;
  challengedBy: string; // agent name or investigator_id
  reason: string;
  evidence: EvidenceRef[];
  fiveAxesScore: {
    provenanceQuality: number; // 0-1
    alternativeExplanation: number; // 0-1 (higher = stronger alternative exists)
    baseRatePlausibility: number; // 0-1
    internalConsistency: number; // 0-1
    adversarialRobustness: number; // 0-1
  };
}

export interface BeliefAtomChallengeResolvedPayload {
  challengeId: string;
  resolution: 'upheld' | 'withdrawn' | 'superseded';
  resolvedBy: string;
  notes: string;
}

export interface BeliefAtomRetractedPayload {
  retractedBy: string;
  rationale: string;
  evidence: EvidenceRef[];
  cascadeAnalysis: {
    affectedAtomIds: string[];
    affectedPathIds: string[];
    affectedReportIds: string[];
  };
}

export interface BeliefAtomSupersededPayload {
  supersededBy: string; // new atom ID
  reason: string;
  changedFields: string[];
}

export interface BeliefAtomPromotedToCourtGradePayload {
  signoffId: string;
  promotedBy: string;
  confidenceAtPromotion: number;
  openChallengesAtPromotion: number; // must be 0
  sourceCount: number; // must be >= 2
}
```

### 3.3 Internal Progress Events (Redis Pubsub)

Workers publish progress events to Redis channels during long-running jobs. The API subscribes and converts these to SSE streams for the browser.

```typescript
// packages/shared-types/src/progress.ts

export interface JobProgressEvent {
  jobId: string;
  jobType: string;
  agencyId: string;
  caseId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  message: string;
  detail: Record<string, unknown>; // job-type specific detail
  timestamp: Date;
}

// Examples of job-type-specific detail fields:

// For trace:autonomous
// detail: { hopsExplored: 47, nodesFound: 123, confidence: 0.82, currentAddress: '0xabc...' }

// For analysis:wallet_analysis
// detail: { addressesProcessed: 234, addressesTotal: 500, clustersFound: 12 }

// For report:draft_report
// detail: { sectionsCompleted: 3, sectionsTotal: 8, currentSection: 'Methodology Disclosure' }

// Redis channel naming:
// `job:progress:{jobId}` — progress events for a specific job
// `case:events:{caseId}` — all events for a specific case (graph updates, belief atom emits, etc.)
// `agency:alerts:{agencyId}` — agency-level alerts (provider health, budget warnings)
```

### 3.4 Chain-of-Custody Event Schema

```typescript
// packages/chain-of-custody/src/schema.ts

export const CUSTODY_EVENT_TYPES = [
  'collected', // evidence first acquired
  'viewed', // someone accessed the artifact
  'exported', // downloaded or sent to external system
  'printed', // physical printout (with QR back-reference)
  'shared', // shared with another investigator
  'signed', // cryptographically signed
  'modified', // non-trivial modification (retraction, annotation)
  'sealed', // finalized, changes no longer permitted
  'unsealed', // unsealed for correction (with supervisor approval)
  'produced_in_discovery', // provided to opposing counsel
  'destroyed', // physical evidence destroyed (with authority)
] as const;

export interface CustodyEventInput {
  artifactRef: string; // format: `{artifact_type}:{artifact_id}`
  eventType: (typeof CUSTODY_EVENT_TYPES)[number];
  actor: string; // investigator_id or 'system:{service_name}'
  authority: 'warrant' | 'subpoena' | 'court_order' | 'mlat' | 'voluntary' | 'internal' | 'none';
  authorityRef: string | null; // FK to document that authorizes this event
  rationale: string;
  recipient: string | null; // for shared/exported events
  hashAtEvent: string; // SHA256 of the artifact content at this moment
}
```

---

## 4. State Management Patterns

### 4.1 The Core Problem

Several important operations take 5-120 seconds to complete: autonomous traces, wallet analyses, document extractions, report drafts. The API must respond immediately (return a jobId), and the browser must get live progress without polling.

The pattern: **Enqueue → Subscribe → Stream → Persist partial results**.

### 4.2 The Full Long-Running Operation Lifecycle

```
Browser                API                  Redis              Worker              DB
  │                     │                     │                    │                │
  │  startAutonomous()  │                     │                    │                │
  │────────────────────►│                     │                    │                │
  │                     │  RPUSH trace queue  │                    │                │
  │                     │────────────────────►│                    │                │
  │   { jobId: "xyz" }  │                     │                    │                │
  │◄────────────────────│                     │                    │                │
  │                     │                     │                    │                │
  │  subscribeProgress  │                     │                    │                │
  │  (jobId="xyz")      │                     │                    │                │
  │────────────────────►│                     │                    │                │
  │                     │  SUBSCRIBE          │                    │                │
  │                     │  job:progress:xyz   │                    │                │
  │                     │────────────────────►│                    │                │
  │                     │                     │                    │                │
  │   SSE: {queued}     │                     │                    │                │
  │◄────────────────────│                     │                    │                │
  │                     │                     │   BRPOP trace q    │                │
  │                     │                     │◄───────────────────│                │
  │                     │                     │    { jobId }       │                │
  │                     │                     │───────────────────►│                │
  │                     │                     │                    │  hop 1 result  │
  │                     │                     │                    │───────────────►│
  │                     │                     │ PUBLISH            │                │
  │                     │                     │ job:progress:xyz   │                │
  │                     │                     │◄───────────────────│                │
  │   SSE: {running,    │                     │                    │                │
  │   hops: 5, conf:0.9}│                     │                    │                │
  │◄────────────────────│                     │                    │                │
  │                     │                     │                  ... (continues)    │
  │   SSE: {completed}  │                     │                    │                │
  │◄────────────────────│                     │                    │                │
```

The SSE stream lives on the tRPC subscription procedure. Behind it is a thin Redis pub/sub subscriber that forwards events. When the browser disconnects (tab close, navigation), the API unsubscribes from Redis. No memory leak, no zombie connections.

### 4.3 Partial Results Persistence

Partial results are not buffered in Redis. They go directly to Postgres. This is the key design decision: **if the API or Worker crashes mid-trace, partial results survive**.

A trace job after each hop:

1. Writes the newly discovered `AddressNode` and `TransactionNode` to Postgres
2. Writes the `Edge` records
3. Emits BeliefAtoms for each discovered relationship
4. Updates the job's `progress_json` field in the BullMQ job record
5. Publishes the progress event to Redis

On job recovery (process restart), the Worker reads the job's `progress_json` to determine where it left off and resumes from the last committed hop.

### 4.4 Cancellation

Cancellation is cooperative, not preemptive. Workers check a Redis key `job:cancel:{jobId}` before each hop. The cancel tRPC procedure sets that key with a 1-hour TTL and sends a BullMQ `job.discard()` signal. Workers that are blocked on I/O (LLM call, provider API call) will cancel at the next hop check after the I/O completes.

Long I/O operations (LLM calls that may take 60+ seconds) are wrapped in a race:

```typescript
const result = await Promise.race([
  llmClient.call(prompt),
  waitForCancelSignal(jobId), // resolves when Redis key is set
]);
if (result.type === 'cancelled') {
  // flush partial results, emit final progress event, clean up
  return;
}
```

### 4.5 Progress Reporting Contract

Workers must report progress at minimum every 10 seconds and at maximum every 500ms. If a job is silent for 30 seconds (no Redis publish), the API marks it as stalled. This prevents phantom "running" jobs in the UI.

BullMQ's built-in `job.updateProgress()` is used as the ground truth for job state. The Redis pubsub is the low-latency notification path; `job.updateProgress()` is the durable state.

---

## 5. Persistence Patterns

### 5.1 Schema Design Philosophy

**Postgres is the single source of truth for all structured data.** Memgraph is a read model derived from Postgres for traversal queries — never a write target. Redis is ephemeral (cache, queues, sessions). S3 stores binary artifacts (documents, packs, cached provider payloads) — never raw strings.

**Every case-scoped table has `agency_id` as a non-nullable column and a Postgres row-level security (RLS) policy that enforces it.** The application layer enforces tenancy, but RLS is the backstop. A bug that forgets to filter by `agency_id` in application code still cannot return another agency's data.

### 5.2 Core DDL

```sql
-- ── Tenancy ──────────────────────────────────────────────────────────

CREATE TABLE agencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  kms_key_ref     TEXT NOT NULL,    -- pointer to KMS key, never the key itself
  tier            TEXT NOT NULL CHECK (tier IN ('investigator','team','department','agency','classified')),
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  auth_provider_uid  TEXT UNIQUE NOT NULL,  -- provider-agnostic: 'sub' claim from JWKS JWT
  auth_provider      TEXT NOT NULL DEFAULT 'supabase'  CHECK (auth_provider IN ('supabase','kratos','keycloak')),
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('investigator','supervisor','admin','readonly')),
  mfa_enrolled_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Cases ─────────────────────────────────────────────────────────────

CREATE TABLE cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  codename        BYTEA NOT NULL,   -- encrypted with case DEK
  status          TEXT NOT NULL CHECK (status IN ('active','closed','archived','on_hold')),
  classification  TEXT NOT NULL CHECK (classification IN ('unclassified','les','confidential','classified')),
  created_by      UUID NOT NULL REFERENCES users(id),
  dek_ref         TEXT NOT NULL,    -- reference to the per-case DEK in KMS
  settings        BYTEA,            -- encrypted JSONB
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: investigators can only read their agency's cases
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY cases_agency_isolation ON cases
  USING (agency_id = current_setting('app.current_agency_id')::uuid);

CREATE TABLE iocs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES cases(id),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  value           BYTEA NOT NULL,   -- encrypted
  chain           TEXT,
  ioc_type        TEXT NOT NULL CHECK (ioc_type IN ('address','tx_hash','block','entity','unknown')),
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Graph ─────────────────────────────────────────────────────────────

CREATE TABLE address_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL REFERENCES agencies(id),
  chain               TEXT NOT NULL,
  address             TEXT NOT NULL,
  normalized_address  TEXT NOT NULL,
  first_seen_at       TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, chain, normalized_address)
);

CREATE INDEX idx_address_nodes_case ON address_nodes(case_id);
CREATE INDEX idx_address_nodes_address ON address_nodes(chain, normalized_address);

CREATE TABLE transaction_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES cases(id),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  chain           TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  block_height    BIGINT,
  block_timestamp TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('success','failed','pending')),
  fee_native      NUMERIC(30, 18),
  fee_usd         NUMERIC(20, 8),
  decoded_action  JSONB,            -- from Math Service decode
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, chain, tx_hash)
);

CREATE TABLE graph_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES cases(id),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  from_node_id    UUID NOT NULL,    -- may reference address_nodes OR transaction_nodes
  from_node_type  TEXT NOT NULL CHECK (from_node_type IN ('address','transaction')),
  to_node_id      UUID NOT NULL,
  to_node_type    TEXT NOT NULL CHECK (to_node_type IN ('address','transaction')),
  edge_type       TEXT NOT NULL,    -- 'sent_to', 'received_from', 'input_of', 'output_of'
  value_native    NUMERIC(30, 18),
  token_address   TEXT,
  token_symbol    TEXT,
  position_in_tx  INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graph_edges_from ON graph_edges(case_id, from_node_id);
CREATE INDEX idx_graph_edges_to   ON graph_edges(case_id, to_node_id);

-- ── Belief State (event-sourced) ──────────────────────────────────────

CREATE TABLE belief_atoms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  agency_id        UUID NOT NULL REFERENCES agencies(id),
  subject_type     TEXT NOT NULL,
  subject_ref      TEXT NOT NULL,
  predicate        TEXT NOT NULL,
  object           JSONB NOT NULL,
  confidence       FLOAT NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  tier             TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
  provenance_json  JSONB NOT NULL,
  derivation_json  JSONB,
  status           TEXT NOT NULL DEFAULT 'asserted' CHECK (status IN ('asserted','challenged','retracted','court_grade')),
  signoff_id       UUID REFERENCES users(id),  -- NOT NULL when status = 'court_grade' (enforced by CHECK)
  superseded_by    UUID REFERENCES belief_atoms(id),
  retracted_by     UUID,           -- belief_event.id of the retraction event
  created_by       TEXT NOT NULL,  -- investigator_id or agent name
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash     TEXT NOT NULL,  -- deterministic hash of the atom content
  prior_event_hash TEXT,           -- hash of the prior belief_event for this case
  CONSTRAINT court_grade_requires_signoff CHECK (
    (status != 'court_grade') OR (signoff_id IS NOT NULL)
  )
);

CREATE INDEX idx_belief_atoms_case ON belief_atoms(case_id);
CREATE INDEX idx_belief_atoms_subject ON belief_atoms(case_id, subject_type, subject_ref);
CREATE INDEX idx_belief_atoms_status ON belief_atoms(case_id, status);

CREATE TABLE belief_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  agency_id        UUID NOT NULL REFERENCES agencies(id),
  atom_id          UUID NOT NULL REFERENCES belief_atoms(id),
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  emitted_by       TEXT NOT NULL,
  emitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seq_num          BIGINT NOT NULL,  -- monotonic per case
  prior_event_hash TEXT,
  this_event_hash  TEXT NOT NULL,
  UNIQUE(case_id, seq_num)
);

-- Belief State snapshots (materialized periodically for fast initial loads)
CREATE TABLE belief_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  agency_id        UUID NOT NULL REFERENCES agencies(id),
  snapshot_at_seq  BIGINT NOT NULL,
  snapshot_json    BYTEA NOT NULL,  -- encrypted, gzip-compressed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Provider Layer ────────────────────────────────────────────────────

CREATE TABLE agency_provider_installs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id            UUID NOT NULL REFERENCES agencies(id),
  provider_id          TEXT NOT NULL,
  display_label        TEXT NOT NULL,
  credential_ref       TEXT NOT NULL,   -- pointer to encrypted credential in KMS
  enabled              BOOLEAN NOT NULL DEFAULT true,
  enabled_capabilities TEXT[] NOT NULL DEFAULT '{}',
  priority             INT NOT NULL DEFAULT 1,
  budget_spec          JSONB,
  scope                TEXT NOT NULL CHECK (scope IN ('agency_wide','department','case_specific')),
  scope_refs           UUID[],
  added_by             UUID NOT NULL REFERENCES users(id),
  added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_health_check    JSONB
);

CREATE TABLE cache_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key            TEXT NOT NULL,
  capability           TEXT NOT NULL,
  args_hash            TEXT NOT NULL,     -- SHA256 of canonicalized args JSON
  provider_install_id  UUID REFERENCES agency_provider_installs(id),
  response_payload     BYTEA NOT NULL,    -- compressed, encrypted with case/agency DEK
  response_metadata    JSONB NOT NULL,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_tier             TEXT NOT NULL CHECK (ttl_tier IN ('immutable','slow_drift','medium_drift','fast_drift')),
  expires_at           TIMESTAMPTZ,
  scope                TEXT NOT NULL CHECK (scope IN ('case','agency','global_chain_data')),
  scope_ref            UUID NOT NULL,     -- case_id or agency_id
  refresh_count        INT NOT NULL DEFAULT 0,
  hit_count            INT NOT NULL DEFAULT 0,
  byte_size            INT NOT NULL,
  UNIQUE(cache_key, scope, scope_ref)
);

CREATE INDEX idx_cache_entries_key ON cache_entries(cache_key);
CREATE INDEX idx_cache_entries_scope ON cache_entries(scope, scope_ref);
CREATE INDEX idx_cache_entries_expires ON cache_entries(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE provider_resolutions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           UUID NOT NULL REFERENCES agencies(id),
  case_id             UUID REFERENCES cases(id),
  capability          TEXT NOT NULL,
  resolved_install_id UUID REFERENCES agency_provider_installs(id),
  cache_hit           BOOLEAN NOT NULL,
  latency_ms          INT,
  cost_units          NUMERIC(10,6),  -- provider-reported cost units
  resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Chain of Custody ──────────────────────────────────────────────────

CREATE TABLE chain_of_custody_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               UUID NOT NULL REFERENCES cases(id),
  agency_id             UUID NOT NULL REFERENCES agencies(id),
  artifact_ref          TEXT NOT NULL,
  artifact_content_hash TEXT NOT NULL,
  events                JSONB NOT NULL DEFAULT '[]',
  current_custodian     TEXT NOT NULL,
  classification        TEXT NOT NULL,
  prior_record_hash     TEXT,
  this_record_hash      TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, artifact_ref)
);

-- ── Audit Log ─────────────────────────────────────────────────────────

CREATE TABLE audit_log_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   UUID NOT NULL REFERENCES agencies(id),
  actor       TEXT NOT NULL,         -- investigator_id or 'system:{service}'
  action      TEXT NOT NULL,
  target_ref  TEXT NOT NULL,
  metadata    JSONB,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prior_hash  TEXT,
  this_hash   TEXT NOT NULL,
  -- Append-only: no UPDATE or DELETE ever
  CHECK (ts > '2024-01-01'::timestamptz)  -- sanity check, not security
);

CREATE INDEX idx_audit_log_agency ON audit_log_entries(agency_id, ts);
CREATE INDEX idx_audit_log_actor  ON audit_log_entries(actor, ts);
CREATE INDEX idx_audit_log_target ON audit_log_entries(target_ref);

-- Enforce append-only via trigger
CREATE RULE audit_no_update AS ON UPDATE TO audit_log_entries DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_log_entries DO INSTEAD NOTHING;

-- ── Documents ─────────────────────────────────────────────────────────

CREATE TABLE case_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL REFERENCES cases(id),
  agency_id         UUID NOT NULL REFERENCES agencies(id),
  filename          BYTEA NOT NULL,   -- encrypted
  document_type     TEXT NOT NULL,
  storage_ref       TEXT NOT NULL,    -- S3 key
  content_hash      TEXT,
  encryption_ref    TEXT NOT NULL,    -- per-document DEK reference
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('upload_pending','uploaded','extracting','extracted','failed')),
  extracted_json    BYTEA,            -- encrypted extraction output
  uploaded_by       UUID NOT NULL REFERENCES users(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Reports ───────────────────────────────────────────────────────────

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES cases(id),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  template        TEXT NOT NULL,
  draft_md        BYTEA,             -- encrypted markdown
  finalized_at    TIMESTAMPTZ,
  signoff_id      UUID REFERENCES users(id),
  repro_pack_ref  TEXT,              -- S3 key of the Reproducibility Pack
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trace Paths ───────────────────────────────────────────────────────

CREATE TABLE trace_paths (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  agency_id        UUID NOT NULL REFERENCES agencies(id),
  name             BYTEA NOT NULL,      -- encrypted
  color            TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('draft','finalized','superseded')),
  ordered_steps    BYTEA NOT NULL,      -- encrypted JSONB array
  content_hash     TEXT,                -- set at finalization (G5)
  signoff_id       UUID REFERENCES users(id),
  supersedes       UUID REFERENCES trace_paths(id),
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at     TIMESTAMPTZ,
  CONSTRAINT finalized_path_has_hash CHECK (
    (status != 'finalized') OR (content_hash IS NOT NULL AND signoff_id IS NOT NULL)
  )
);

-- ── AI Tracking ───────────────────────────────────────────────────────

CREATE TABLE agent_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID REFERENCES cases(id),
  agency_id       UUID NOT NULL REFERENCES agencies(id),
  agent_name      TEXT NOT NULL,
  model_card_id   UUID,
  inputs_hash     TEXT NOT NULL,     -- SHA256 of inputs (never store raw inputs)
  outputs_hash    TEXT NOT NULL,     -- SHA256 of outputs
  cost_units      NUMERIC(10, 6),
  latency_ms      INT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE model_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id              TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  prompt_template_hash  TEXT NOT NULL,
  sampling_params_json  JSONB NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, model_version, prompt_template_hash)
);
```

### 5.2a Supabase RLS Policies (Per-Tenant Isolation)

Row-Level Security is a first-class part of the Phase 0 design — not an afterthought added before launch. Every table that contains tenant-scoped data has RLS enabled and at least one policy. Supabase's `auth.uid()` function returns the authenticated user's UUID from the JWT, which maps to `users.auth_provider_uid`.

**RLS policy pattern for agency-scoped tables:**

```sql
-- Enable RLS on every tenant-scoped table
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE iocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_of_custody_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function: resolve the calling user's agency_id from auth.uid()
-- Used in all RLS policies to avoid per-policy subqueries.
CREATE OR REPLACE FUNCTION auth.agency_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT agency_id
  FROM public.users
  WHERE auth_provider_uid = auth.uid()::text
  LIMIT 1;
$$;

-- Cases: users can only see cases belonging to their agency
CREATE POLICY "cases_agency_isolation" ON cases
  FOR ALL
  USING (agency_id = auth.agency_id())
  WITH CHECK (agency_id = auth.agency_id());

-- IOCs: scoped to case, which is scoped to agency
CREATE POLICY "iocs_agency_isolation" ON iocs
  USING (
    case_id IN (
      SELECT id FROM cases WHERE agency_id = auth.agency_id()
    )
  );

-- Belief atoms: scoped to case
CREATE POLICY "belief_atoms_agency_isolation" ON belief_atoms
  USING (
    case_id IN (
      SELECT id FROM cases WHERE agency_id = auth.agency_id()
    )
  );

-- Audit log: readable by agency members, writable only by service role
-- (INSERT via service role key in the API server — never via anon key)
CREATE POLICY "audit_log_read_own_agency" ON audit_log
  FOR SELECT
  USING (agency_id = auth.agency_id());

CREATE POLICY "audit_log_insert_service_role_only" ON audit_log
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
```

**Service role vs. anon key usage:**

| Operation                                   | Key used                                                  | Why                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| All API server DB writes                    | `SUPABASE_SERVICE_ROLE_KEY`                               | Bypasses RLS for writes where RLS would conflict with worker-to-worker or system operations (audit log, CoC records written by the worker process) |
| Client-side Supabase Realtime subscriptions | `SUPABASE_ANON_KEY`                                       | Browser-level key; RLS enforces isolation; never bypasses policies                                                                                 |
| Direct DB reads in Fastify handlers         | `SUPABASE_SERVICE_ROLE_KEY` + explicit `agency_id` filter | API server always adds `WHERE agency_id = req.agencyContext.agencyId`; RLS is a defense-in-depth backstop                                          |

**Critical:** The `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser or included in the Next.js client bundle. It is a server-side secret only.

**RLS performance notes:**

- The `auth.agency_id()` helper function is marked `STABLE` and `SECURITY DEFINER`. Postgres caches the result within a transaction, so repeated calls don't re-execute the subquery.
- For tables with high read volume (`belief_atoms`, `graph_edges`), the RLS policy adds a join cost. Mitigate with: (a) a GIN index on `belief_atoms(case_id)` and (b) ensuring the planner can push the RLS predicate into an index scan.
- Supabase's PgBouncer is in **transaction mode** — this means `SET LOCAL` and session-level settings are reset between transactions. The `auth.uid()` function reads from the JWT claim injected per-request, which survives transaction-mode pooling correctly. Do **not** use `SET app.current_user_id` patterns (session-mode only).

**Migration to AWS RDS:** The RLS DDL is pure PostgreSQL — it migrates verbatim to RDS. The only change is replacing `auth.uid()` with a custom function that reads from a JWT stored in `current_setting('app.jwt_uid')` (set per-request by the application layer, not by Supabase's Auth extension). This is a 1-day migration task, documented in §0.5.

---

### 5.2b Storage Backend Abstraction (Persistence Layer View)

The `StorageBackend` interface (defined in §0.3) is referenced from these tables:

| Table                   | Column         | What it stores                                                                                                    |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `case_documents`        | `storage_path` | Path within the `case-documents` bucket; combined with `StorageBackend.getSignedUrl()` to generate download links |
| `reproducibility_packs` | `storage_path` | Path within the `repro-packs` bucket                                                                              |
| `audit_log_exports`     | `storage_path` | Path within the `audit-exports` bucket                                                                            |
| `belief_atom_snapshots` | `storage_path` | S3/Supabase path to the snapshot JSON blob (large snapshots are not stored in Postgres)                           |

The `storage_path` column is always a relative path (e.g., `{agencyId}/{caseId}/{docId}/filename.pdf`). The bucket is determined by the record's table — never stored in the `storage_path` column itself. This makes the paths portable between Supabase Storage and MinIO.

---

### 5.3 Row-Level Encryption Strategy

Per Pillar 4 sovereignty and the v0.7 deployment model: every case-scoped column that contains PII or investigation data is encrypted at the application layer with the case's DEK, before the data reaches Postgres. The database stores ciphertext. The KMS returns plaintext DEKs only to authenticated application processes holding valid agency credentials.

**What is encrypted:**

- All `BYTEA` columns in the schema above (codename, filename, draft_md, ordered_steps, etc.)
- The `object` field of `belief_atoms` (investigation content)
- The `extracted_json` of `case_documents`

**What is not encrypted:**

- UUIDs, timestamps, status enums, foreign keys — these are metadata the application needs for query filtering
- `address` and `tx_hash` fields in graph tables — these are public blockchain data; encrypting them would prevent deduplication and require decryption for every cache lookup. Risk is acceptable: chain data is public.
- Audit log fields — these must be readable for compliance reviews; they're protected by access controls, not encryption.

**Encryption implementation:**

```typescript
// packages/shared-types/src/encryption.ts

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export async function encryptWithDek(
  plaintext: Buffer | string,
  dekPlaintext: Buffer, // 32-byte AES-256 key, fetched from KMS
): Promise<Buffer> {
  const iv = randomBytes(12); // 96-bit IV for AES-256-GCM
  const cipher = createCipheriv('aes-256-gcm', dekPlaintext, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16-byte authentication tag
  // Format: [12-byte IV][16-byte tag][ciphertext]
  return Buffer.concat([iv, tag, encrypted]);
}

export async function decryptWithDek(ciphertext: Buffer, dekPlaintext: Buffer): Promise<Buffer> {
  const iv = ciphertext.subarray(0, 12);
  const tag = ciphertext.subarray(12, 28);
  const enc = ciphertext.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', dekPlaintext, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
```

The DEK is fetched from KMS once per request context and cached in the `AgencyContext` object for the lifetime of that request. No DEK ever touches the database or S3.

### 5.4 Hash-Chained Audit Log

The audit log's append-only property is enforced at three levels:

1. The Postgres rule (`CREATE RULE audit_no_update ... DO INSTEAD NOTHING`)
2. S3 Object Lock (WORM mode) for the mirrored copy
3. Hash chaining: each entry's `this_hash = SHA256(id + actor + action + target_ref + ts + prior_hash)`

Verification is an O(n) scan that can be run at any time by the audit procedures. `prior_hash` of the first entry is `null`; the chain begins there.

Periodic Merkle root anchoring (per G2 opt-in): a cron job computes the Merkle root of the last 10,000 audit entries and, if the agency has opted in, posts it to a public chain via OP_RETURN. This gives courts a timestamp they can verify independently.

### 5.5 Memgraph as Graph Read Model

Memgraph is populated from Postgres via a CDC (change data capture) pipeline triggered whenever `address_nodes`, `transaction_nodes`, or `graph_edges` are written. A BullMQ maintenance job runs this sync on a 1-second polling interval in Phase 0 (acceptable latency for the graph view). Phase 2 uses Postgres logical replication for sub-second sync.

Memgraph is used for:

- Deep traversal queries (find all paths between two addresses up to N hops)
- Subgraph pattern matching (detect known obfuscation subgraph structures)
- Shortest-path algorithms for trace visualization

Memgraph is NOT used for:

- Writes (all writes go to Postgres first)
- Long-term storage (the Postgres tables are the source of truth)
- Any query that must be consistent with recent writes (the 1-second lag means it's eventual)

### 5.6 Immutability Enforcement at the DB Layer

Three kinds of immutability required by locked decisions:

**G5 path immutability:** After a `TracePath` reaches `status = 'finalized'`, no UPDATE is permitted on any column except `supersedes` (which can only be set once, to point to the superseding path). Enforced via Postgres trigger:

```sql
CREATE FUNCTION enforce_path_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'finalized' AND OLD.content_hash IS NOT NULL THEN
    IF NEW.ordered_steps != OLD.ordered_steps OR NEW.name != OLD.name OR NEW.color != OLD.color THEN
      RAISE EXCEPTION 'finalized path is immutable; use supersede() to create a new version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER path_immutability_check BEFORE UPDATE ON trace_paths
FOR EACH ROW EXECUTE FUNCTION enforce_path_immutability();
```

**BeliefAtom append-only:** `belief_atoms` records are never deleted. Status transitions are one-way: `asserted → challenged → (upheld | retracted | court_grade)`. A trigger rejects any status transition that goes backward. `superseded_by` can only be set once.

**Chain-of-custody hash chain:** `chain_of_custody_records.events` is append-only within a record (new events are appended to the JSONB array). When a new event is appended, `this_record_hash` is recomputed and `prior_record_hash` is set to the previous `this_record_hash`. A trigger enforces that once set, `prior_record_hash` never changes.

---

## 6. Performance Targets and Capacity Planning

### 6.1 Latency Targets

| Operation                                      | P50 target | P99 target | Notes                                           |
| ---------------------------------------------- | ---------- | ---------- | ----------------------------------------------- |
| Transaction Inspector (cache hit)              | 50ms       | 200ms      | Mostly serialization overhead                   |
| Transaction Inspector (cold, structured only)  | 800ms      | 2,000ms    | Provider API calls                              |
| Transaction Inspector (cold, full AI sections) | 3,000ms    | 8,000ms    | LLM latency dominates                           |
| Single IOC expand (address, 1 hop)             | 200ms      | 1,000ms    | Provider + graph write                          |
| 10-hop autonomous trace                        | 8s         | 25s        | BullMQ job, SSE progress                        |
| 100-hop autonomous trace                       | 60s        | 180s       | Worker job, partial results every hop           |
| Wallet analysis (50 addresses)                 | 30s        | 90s        | Parallel provider calls, bounded by rate limits |
| Case load (open case, graph view)              | 300ms      | 800ms      | Postgres + graph node hydration                 |
| tRPC read procedures (list cases, list atoms)  | 30ms       | 150ms      | Pure Postgres, indexed                          |
| Belief State event log (1,000 events)          | 50ms       | 200ms      | Sequential scan is fine at this volume          |
| Report draft (AI-generated)                    | 45s        | 120s       | LLM + Verifier pass                             |
| Reproducibility Pack build                     | 20s        | 60s        | S3 reads + ZIP assembly                         |
| Audit log query (7 days)                       | 100ms      | 500ms      | Indexed by ts                                   |

### 6.2 Throughput and Concurrency Assumptions

**Phase 0 SaaS Blind v1 assumptions:**

- 5-15 concurrent investigators (pilot customers, single-digit agencies)
- Peak: 3 simultaneous long-running trace jobs
- Chain data volume: Ethereum-only, ~50K transactions/day touched across all cases
- Attribution provider calls: ~500/day (heavily cache-served after first week)

At these numbers, a single Fastify instance and a single Worker process on Fly.io (2 vCPU, 4 GB RAM each) is sufficient. Postgres can comfortably handle 200 concurrent connections and 50K writes/day with these schemas.

**Phase 1 scale targets:**

- 25-50 concurrent investigators
- Multi-chain (Ethereum + Bitcoin + L2s): ~200K transactions/day
- 5 simultaneous long-running jobs
- Attribution calls: ~5K/day (higher case volume, but cache hit rate ~85%)
- At this point: 2 Fastify instances, 2 Worker instances, Postgres read replica for analytics queries

**Phase 2 scale targets:**

- 100-200 concurrent investigators
- 500K transactions/day across all chains
- 15 simultaneous long-running jobs
- Attribution calls: ~20K/day
- At this point: 3-4 API instances, 4-6 Worker instances, Postgres primary + 1 read replica, sharding of `cache_entries` by scope_ref

**Postgres I/O profile:**

The heaviest table by write volume is `belief_events` (every agent action writes one event). A busy case with autonomous tracing running writes ~500 events/hour. At Phase 0 scale (5-15 concurrent cases): ~5,000 events/hour = ~1.4 events/second. Postgres handles this trivially.

The heaviest table by read volume is `cache_entries` (checked on every provider call). A hot cache at Phase 1 scale sees ~100 reads/second. With an index on `(cache_key, scope, scope_ref)` and Redis serving as the L1 cache (hot entries are also stored in Redis keyed by `cache_key`), Postgres sees only cache misses: ~5-10 reads/second.

**Read replica timing:** The need for a read replica is triggered by reporting and analytics queries (building Reproducibility Packs, cost telemetry aggregations, audit log exports) that do full-table scans on large tables. These should move to a read replica when they consistently take > 500ms and are happening more than once per minute. Expected at late Phase 1 (~month 4-5).

### 6.3 Postgres Configuration for Phase 0

Phase 0 uses **Supabase managed Postgres**. The developer does not set `postgresql.conf` parameters directly; Supabase controls the database server. The relevant configuration constraints are:

**PgBouncer pooler (transaction mode) — connection budget:**

| Client                          | Pool size           | Notes                                                           |
| ------------------------------- | ------------------- | --------------------------------------------------------------- |
| Fastify API (via `postgres.js`) | 20 connections      | Via PgBouncer pooler URL (`?pgbouncer=true`)                    |
| BullMQ Workers                  | 10 connections      | Each worker process gets its own pool                           |
| Supabase Realtime (internal)    | 5 connections       | Managed by Supabase, not configurable                           |
| Admin / migrations              | 5 connections       | Direct connection (non-pooler URL), used only during migrations |
| **Total**                       | **~40 connections** | Well within Supabase Pro plan limit (100 connections)           |

**Critical PgBouncer transaction-mode constraints:**

```typescript
// apps/api/src/plugins/db.ts — connection string selection

// Use POOLER URL for all application queries (API + Workers)
const POOLER_URL = process.env.DATABASE_URL; // pgbouncer=true
// Use DIRECT URL only for migrations and one-off admin tasks
const DIRECT_URL = process.env.DATABASE_URL_DIRECT; // no pgbouncer

// postgres.js config for PgBouncer transaction mode
const sql = postgres(POOLER_URL, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  // IMPORTANT: do NOT use prepared statements with PgBouncer transaction mode
  prepare: false,
  // IMPORTANT: do NOT use advisory locks (session-scoped, broken in tx mode)
  // Use application-level locking (Redis-based) instead
});
```

**What is NOT configurable in Supabase managed Postgres (Phase 0):**

- `wal_level`: Supabase sets `wal_level = logical` by default ✓ (needed for Memgraph CDC)
- `shared_buffers`, `work_mem`: managed by Supabase based on plan tier
- `max_connections`: PgBouncer abstracts this; the underlying Postgres can have 100+ but PgBouncer caps the effective concurrency

**Phase 2 AWS RDS configuration** (for reference — not Phase 0):

```
max_connections = 200          (API: 40 pooled via RDS Proxy, Worker: 20)
shared_buffers = 4GB           (25% of 16GB RDS db.r6g.xlarge)
effective_cache_size = 12GB
work_mem = 128MB
maintenance_work_mem = 512MB
wal_level = logical
random_page_cost = 1.1         (gp3 SSD)
```

### 6.4 Redis Memory Estimate (Phase 0)

| Use                                      | Estimated size |
| ---------------------------------------- | -------------- |
| BullMQ job data (active + recent)        | ~50 MB         |
| BullMQ job result cache (short TTL, 1h)  | ~15 MB         |
| Cache L1 (hot cache_entries, Redis copy) | ~200 MB        |
| Job progress pubsub buffers              | ~5 MB          |
| Cancel signals                           | ~1 MB          |
| **Total**                                | **~270 MB**    |

**Upstash Redis specifics (Phase 0):**

- Session management is handled entirely by Supabase Auth (JWTs + refresh tokens stored client-side as HttpOnly cookies). No server-side session store in Redis.
- Upstash Redis is accessed via HTTPS REST API (not a persistent TCP connection). The `ioredis` client uses Upstash's REST-compatible adapter. This means connection overhead per command is higher (~2–5ms) than a direct TCP Redis connection (~0.1ms), but Upstash's global edge network keeps round-trip latency acceptable for BullMQ job operations.
- **BullMQ latency note:** Upstash REST API adds ~3–8ms per Redis command vs. ~0.5ms for local Redis. For BullMQ job throughput, this caps maximum job dispatch rate at ~100 jobs/second from a single API instance — adequate for Phase 0 (< 10 concurrent users). Phase 1 can use Fly.io Redis (TCP, ~0.3ms RTT) if job throughput becomes a bottleneck.
- Upstash free tier: 10,000 commands/day. Phase 0 single-user: well within limit. Phase 0 pilot (< 10 users): upgrade to Upstash Pay-As-You-Go ($0.20/100K commands).
- An Upstash Redis instance with 256 MB is sufficient for Phase 0. Phase 1 pilot: 512 MB.

---

## 7. Error Handling and Retries

### 7.1 Error Classification

All errors in the system belong to one of four classes, each with distinct handling:

| Class         | Description                                         | Examples                                                    | Action                                                        |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| **Transient** | Temporary failure, will self-resolve                | Provider rate limit, network timeout, Redis connection blip | Retry with backoff                                            |
| **Provider**  | Provider API error that requires human intervention | Invalid API key, account suspended, endpoint deprecated     | Fail fast, alert agency admin, surface in coverage matrix     |
| **Data**      | Unexpected data shape from provider                 | Provider returns malformed JSON, chain data inconsistency   | Log, fall back to alternative, flag for investigation         |
| **Logic**     | Bug in application code                             | Null pointer, schema validation failure                     | Log with full context, fail fast, do not retry, alert on-call |

### 7.2 Retry Configuration

```typescript
// packages/capability-router/src/retry.ts

export const RETRY_CONFIG: Record<string, RetryPolicy> = {
  // Provider API calls
  provider_api: {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    backoffFactor: 2.0,
    jitter: 0.1,
    retryOn: (err) => {
      // Retry on: 429, 500, 502, 503, 504
      // Don't retry on: 400, 401, 403, 404 (these are config errors)
      if (err.status === 429) return { retry: true, delayOverride: err.retryAfterMs };
      if (err.status && err.status >= 500) return { retry: true };
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') return { retry: true };
      return { retry: false };
    },
  },

  // LLM API calls
  llm_api: {
    maxAttempts: 2,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    backoffFactor: 3.0,
    jitter: 0.2,
    retryOn: (err) => {
      if (err.status === 429) return { retry: true, delayOverride: err.retryAfterMs || 10_000 };
      if (err.status === 503) return { retry: true };
      // Never retry: 400 (bad prompt), 401 (bad key), context length errors
      return { retry: false };
    },
  },

  // Database operations (transient)
  db_transient: {
    maxAttempts: 5,
    initialDelayMs: 50,
    maxDelayMs: 2_000,
    backoffFactor: 2.0,
    jitter: 0.1,
    retryOn: (err) => {
      // Retry on: serialization failures (40001), deadlocks (40P01), connection errors
      if (err.code === '40001' || err.code === '40P01') return { retry: true };
      if (err.code === 'ECONNREFUSED') return { retry: true };
      return { retry: false };
    },
  },
};
```

### 7.3 Circuit Breaker Pattern

The Capability Router implements circuit breakers per provider install. A provider that fails 5 times in 60 seconds trips its circuit breaker, which:

1. Stops routing to that provider for 60 seconds (half-open period)
2. Falls back to the next provider in the priority chain
3. Publishes a `provider_circuit_tripped` event to the agency's alert stream
4. Records the circuit trip in the `provider_resolutions` table

After the half-open period, the next call to that provider tests the circuit. On success: circuit closes. On failure: reset the 60-second timer.

```typescript
// packages/capability-router/src/circuit-breaker.ts

export class ProviderCircuitBreaker {
  private failures: number = 0;
  private lastFailureAt: Date | null = null;
  private state: 'closed' | 'open' | 'half_open' = 'closed';

  // Must be stored in Redis for multi-process consistency
  static fromRedis(installId: string, redis: Redis): ProviderCircuitBreaker {
    /* ... */
  }

  isOpen(): boolean {
    if (this.state === 'closed') return false;
    if (this.state === 'open') {
      const halfOpenAfter = 60_000; // ms
      if (this.lastFailureAt && Date.now() - this.lastFailureAt.getTime() > halfOpenAfter) {
        this.state = 'half_open';
        return false; // try once
      }
      return true;
    }
    return false; // half_open: allow one test call
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailureAt = new Date();
    if (this.failures >= 5) this.state = 'open';
  }
}
```

### 7.4 Idempotency

All BullMQ jobs include an `idempotencyKey` (typically `SHA256(jobType + caseId + primaryArgs)`). BullMQ's `deduplication` option prevents the same job from being enqueued twice within a TTL window. For the most critical jobs (report finalization, chain-of-custody records), idempotency is also enforced at the database layer with unique constraints.

The `cache_entries` table naturally provides idempotency for provider calls: the same `(cache_key, scope, scope_ref)` cannot be written twice, and `ON CONFLICT DO UPDATE` merges the metadata.

### 7.5 Partial Result Semantics

When a long-running job fails partway through (provider outage, Worker crash, budget exhaustion), the behavior is:

- All work completed before the failure is persisted (Postgres writes were committed per-hop)
- The job status is set to `failed` with an error message
- The SSE stream receives a final `{ status: 'failed', message: '...', partialResults: true }` event
- The browser shows the partial graph with a clear "trace incomplete" indicator
- The investigator can resume the job (re-enqueue from the last successful hop) or accept the partial results
- Any BeliefAtoms emitted before the failure remain valid; they're not retracted on job failure

This is the "partial results are better than no results" principle: a 60-hop trace that fails at hop 45 is more useful than a trace that returns nothing.

### 7.6 Provider API Failure in the Critical Path

When all providers in the fallback chain for a capability fail (circuit breakers open, budget exhausted, all rate-limited), the behavior differs by operation type:

| Context                                    | Behavior                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive (Inspector, single IOC expand) | Return immediately with `{ error: 'provider_unavailable', affectedCapabilities: [...], suggestedRetryAfter: 30 }`. The investigator sees a clear message. |
| Background job (autonomous trace)          | Mark the specific capability as unavailable, skip the step, continue with available capabilities. Flag affected nodes with `data_incomplete` status.      |
| Report generation                          | Block and surface the gap: "Cannot finalize report — attribution for 3 entities is unresolvable because all attribution providers are unavailable."       |

The `capabilities_unavailable` state is always visible to the investigator. No silent degradation.

---

## 8. Capability Router Internals

### 8.1 The Contract

The Capability Router is the single point of contact between application code and any external data provider. The constraint from Part 9 of the engineering doc applies without exception: no handler, worker, or agent ever calls a provider directly. The code is:

```typescript
// Wrong — never in production code:
const data = await etherscan.getTransaction(txHash);

// Right — always through the router:
const data = await router.resolve(
  'get_tx_by_hash',
  {
    chain: 'ethereum',
    tx_hash: txHash,
  },
  context,
);
```

### 8.2 The resolve() Function — Annotated Pseudocode

```typescript
// packages/capability-router/src/router.ts

export class CapabilityRouter {
  constructor(
    private readonly db: Postgres,
    private readonly redis: Redis,
    private readonly kms: KmsClient,
  ) {}

  async resolve<T>(
    capability: string,
    args: Record<string, unknown>,
    context: AgencyContext,
    options: {
      bypassCache?: boolean; // For first-touch-live enforcement (G16)
      ttlOverride?: TtlTier; // Agency admin can override TTL tier
      budgetContext?: BudgetContext; // Per-case budget limits
    } = {},
  ): Promise<CapabilityResult<T>> {
    // ── 1. Cache check ───────────────────────────────────────────────
    const cacheKey = computeCacheKey(capability, args, context);

    if (!options.bypassCache) {
      // Check Redis L1 first (hot cache)
      const redisHit = await this.redis.get(`cache:${cacheKey}`);
      if (redisHit) {
        return {
          data: JSON.parse(redisHit) as T,
          source: 'cache_l1_redis',
          cacheHit: true,
          providerRef: null,
        };
      }

      // Check Postgres L2
      const pgHit = await this.db.queryOne<CacheEntry>(
        `SELECT * FROM cache_entries
         WHERE cache_key = $1
           AND scope = $2
           AND scope_ref = $3
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [
          cacheKey,
          determineCacheScope(capability, context),
          determineScopeRef(capability, context),
        ],
      );

      if (pgHit) {
        const dek = await this.kms.getDek(context.caseId ?? context.agencyId);
        const plain = await decryptWithDek(pgHit.response_payload, dek);
        const data = JSON.parse(plain.toString()) as T;

        // Promote to Redis L1 for hot access (5 min TTL regardless of tier)
        await this.redis.setex(`cache:${cacheKey}`, 300, JSON.stringify(data));

        // Increment hit count (async, fire-and-forget)
        this.db
          .query('UPDATE cache_entries SET hit_count = hit_count + 1 WHERE cache_key = $1', [
            cacheKey,
          ])
          .catch(logError);

        return {
          data,
          source: 'cache_l2_postgres',
          cacheHit: true,
          providerRef: pgHit.provider_install_id,
        };
      }
    }

    // ── 2. Resolve installed providers ───────────────────────────────
    const installs = await this.getInstallsForCapability(
      capability,
      context.agencyId,
      context.caseId,
    );

    if (installs.length === 0) {
      // Check if in-house fallback exists for this capability (F40)
      const inHouse = this.getInHouseFallback(capability);
      if (!inHouse) {
        throw new CapabilityUnavailableError(
          `No provider or in-house fallback for capability '${capability}'`,
          capability,
        );
      }
      return this.callInHouseFallback<T>(inHouse, args, context);
    }

    // ── 3. Iterate through priority-ordered installs ─────────────────
    let lastError: Error | null = null;

    for (const install of installs) {
      // Check circuit breaker
      const cb = await ProviderCircuitBreaker.fromRedis(install.id, this.redis);
      if (cb.isOpen()) {
        lastError = new Error(`Circuit breaker open for provider ${install.providerId}`);
        continue;
      }

      // Check budget
      if (options.budgetContext && install.budgetSpec) {
        const withinBudget = await this.checkBudget(install, options.budgetContext);
        if (!withinBudget) {
          lastError = new Error(`Budget exhausted for provider ${install.providerId}`);
          continue;
        }
      }

      // ── 4. Execute provider call with retry ──────────────────────
      try {
        const credential = await this.kms.getCredential(install.credentialRef);
        const connector = this.getConnector(install.providerId);
        const startMs = Date.now();

        const response = await withRetry(
          () => connector.call(capability, args, credential),
          RETRY_CONFIG['provider_api'],
        );

        cb.recordSuccess();

        const latencyMs = Date.now() - startMs;

        // ── 5. Persist to cache ──────────────────────────────────
        const ttlTier = options.ttlOverride ?? deriveTtlTier(capability);
        const expiresAt = computeExpiry(ttlTier);
        const scope = determineCacheScope(capability, context);
        const scopeRef = determineScopeRef(capability, context);
        const dek = await this.kms.getDek(scopeRef);
        const encrypted = await encryptWithDek(Buffer.from(JSON.stringify(response.data)), dek);

        await this.db.query(
          `
          INSERT INTO cache_entries (
            cache_key, capability, args_hash, provider_install_id,
            response_payload, response_metadata, ttl_tier, expires_at,
            scope, scope_ref, byte_size
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (cache_key, scope, scope_ref) DO UPDATE SET
            response_payload  = EXCLUDED.response_payload,
            response_metadata = EXCLUDED.response_metadata,
            fetched_at        = NOW(),
            refresh_count     = cache_entries.refresh_count + 1
        `,
          [
            cacheKey,
            capability,
            hashArgs(args),
            install.id,
            encrypted,
            JSON.stringify(response.metadata),
            ttlTier,
            expiresAt,
            scope,
            scopeRef,
            encrypted.length,
          ],
        );

        // Populate Redis L1
        await this.redis.setex(`cache:${cacheKey}`, 300, JSON.stringify(response.data));

        // ── 6. Record resolution for audit and telemetry ─────────
        await this.db.query(
          `
          INSERT INTO provider_resolutions 
            (agency_id, case_id, capability, resolved_install_id, cache_hit, latency_ms)
          VALUES ($1, $2, $3, $4, false, $5)
        `,
          [context.agencyId, context.caseId, capability, install.id, latencyMs],
        );

        return {
          data: response.data as T,
          source: `provider:${install.providerId}`,
          cacheHit: false,
          providerRef: install.id,
          latencyMs,
        };
      } catch (error) {
        cb.recordFailure();
        lastError = error as Error;

        // Log to provider_resolutions as a failure
        await this.db.query(
          `
          INSERT INTO provider_resolutions 
            (agency_id, case_id, capability, resolved_install_id, cache_hit)
          VALUES ($1, $2, $3, $4, false)
        `,
          [context.agencyId, context.caseId, capability, install.id],
        );

        // Continue to next install in fallback chain
      }
    }

    // ── 7. All providers failed → try in-house fallback ─────────────
    const inHouse = this.getInHouseFallback(capability);
    if (inHouse) {
      return this.callInHouseFallback<T>(inHouse, args, context);
    }

    // Complete failure — all providers and in-house failed
    throw new AllProvidersFailedError(
      `All providers failed for capability '${capability}': ${lastError?.message}`,
      capability,
      lastError,
    );
  }

  private async getInstallsForCapability(
    capability: string,
    agencyId: string,
    caseId?: string,
  ): Promise<AgencyProviderInstall[]> {
    return this.db.query<AgencyProviderInstall>(
      `
      SELECT * FROM agency_provider_installs
      WHERE agency_id = $1
        AND enabled = true
        AND $2 = ANY(enabled_capabilities)
        AND (
          scope = 'agency_wide' OR
          (scope = 'case_specific' AND $3 = ANY(scope_refs))
        )
      ORDER BY priority ASC
    `,
      [agencyId, capability, caseId],
    );
  }

  private determineCacheScope(capability: string): 'case' | 'agency' | 'global_chain_data' {
    // Per G15 cache scope hierarchy:
    // Immutable chain data → global_chain_data
    // Attribution data → agency
    // Case-specific computations → case
    if (IMMUTABLE_CAPABILITIES.has(capability)) return 'global_chain_data';
    if (ATTRIBUTION_CAPABILITIES.has(capability)) return 'agency';
    return 'case';
  }
}

// Capabilities that produce immutable data (same tx hash = same result forever)
const IMMUTABLE_CAPABILITIES = new Set([
  'get_tx_by_hash',
  'get_block_by_height',
  'get_tx_receipt',
  'get_internal_calls',
  'get_utxo_inputs',
  'get_utxo_outputs',
]);

// Capabilities that produce attribution data (agency-scoped cache)
const ATTRIBUTION_CAPABILITIES = new Set([
  'get_entity_attribution',
  'get_address_risk_score',
  'get_sanctions_status',
  'get_cluster_attribution',
]);
```

### 8.3 In-House Fallback Registry

Per F40, every critical capability has an in-house fallback:

```typescript
// packages/capability-router/src/inhouse.ts

export const IN_HOUSE_FALLBACKS: Record<string, InHouseCapability> = {
  get_entity_attribution: {
    implementation: 'platform_native',
    description: 'OFAC SDN + OpenSanctions + known-entity list (built-in)',
    qualityVsByok: 'baseline_only',
    enabled_by_default: true,
    handler: async (args) => {
      // Check local OFAC SDN copy (refreshed daily)
      // Check known-entity list (shipped with platform)
      // Return attribution with explicit 'in_house_baseline' source
    },
  },
  get_price_at_timestamp: {
    implementation: 'platform_native',
    description: 'Uniswap V3 TWAP + CoinGecko free tier',
    qualityVsByok: 'strong_fallback',
    enabled_by_default: true,
    handler: async (args) => {
      /* ... */
    },
  },
  decode_contract_call: {
    implementation: 'bundled_open_source',
    description: 'Sourcify + 4byte.directory + OpenChain function selector DB',
    qualityVsByok: 'strong_fallback',
    enabled_by_default: true,
    handler: async (args) => {
      /* ... */
    },
  },
  get_address_balance: {
    implementation: 'self_hostable',
    description: 'Direct archive node RPC (requires agency node setup)',
    qualityVsByok: 'primary_recommended',
    enabled_by_default: false,
    handler: async (args) => {
      /* ... */
    },
  },
};
```

---

## 9. Belief State Service Internals

### 9.1 Event Log Structure

The Belief State is the authoritative record of everything an investigation believes about the entities in a case. It is event-sourced: the current state of any `BeliefAtom` is computed by replaying its events in sequence order.

**Why event sourcing for Belief State specifically:**

1. Court-defensibility requires showing the evolution of conclusions, not just the final state
2. Retraction without deletion (G5 spirit) requires the original assertion to remain
3. The Reproducibility Pack can replay not just the final state but the exact sequence of conclusions
4. The Critic Agent needs to query "what was believed before this specific agent ran?" — easily answered from the event log

**Why not event sourcing for everything:**

- Cases, users, agents, graph nodes — these don't need the full audit trail of every field change. Standard CRUD with the audit log is sufficient. Event sourcing adds complexity without benefit for low-change-rate entities.

### 9.2 Snapshot Strategy

The event log for a long case can grow to 50,000+ events. Replaying all of them on every read is not acceptable. The snapshot strategy:

1. A background job creates a snapshot every 5,000 events (configurable)
2. The snapshot stores the full materialized state of all `BeliefAtom` records as of event N as encrypted JSON
3. A read query: find the most recent snapshot, deserialize it, then replay only the events after the snapshot's `seq_num`
4. For Phase 0 (< 5,000 events per case), no snapshots needed — always replay from scratch

```typescript
// packages/belief-state/src/snapshot.ts

export async function getSnapshotOrReplay(
  caseId: string,
  asOf: number | null, // seq_num; null = latest
  context: AgencyContext,
): Promise<CaseBeliefSnapshot> {
  const snapshot = await db.queryOne<BeliefSnapshot>(
    `SELECT * FROM belief_snapshots
     WHERE case_id = $1
       AND ($2::bigint IS NULL OR snapshot_at_seq <= $2)
     ORDER BY snapshot_at_seq DESC
     LIMIT 1`,
    [caseId, asOf],
  );

  const fromSeq = snapshot?.snapshot_at_seq ?? 0;
  const atoms: Map<string, BeliefAtom> = snapshot
    ? await deserializeSnapshot(snapshot, context)
    : new Map();

  // Replay events after the snapshot
  const events = await db.query<BeliefEvent>(
    `SELECT * FROM belief_events
     WHERE case_id = $1
       AND seq_num > $2
       AND ($3::bigint IS NULL OR seq_num <= $3)
     ORDER BY seq_num ASC`,
    [caseId, fromSeq, asOf],
  );

  for (const event of events) {
    applyEvent(atoms, event); // pure function: (Map, Event) → Map
  }

  return { atoms, asOfSeqNum: events.at(-1)?.seq_num ?? fromSeq };
}

function applyEvent(atoms: Map<string, BeliefAtom>, event: BeliefEvent): void {
  switch (event.eventType) {
    case 'BeliefAtomCreated':
      atoms.set(event.atomId, event.payload.atom);
      break;
    case 'BeliefAtomChallenged':
      const atom = atoms.get(event.atomId)!;
      atom.status = 'challenged';
      atom.challenges = [...(atom.challenges ?? []), event.payload];
      break;
    case 'BeliefAtomRetracted':
      atoms.get(event.atomId)!.status = 'retracted';
      break;
    case 'BeliefAtomPromotedToCourtGrade':
      const promoted = atoms.get(event.atomId)!;
      promoted.status = 'court_grade';
      promoted.signoffId = event.payload.signoffId;
      break;
    case 'BeliefAtomSuperseded':
      atoms.get(event.atomId)!.status = 'superseded';
      break;
    // ... other event types
  }
}
```

### 9.3 Court-Grade Signoff Enforcement

The `signoff_id IS NOT NULL` constraint (from the DDL in section 5.2) enforces G1 at the database layer. But the application layer has additional checks before even attempting to promote:

```typescript
// packages/belief-state/src/court-grade.ts

export async function promoteToCourtGrade(
  atomId: string,
  signoff: CourtGradeSignoff,
  context: AgencyContext,
): Promise<BeliefAtom> {
  const atom = await getAtom(atomId, context);
  if (!atom) throw new NotFoundError(`BeliefAtom ${atomId} not found`);

  // Precondition 1: confidence threshold (G1)
  const COURT_GRADE_CONFIDENCE_FLOOR = 0.8;
  if (atom.confidence < COURT_GRADE_CONFIDENCE_FLOOR) {
    throw new CourtGradeError(
      `Confidence ${atom.confidence} is below court-grade threshold ${COURT_GRADE_CONFIDENCE_FLOOR}`,
    );
  }

  // Precondition 2: no open challenges
  const openChallenges = await getOpenChallenges(atomId, context);
  if (openChallenges.length > 0) {
    throw new CourtGradeError(
      `Cannot promote to court-grade with ${openChallenges.length} unresolved challenge(s)`,
    );
  }

  // Precondition 3: at least 2 independent sources in provenance (B4 requirement)
  const sourceCount = countIndependentSources(atom.provenanceJson);
  if (sourceCount < 2) {
    throw new CourtGradeError(
      `Court-grade promotion requires ≥2 independent sources; atom has ${sourceCount}`,
    );
  }

  // Precondition 4: signoffId is a valid user with appropriate authority
  const signer = await getUser(signoff.investigatorId, context);
  if (!signer) throw new AuthError('Signer not found');
  if (signoff.supervisoryApprovalRequired && !signoff.supervisorSignoffId) {
    throw new CourtGradeError('This atom type requires supervisor sign-off');
  }

  // Write the promotion event
  const event = await emitEvent(
    {
      atomId,
      caseId: context.caseId!,
      eventType: 'BeliefAtomPromotedToCourtGrade',
      payload: {
        signoffId: signoff.investigatorId,
        promotedBy: context.userId,
        confidenceAtPromotion: atom.confidence,
        openChallengesAtPromotion: 0,
        sourceCount,
      },
      emittedBy: context.userId,
    },
    context,
  );

  // Write audit log
  await auditLog.write(
    {
      actor: context.userId,
      action: 'belief_atom_promoted_to_court_grade',
      targetRef: `belief_atom:${atomId}`,
      metadata: { signoffId: signoff.investigatorId, confidence: atom.confidence },
    },
    context,
  );

  return getAtom(atomId, context);
}
```

### 9.4 Critic Agent Challenge Flow

The Critic Agent runs in parallel with every other agent during autonomous operations. Its challenges arrive as calls to `beliefState.challenge()`. The flow:

```
Tracer Agent                Belief State             Critic Agent
     │                          │                         │
     │  emit(atom: A)           │                         │
     │─────────────────────────►│                         │
     │                          │ atom A written, status='asserted'
     │                          │─────────────────────────►│
     │                          │                          │ Critic receives atom A
     │                          │                          │ evaluates on 5 axes
     │                          │                          │
     │                          │◄────────────────────────│
     │                          │ challenge(atomId=A,      │
     │                          │  reason='alternative    │
     │                          │  explanation exists...')│
     │                          │                         │
     │                          │ status = 'challenged'   │
     │                          │ challenge recorded       │
     │                          │                         │
     │                          │                         │ (Critic done)
     │                          │                         │
     │◄─────────────────────────│                         │
     │ (Tracer gets notification │                         │
     │  via case:events:{caseId}│                         │
     │  channel)                │                         │
```

When the Tracer (or the orchestrator, or the human investigator) resolves the challenge, it calls `beliefState.resolveChallenge()`. If the resolution is `upheld`, the atom's status returns to `asserted`. If `superseded`, a new atom is emitted with a `supersedes` link.

Challenges from the Critic are first-class `BeliefAtomChallenge` records and appear in the UI as yellow warning badges on affected graph nodes. The investigator cannot finalize a report while open Critic challenges exist on atoms cited in that report.

### 9.5 Superseding Pattern

The superseding pattern applies to finalized (court_grade) atoms when new evidence changes the conclusion. Per G5, the original atom is never modified or deleted. The workflow:

1. Investigator calls `beliefState.supersede(originalAtomId, newAtomData)`
2. A new `BeliefAtom` is created with `tier`, `confidence`, and new `provenanceJson`
3. The original atom's `superseded_by` is set to the new atom's ID
4. A `BeliefAtomSuperseded` event is appended to the log
5. If the original atom was `court_grade`, the new atom cannot become court_grade until it passes the same promotion checks
6. Reports that cited the original atom are flagged: "this report cites a superseded atom; review required"

The original atom remains visible in the UI with a "superseded" badge and a link to the superseding atom. Courts can see the full chain of supersessions.

### 9.6 Query API Performance Notes

The two most common Belief State queries:

1. **Get all atoms for a case** — this is the initial load when opening a case. At < 5,000 events, direct table scan on `belief_atoms WHERE case_id = $1` with the index is fast enough (< 50ms).
2. **Get atoms by subject** — Inspector and graph hover queries. The compound index on `(case_id, subject_type, subject_ref)` makes this a point lookup.

The expensive query is **get the full event log for replay** (used for snapshot creation and Reproducibility Pack building). This is a sequential scan of `belief_events ORDER BY seq_num` — acceptable because it only runs during background jobs, not interactive requests.

---

## 10. Phase 0 Implementation Plan

### 10.1 Week-by-Week Backend Work

The canonical Phase 0 timeline is 8 weeks. This is the backend's share of that time, cross-referenced with the v1.0 engineering doc's build sequence.

---

**Weeks 1-2: Foundations**

The goal: a running Fastify API that can authenticate a request, create a case, and write a BeliefAtom.

_Week 1:_

- Turborepo monorepo scaffolding with TypeScript, ESLint, Prettier, `@t3-oss/env-core` for environment validation
- **Supabase local dev CLI** (`npx supabase start`): spins up local Postgres 16 (with pgvector), Supabase Auth, Storage, Realtime — replaces Docker Compose Postgres/MinIO for local development. Upstash Redis account provisioned (or local Redis via Docker for dev).
- Fastify app skeleton: `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `authPlugin` (JWKS-generic, configured with `AUTH_PROVIDER=supabase`)
- `agencyContextPlugin` wired: Supabase Auth JWT (`auth.uid()`) → `users.auth_provider_uid` lookup → Agency row → `req.agencyContext`
- tRPC setup: `@trpc/server` with Fastify adapter, first procedure: `cases.list` (returns empty array)
- Postgres schema: `agencies`, `users`, `cases` tables with RLS policies (§5.2a) — migrations managed via `supabase/migrations/` directory
- Audit log table + append-only rules + hash chaining infrastructure
- `AuditLog.write()` called on every mutation
- Supabase Storage buckets provisioned: `case-documents`, `repro-packs`, `audit-exports` (bucket-level RLS policies set)
- `storagePlugin` wired: `STORAGE_BACKEND=supabase` in `.env.local`

_Week 2:_

- `cases.create`, `cases.get`, `cases.update` tRPC procedures (full implementation)
- `iocs.add`: normalize, validate chain, write IOC record, emit BeliefAtom
- Belief State Service v0: `belief_atoms` + `belief_events` tables, `beliefState.emit()` and `beliefState.queryAtoms()`
- KMS abstraction: `KmsClient` interface with **Supabase Vault** implementation for Phase 0 SaaS (`pgsodium.crypto_aead_det_encrypt()` via Supabase Vault extension); local envelope encryption for dev (libsodium). AWS KMS deferred to Phase 2 SOC 2 migration (§0.5).
- Per-case DEK generation and encryption of `codename` and case `settings`
- Chain-of-Custody service: `CoC.record()` and `chain_of_custody_records` table
- `/health` and `/health/ready` REST endpoints

Acceptable shortcuts: Supabase Auth only (no secondary auth option — On-Prem auth deferred to Phase 1; JWKS plugin already abstracts this), no KMS key rotation yet, sync BeliefAtom emit (no event bus yet), stub CoC timestamping (no RFC 3161 yet).

---

**Weeks 3-4: Capability Router + First Chain Integration**

The goal: paste an Ethereum transaction hash, see a TransactionNode appear in the database.

_Week 3:_

- Capability Router core: `router.resolve()`, `ProviderCircuitBreaker`, retry logic, cache check/write
- `cache_entries` table + encrypted payload storage
- `AgencyProviderInstall` CRUD: `providers.install`, `providers.listInstalled`, `providers.healthCheck`
- Etherscan V2 connector: `get_tx_by_hash`, `get_address_txs`, `get_address_balance`
- `ioc.first_touch_analysis` BullMQ job: resolves an IOC, calls Etherscan, writes `TransactionNode` or `AddressNode`
- `address_nodes`, `transaction_nodes`, `graph_edges` tables
- `graph.getNodes`, `graph.getEdges` tRPC procedures

_Week 4:_

- Math Service skeleton: FastAPI app, gRPC service definition, `ComputeValueAtBlock` endpoint implemented
- `math-client` package: TypeScript gRPC client stubs from generated protobuf
- Cache L1 (Redis) layer: hot cache_entries promoted to Redis after Postgres write
- `graph.expandAddress` tRPC procedure: enqueues `trace:expand_address` job, returns jobId
- `trace:expand_address` Worker: expands one hop, writes nodes/edges, publishes progress event
- SSE subscription plumbing: `trace.subscribeProgress` tRPC subscription backed by Redis pubsub
- `providers.getCoverageMatrix` tRPC procedure

Acceptable shortcuts: One provider only (Etherscan), no fallback chain, no budget limits, gRPC over HTTP (no TLS for dev), Math Service over REST for all non-hot-path calls.

---

**Weeks 5-6: Transaction Inspector + Belief State Depth**

The goal: click a transaction, see structured facts + a plain-language summary.

_Week 5:_

- `analysis:inspector_analyze` Worker: structured facts (Section 2), decoded action (Section 3 — using Sourcify + 4byte.directory fallback)
- `inspector.analyze` tRPC: cache check → enqueue or return cached
- `inspector.saveToCase` tRPC: persist analysis to Reproducibility Pack stub
- BeliefAtom emission from Inspector: one atom per decoded action fact
- Verifier stub: checks that every sentence in the Inspector summary cites a BeliefAtom (returns flagged sentences if not)
- First LLM call: plain-language summary (Section 1) via Anthropic Claude (BYOK key from env var initially)
- `AgencyLLMInstall` added to Capability Router (LLM providers follow same pattern as data providers)

_Week 6:_

- Belief State event log: full event sourcing, `belief_events` writes for every atom mutation, `priorEventHash` chaining
- `belief.getEventLog` tRPC procedure
- `belief.challengeAtom`, `belief.resolveChallenge` tRPC procedures
- Open Challenges visible: `belief.getOpenChallenges` tRPC
- Graph queries: `graph.getNeighbors` with depth parameter
- Memgraph integration: initial sync job (Postgres CDC polling), Cypher queries for `graph.getNeighbors`
- `trace.startAutonomous` tRPC: full autonomous trace enqueue with minConfidence + maxHops
- Cancellation: `trace.cancel`, Redis cancel key, Worker checks it between hops
- Partial result persistence tested: kill a Worker mid-trace, verify graph state survives

Acceptable shortcuts: Critic Agent not yet running in parallel (defer to Phase 1), Verifier is synchronous string check not fine-tuned SLM (defer fine-tuned Verifier to Phase 2), Memgraph sync is polling not replication.

---

**Weeks 7-8: Reproducibility + Chain-of-Custody**

The goal: export a Reproducibility Pack from a completed case. Verify the hash chain.

_Week 7:_

- `ReproducibilityPack` builder: collect cache_entries, belief_events, agent_calls, rule version manifest; produce ZIP via `StorageBackend.upload()` to Supabase Storage `repro-packs` bucket; write manifest SHA-256 to `reproducibility_packs` table
- `replay.sh` generation: script that replays agent calls against frozen cached responses
- `report.buildReproPack` Worker job
- Report CRUD: `reports.list`, `reports.draft`, `reports.finalize` tRPC procedures
- Narrative Agent draft: first LLM call for report drafting (seizure affidavit template)
- Verifier gate on report finalization: block if any sentence lacks citation
- `reports.finalize` enforces G1: `signoff_id` is mandatory, checked at Postgres constraint level

_Week 8:_

- Chain-of-custody: full `CoC.record()` called from every document upload, IOC add, path creation, report finalization, export event
- CoC hash chain verification: `custody.verifyChain` tRPC procedure
- `audit.verifyChain` tRPC procedure: full audit log hash-chain verification
- Sigstore-signed release pipeline in CI (GitHub Actions)
- Supabase Storage audit-exports bucket: Object Lock via Supabase Storage policy (prevent-delete policy on `audit-exports` bucket). True WORM mode (S3 Object Lock) is deferred to Phase 2 AWS S3 migration — Supabase Storage does not natively support S3 Object Lock. Interim: bucket-level delete policy + service role key protection.
- Phase 0 demo test: paste an Ethereum tx hash → Inspector → Autonomous trace (10 hops) → Draft report → Finalize → Build Reproducibility Pack → Verify hash chain → Verify replay produces identical output

Acceptable shortcuts: Sigstore signing is Phase 0 infrastructure but the CI is not yet fully hardened (no SLSA level 2 yet), Reproducibility Pack replay doesn't cover LLM outputs (LLMs are non-deterministic; the Pack preserves inputs + outputs but replay uses frozen outputs, not live re-inference), no public chain anchoring yet (G2 is off by default).

### 10.2 What Can Wait

| Feature                            | Why it can wait                                                  | Target Phase   |
| ---------------------------------- | ---------------------------------------------------------------- | -------------- |
| Critic Agent in parallel           | Adds complexity before the Tracer is proven; defer until Phase 1 | Phase 1        |
| Fine-tuned specialist SLMs         | Generic Claude/GPT works fine for Phase 0 volume                 | Phase 1        |
| UTXO clustering (full ensemble)    | Phase 0 is Ethereum-only; Bitcoin comes in Phase 1               | Phase 1        |
| Supervisor Mode                    | No team workflows in Phase 0 pilot                               | Phase 1        |
| Wallet History Analyzer            | Deep analysis tool; Inspector is sufficient for Phase 0          | Phase 2        |
| Retraction workflow (F32)          | Rarely needed before first closed cases                          | Phase 2        |
| Memgraph replication (vs. polling) | Polling every 1 second is fine for Phase 0 volume                | Phase 1        |
| TLS on gRPC                        | Dev runs over HTTP; production uses Fly.io internal networking   | Phase 1        |
| KMS key rotation                   | First rotation needed ~6 months after key creation               | Phase 1        |
| Multi-region deployment            | Single-region Fly.io is fine for Phase 0                         | Phase 2        |
| Read replica                       | Not needed until analytics query pressure > 500ms                | Phase 1 (late) |

### 10.3 Acceptable Phase 0 Shortcuts

These are shortcuts that violate long-term architecture principles but are safe for Phase 0:

1. **One Etherscan key in env var** (not in KMS yet): Acceptable because the first pilot customer is the developer. The credential management story is built before onboarding a real customer.

2. **Sync BeliefAtom emit from API handlers**: The Belief State Service eventually becomes async (the API enqueues atom writes; a separate process flushes them). For Phase 0, sync writes are simpler to debug. The interface is the same; the transport changes in Phase 1.

3. **No rate limiting on tRPC procedures**: Phase 0 has single-digit users. Add `@fastify/rate-limit` with per-user limits before Phase 1 public launch.

4. **Generic Claude for all LLM calls**: The three-tier AI stack (Tier A SLMs, Tier B workers, Tier C frontier) is the Phase 1 implementation. Phase 0 can use Claude for everything — the BYOK routing works, just routes everything to Tier C.

5. **No gRPC TLS in local dev**: Fly.io's internal networking encrypts inter-service traffic. gRPC TLS is additive, not required for Phase 0.

6. **Polling-based Memgraph sync**: Once per second is adequate for Phase 0 case volumes. Postgres logical replication slots add operational complexity; switch in Phase 1.

---

## 11. Open Questions for this Discipline

These are specific things the backend engineer needs clarity on before writing production code in the relevant area. They are ordered by blocking urgency.

**BQ1 — KMS vendor for Phase 0 SaaS Blind** ✅ CLOSED

_Answer (confirmed by founder stack update):_ **Supabase Vault** (pgsodium / libsodium) for Phase 0 SaaS Blind. The `KmsClient` interface abstracts Supabase Vault vs. HashiCorp Vault vs. AWS KMS. Migration to AWS KMS in Phase 2 is documented in §0.5 with explicit DEK re-encryption sequencing.

_Risk to track:_ Supabase Vault DEK re-encryption in Phase 2 is the highest-risk operation in the platform lifecycle — see §0.5 step 5 for mitigation plan.

---

**BQ2 — Auth provider for Phase 0 SaaS Blind** ✅ CLOSED

_Answer (confirmed by founder stack update):_ **Supabase Auth** (not Clerk) for Phase 0 SaaS Blind. PKCE flow for Next.js, TOTP MFA, JWKS at `https://{project}.supabase.co/auth/v1/.well-known/jwks.json`.

_Migration to On-Prem:_ The `authPlugin` is JWKS-generic from Phase 0 (§0.4). On-Prem uses Ory Kratos or Keycloak. The switch is a single `AUTH_PROVIDER` env var change + `AUTH_JWKS_URL` env var update. Estimated work: 3 days to configure Kratos/Keycloak and test the JWKS endpoint. `users.clerk_user_id` has been renamed to `users.auth_provider_uid` in the DDL (§5.2).

---

**BQ3 — Postgres deployment topology for Phase 0** ✅ CLOSED

_Answer (confirmed by founder stack update):_ **Supabase managed Postgres** (AWS us-east-1, PgBouncer transaction-mode pooler). Connection via pooler URL (`?pgbouncer=true`) for application queries; direct URL for migrations only. Supabase sets `wal_level = logical` by default — Memgraph CDC is supported.

_Implications:_ PgBouncer transaction mode requires `prepare: false` in `postgres.js` config (§6.3). No advisory locks. RLS policies enforce tenant isolation (§5.2a). Migration to AWS RDS in Phase 2 documented in §0.5.

---

**BQ4 — Memgraph vs. full Postgres for Phase 0 graph queries**

The v1.0 doc picks Memgraph for graph traversal. But for Phase 0 Ethereum-only tracing (depth < 10, < 10,000 nodes per case), a recursive Postgres CTE handles the traversal without adding Memgraph as an operational dependency.

_Why it matters:_ Memgraph adds: an additional Docker container, a sync pipeline, a separate query interface (Cypher vs. SQL), and a new failure mode. For Phase 0 volumes, the benefit is marginal.

_Recommendation:_ Use recursive Postgres CTEs for Phase 0 graph traversal (`WITH RECURSIVE` on `graph_edges`). Add Memgraph in Phase 1 when traversal depth or breadth exceeds Postgres's practical limits (observed when individual case graphs exceed ~100,000 edges). This is a 2-week deferral that saves 2 weeks of initial complexity.

---

**BQ5 — BullMQ job persistence for Phase 0**

BullMQ jobs are stored in Redis. Redis is ephemeral (no durability guarantees without AOF/RDB configuration). If the Redis instance is restarted, queued jobs are lost.

_Why it matters:_ For Phase 0 with a managed Redis (Fly.io Redis with snapshot backup), this is acceptable — a restarted trace can be re-queued. But for a Phase 1 pilot with real investigators running real cases, losing a 2-hour autonomous trace job is not acceptable.

_Recommendation:_ Enable Redis AOF (append-only file) persistence in Phase 0 configuration. The Fly.io Redis already supports this. Document the recovery procedure (re-enqueue failed jobs from the API's job history view). True durability (BullMQ → Postgres-backed queue) is a Phase 2 option if Redis durability proves insufficient.

---

**BQ6 — Storage bucket structure for SaaS Blind multi-tenancy** ✅ CLOSED

_Answer (confirmed by founder stack update):_ **Supabase Storage** for Phase 0 SaaS Blind. Three shared buckets with agency-prefixed paths (not per-agency buckets — Supabase Storage manages bucket-level RLS, not per-prefix policies):

- `case-documents/{agencyId}/{caseId}/{docId}/{filename}`
- `repro-packs/{agencyId}/{caseId}/{packId}.zip`
- `audit-exports/{agencyId}/{exportId}/{filename}`

Bucket-level RLS enforces that authenticated users can only access paths within their `agencyId` prefix. The `StorageBackend` interface (§0.3) abstracts this so On-Prem can use MinIO with the same path structure. True S3 Object Lock (WORM) is deferred to Phase 2 AWS S3 migration.

---

**BQ7 — Belief State snapshot frequency**

At what event count should the system create a snapshot? The choice affects read latency on large cases and the disk cost of storing snapshots.

_Why it matters:_ Too frequent (every 100 events) → too many snapshot records, excessive S3 storage. Too infrequent (every 50,000 events) → long replay times for large cases.

_Recommendation:_ Snapshot every 5,000 events as a starting point. At Phase 0 scale, no case reaches 5,000 events, so no snapshots are created and the code path is never triggered. Monitor event counts as cases grow; adjust the threshold empirically before Phase 2.

---

**BQ8 — gRPC vs. REST between Worker and Math Service**

The design specifies gRPC for hot-path math (Inspector per-hop calculations) and REST for bulk math (full path methodology reports). In Phase 0 with Ethereum-only tracing and < 10 concurrent users, does the gRPC complexity pay off?

_Why it matters:_ gRPC requires Protobuf compilation, generated client stubs, HTTP/2 setup, and a separate build step. REST is simpler in a monorepo that's already TypeScript-first.

_Recommendation:_ Start with REST (FastAPI → Fastify internal fetch) for all Math Service calls in Phase 0. The `MathClient` interface abstracts the transport. When Inspector latency profiling shows the math service call overhead is > 10% of total Inspector latency (expected at Phase 1 scale), migrate the hot-path calls to gRPC. This is a 1-week migration when the time comes.

---

**BQ9 — Minimum viable provider count for Phase 0 demo**

The Phase 0 demo (tx hash → Inspector → trace → Pack) requires: a chain data provider (Etherscan), a price data provider (CoinGecko free tier), and a contract decoding source (Sourcify). That's 3 providers, all of which have free tiers. Is there any Phase 0 feature that requires a paid attribution provider (Chainalysis, TRM, Elliptic)?

_Why it matters:_ Phase 0 with zero paid attribution providers is attractive (zero cost to demonstrate the platform). But the platform's commercial pitch is about BYOK attribution — if the demo doesn't show attribution working, it undersells the product.

_Recommendation:_ Wire OFAC SDN (free, via OpenSanctions API) as the default attribution provider in Phase 0. This satisfies the structural requirement (attribution capability is routed through the BYOK router) and can be demonstrated to a pilot customer. Add Chainalysis/TRM as BYOK options before the first paid pilot engagement.

---

**BQ10 — How does the Content Security Policy for SaaS Blind interact with the Reproducibility Pack viewer?**

The Reproducibility Pack includes an HTML viewer for the frozen case state. If the SaaS Blind application serves the viewer, the viewer's scripts must be compatible with the API's CSP headers. If the viewer is a standalone app (opened from S3), it runs outside the API's CSP context entirely.

_Why it matters:_ The Pack viewer is not a Phase 0 deliverable (it's Phase 1 per F44 documentation). But the Pack's binary format must be designed now to support a viewer later. If the viewer will run standalone (from downloaded ZIP), the format can be simple JSON + static HTML. If it will be embedded in the API, it needs CSP-compatible scripts.

_Recommendation:_ Design the Pack as a self-contained ZIP with a standalone HTML viewer (no external resources, no inline scripts violating CSP). The viewer is a single-page app built from the pack's JSON data. This is the right architecture for On-Prem portability too: courts open the ZIP on any machine, no server required.

---

---

**BQ11 — Supabase project tier and region for Phase 0**

The design assumes Supabase project in AWS us-east-1 (same region as Fly.io `iad`). Is the Supabase Pro plan sufficient for Phase 0, or does the pilot require a Team plan for dedicated compute?

_Why it matters:_ Supabase Free tier has a 500 MB database limit and pauses inactive projects after 1 week — not suitable for a pilot. Pro tier ($25/month) gives 8 GB database, 100 GB storage, no pausing, email support. Team tier ($599/month) adds SSO, audit logs, and priority support — unlikely needed until Phase 1 pilot with real agencies.

_Recommendation:_ Supabase Pro plan for Phase 0 development. Upgrade to Team plan before onboarding a real law-enforcement agency (SOC 2 and audit log requirements in Team plan align better with the product's compliance story).

---

**BQ12 — Supabase Vault vs. application-layer encryption**

Supabase Vault uses `pgsodium` (libsodium at the database layer). The `KmsClient` interface wraps this. But there's a question of whether DEK encryption should happen at the database layer (inside Postgres, via pgsodium) or at the application layer (in the Fastify server, before the data reaches Postgres).

_Why it matters:_ Database-layer encryption (pgsodium) means the encryption happens in the Postgres process — the plaintext DEK is only ever in Postgres memory. Application-layer encryption means the Fastify server holds the DEK in Node.js memory, which is easier to audit but potentially less secure against a database-level compromise.

_Recommendation:_ Use Supabase Vault (pgsodium) for DEK storage in Phase 0 — it's the native Supabase approach and avoids the plaintext DEK passing through the application server. The `KmsClient` interface wraps `vault.create_secret()` and `vault.decrypted_secrets`. When migrating to AWS KMS in Phase 2, the DEK storage moves to AWS Secrets Manager (application-layer) — this is the higher-security choice for SOC 2.

---

**BQ13 — Supabase Realtime authorization for cross-agency deconfliction**

Deconfliction conflicts involve two agencies (`agency_id_a` and `agency_id_b`). The Realtime filter in §1.10 subscribes to `agency_id_a=eq.{agencyId}` OR `agency_id_b=eq.{agencyId}` in separate channels. But Supabase Realtime's `postgres_changes` filter does not support OR conditions in a single subscription.

_Why it matters:_ An agency could miss a conflict alert if their agency is in the `agency_id_b` position but the subscription only filters on `agency_id_a`. The current design uses two separate channel subscriptions (one per column) — this works but doubles the connection count.

_Recommendation:_ The current two-channel approach (§1.10) is correct. Alternatively, add a `notified_agency_id` column to `deconfliction_conflicts` with the single agency that should receive the alert on each side, and use that as the filter column. This is a schema design choice that should be validated before Phase 1 Supervisor Mode work begins.

---

**BQ14 — Supabase Edge Functions for lightweight endpoints**

The founder stack confirmation notes that Supabase Edge Functions could host some endpoints (while most logic stays in Fastify for On-Prem portability). What is the right boundary?

_Why it matters:_ Supabase Edge Functions run on Deno, not Node.js. They have access to the Supabase client but not to the full Fastify plugin ecosystem (no BullMQ, no gRPC, no complex middleware chains). Using them for the wrong endpoints adds Deno maintenance overhead without portability benefit.

_Recommendation:_ Limit Supabase Edge Functions to: (1) Supabase Auth webhooks (user.created → provision agency row), (2) simple data-transform functions that don't need BullMQ or the Capability Router. All tRPC procedures, all BullMQ enqueue operations, and all Capability Router calls stay in Fastify. This keeps the On-Prem deployment simple (no Deno runtime required on-prem).

---

_End of ChainSight v1.0 Backend Architecture Design_

---

> **Document metadata**  
> Version: 1.0  
> Produced by: Backend Architecture Agent  
> Reads: v1.0 engineering doc, v0.2–v0.9 design pack  
> Covers decisions: G1, G2, G5, G7, G10, G12, G14, G15, G16, G22, G23  
> Feature coverage: F1, F3, F14, F20, F22, F23, F24, F25, F26, F29, F34, F40, F42, F44, B1–B8, BYOK, DEP  
> Locks respected: all 23 G-series decisions, all 47 F-series features (as applicable to backend)  
> Open decisions flagged: BQ4, BQ5, BQ7–BQ10, BQ11–BQ14 in Section 11 (BQ1/BQ2/BQ3/BQ6 closed by stack update)  
> Stack update: Supabase Auth + Postgres + Storage + Realtime + Vault for Phase 0 SaaS Blind (folded 2026-06-16)
