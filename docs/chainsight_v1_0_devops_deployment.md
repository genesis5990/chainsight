# ChainSight v1.0 — DevOps & Deployment Design

> **Author:** Senior DevOps / Platform Engineering pass (AI agent)
> **Date:** June 2026
> **Status:** Deep-pass design — all locked decisions honored; working notes called out explicitly
>
> **Audience:** The solo developer building ChainSight, plus any future DevOps/platform hire.
>
> **Scope:** This document covers everything between "code exists on GitHub" and "an agency investigator is using ChainSight to trace a transaction." It is intentionally detailed — a solo developer has no institutional memory to fall back on, so the design must be self-documenting.
>
> **Locked decisions honored throughout:** G21 (air-gapped update path), G22 (confidential computing phasing), G23 (Sigstore for transparency log), F41 (anti-feature CI), F42 (certification roadmap ops), F43 (insurance/legal), F44 (escrow), Pillar 4 (sovereign deployment), and all four pillars. Decisions are cited by ID inline.
>
> **Stack update (June 2026):** The founder has confirmed the SaaS Blind v1 stack uses existing accounts — **Supabase** (Postgres + pgvector + Auth + Storage + Realtime + Edge Functions) and **Fly.io** (Fastify API + BullMQ workers + Python Math Service + Memgraph). No Phase 0 AWS work. The AWS migration plan now applies to **Phase 2** when SOC 2 readiness demands it, and is considerably more concrete because it migrates from known Supabase primitives to AWS equivalents.

---

## Table of Contents

1. [Local Development Environment](#1-local-development-environment)
2. [CI/CD Pipeline — GitHub Actions](#2-cicd-pipeline--github-actions)
3. [SaaS Blind v1 Deployment — Fly.io + Supabase](#3-saas-blind-v1-deployment--flyio--supabase)
4. [SaaS Blind Migration to AWS — Phase 2](#4-saas-blind-migration-to-aws--phase-2)
5. [On-Premises Installer — Phase 1+](#5-on-premises-installer--phase-1)
6. [Air-Gapped Deployment — Phase 1+ Hardened / Phase 2+ IL5/IL6](#6-air-gapped-deployment--phase-1-hardened--phase-2-il5il6)
7. [Confidential Computing Rollout — Phase 3](#7-confidential-computing-rollout--phase-3)
8. [Observability Stack](#8-observability-stack)
9. [Telemetry and the Blindness Guarantee](#9-telemetry-and-the-blindness-guarantee)
10. [Audited Support Access Infrastructure](#10-audited-support-access-infrastructure)
11. [Disaster Recovery](#11-disaster-recovery)
12. [Cost Management](#12-cost-management)
13. [Release Management](#13-release-management)
14. [Signed Releases and Sigstore](#14-signed-releases-and-sigstore)
15. [Source-Code Escrow Program — Phase 2](#15-source-code-escrow-program--phase-2)
16. [Certification Readiness Ops](#16-certification-readiness-ops)
17. [Phase 0 Ship Checklist](#17-phase-0-ship-checklist)
18. [Phase 0 Implementation Plan — Weeks 1–8](#18-phase-0-implementation-plan--weeks-18)
19. [Open Questions](#19-open-questions)

---

## 1. Local Development Environment

### 1.1 Guiding principle

A solo developer's local environment must be a complete, faithful replica of the SaaS Blind deployment. The same codebase, the same service topology, the same encryption contract — just without the cloud infrastructure. One command gets you from a freshly cloned repo to a running system. Hot-reload on every service because iteration speed is survival.

**Phase 0 stack (confirmed):** Supabase handles everything that used to require a hand-rolled Postgres container + MinIO bucket: Postgres 16 + pgvector, GoTrue Auth, Storage (object store), Realtime (WebSocket multiplexer), and Edge Functions. Docker Compose handles everything Supabase does not: Redis, Memgraph, the application services (api, web, worker, math), and the observability stack.

### 1.2 Service topology

| Service                    | Runtime                 | Notes                                                                                   |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| **Postgres 16 + pgvector** | Supabase local emulator | Includes auth schema, storage schema, realtime schema — exact replica of cloud Supabase |
| **GoTrue (Auth)**          | Supabase local emulator | JWT issuance, OAuth, MFA — same as cloud                                                |
| **Storage**                | Supabase local emulator | S3-compatible object store backed by local filesystem                                   |
| **Realtime**               | Supabase local emulator | WebSocket server for live case updates                                                  |
| **Edge Functions**         | Supabase local emulator | Deno runtime; same as Supabase Edge Functions                                           |
| **Redis**                  | Docker Compose          | BullMQ backing store, session cache                                                     |
| **Memgraph**               | Docker Compose          | Graph store; persists to a named Docker volume                                          |
| **api**                    | Docker Compose (dev)    | Fastify; mounts source with ts-node-dev hot-reload                                      |
| **web**                    | Docker Compose (dev)    | Next.js; mounts source with Next.js HMR                                                 |
| **worker**                 | Docker Compose (dev)    | BullMQ workers; ts-node-dev hot-reload                                                  |
| **math**                   | Docker Compose (dev)    | Python FastAPI + gRPC; uvicorn --reload                                                 |
| **OTEL Collector**         | Docker Compose          | Collects traces/metrics from all services                                               |
| **Grafana + Tempo + Loki** | Docker Compose          | Local observability; identical to on-prem stack                                         |

### 1.3 Repository layout (Supabase-specific structure)

```
chainsight/
  supabase/
    config.toml              # Project settings: regions, auth, storage, edge functions
    migrations/              # All SQL migrations; applied by `supabase db push`
      20260101000001_init.sql
      20260101000002_rls_policies.sql
      20260101000003_pgvector_indexes.sql
      ...
    seed.sql                 # Development fixtures; applied after migrations
    functions/               # Edge Functions (Deno TypeScript)
      _shared/
      belief-state-hook/
      provider-webhook/
    .gitignore               # supabase/.branches/ excluded

  docker-compose.yml         # Redis, Memgraph, api, web, worker, math, observability
  docker-compose.override.yml  # Dev overrides: volume mounts, hot-reload ports

  apps/
    api/                     # Fastify API
    web/                     # Next.js frontend
    worker/                  # BullMQ workers
    math/                    # Python FastAPI + gRPC
  packages/
    db/                      # Drizzle ORM schema + typed client (generated from Supabase types)
    supabase-client/         # Supabase JS client (shared across apps)
    ...
  infra/
    docker/                  # Dockerfiles per service
    helm/                    # Helm chart (Phase 1+ on-prem)
    terraform/               # AWS Terraform (Phase 2)
```

### 1.4 supabase/config.toml

```toml
# supabase/config.toml
[project]
id = "chainsight"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 16

[studio]
enabled = true
port = 54323
api_url = "http://localhost"

[ingest]
enabled = true

[storage]
enabled = true
# File size limit for case documents and reproducibility packs
file_size_limit = "500MiB"
image_transformation.enabled = false

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["https://localhost:3000"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
enable_signup = false         # Invite-only for law enforcement SaaS
double_confirm_changes = true
enable_anonymous_sign_ins = false

[auth.email]
enable_signup = false
double_confirm_changes = true
enable_confirmations = true

[auth.mfa]
max_enrolled_factors = 5

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true

[auth.mfa.webauthn]
enroll_enabled = true          # CJIS-compatible hardware key support
verify_enabled = true

[realtime]
enabled = true
ip_version = "IPv4"

[edge_runtime]
enabled = true
policy = "oneshot"
inspector_port = 8083

[analytics]
enabled = false                # No analytics in local dev; Supabase-managed telemetry disabled
```

### 1.5 RLS policies as migration files

All Row Level Security policies are checked in as SQL migration files. They are never applied ad hoc through the Supabase dashboard. This ensures:

- Policies are version-controlled and reviewable in PRs
- The same policies apply in local dev, preview branches, and production
- Policy changes can be audited with `git log`

Example migration structure:

```sql
-- supabase/migrations/20260101000002_rls_policies.sql

-- Enable RLS on all agency-scoped tables
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE iocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Cases: agency members can only see their own agency's cases
CREATE POLICY "cases_agency_isolation" ON cases
  FOR ALL
  USING (agency_id = (
    SELECT agency_id FROM investigators
    WHERE id = auth.uid()
  ));

-- Belief atoms: scoped to cases the investigator can see
CREATE POLICY "belief_atoms_via_case" ON belief_atoms
  FOR ALL
  USING (case_id IN (
    SELECT id FROM cases
    WHERE agency_id = (
      SELECT agency_id FROM investigators WHERE id = auth.uid()
    )
  ));

-- Audit log: read-only for investigators; append via service role only
CREATE POLICY "audit_log_read_agency" ON audit_log
  FOR SELECT
  USING (agency_id = (
    SELECT agency_id FROM investigators WHERE id = auth.uid()
  ));

-- Note: audit_log INSERT is performed only by the service role key,
-- never by the anon or user JWT. This enforces append-only semantics
-- from the application layer.
```

### 1.6 Bootstrap script

One command from a freshly cloned repo to a fully running local stack:

```bash
#!/usr/bin/env bash
# scripts/bootstrap.sh
set -e

echo "==> ChainSight local bootstrap"

# 1. Check prerequisites
command -v supabase >/dev/null 2>&1 || {
  echo "ERROR: Supabase CLI not found. Install: https://supabase.com/docs/guides/cli"
  exit 1
}
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not found"; exit 1; }

# 2. Install Node dependencies
echo "==> Installing dependencies..."
pnpm install

# 3. Start Supabase local stack
# This starts: Postgres, GoTrue, Storage, Realtime, Edge Functions, Studio
echo "==> Starting Supabase local stack..."
supabase start

# 4. Apply all migrations to the local database
echo "==> Applying database migrations..."
supabase db push

# 5. Load development seed data
echo "==> Loading seed data..."
supabase db reset --db-url "$(supabase status --output env | grep DB_URL | cut -d= -f2)"

# 6. Copy environment variables from Supabase output
echo "==> Writing .env.local..."
supabase status --output env > .env.supabase
# Merge with app-specific env vars
cat .env.local.template .env.supabase > apps/api/.env.local
cat .env.local.template .env.supabase > apps/web/.env.local

# 7. Start Docker Compose (Redis, Memgraph, api, web, worker, math, observability)
echo "==> Starting application services..."
docker compose up -d

echo ""
echo "==> Bootstrap complete!"
echo ""
echo "  Supabase Studio:     http://localhost:54323"
echo "  Web frontend:        http://localhost:3000"
echo "  API:                 http://localhost:3001"
echo "  Grafana:             http://localhost:3002"
echo "  Memgraph Lab:        http://localhost:3005"
echo ""
echo "  Supabase URLs (for environment variables):"
supabase status
```

### 1.7 Docker Compose (application services only)

Supabase runs via its own process manager (`supabase start`). Docker Compose handles only the application-layer services:

```yaml
# docker-compose.yml
version: '3.9'
name: chainsight

services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

  memgraph:
    image: memgraph/memgraph-platform:latest
    ports:
      - '7687:7687' # Bolt protocol
      - '3005:3000' # Memgraph Lab UI
    volumes:
      - memgraph_data:/var/lib/memgraph
      - memgraph_log:/var/log/memgraph
    environment:
      MEMGRAPH_USER: memgraph
      MEMGRAPH_PASSWORD: ${MEMGRAPH_PASSWORD:-dev_password}
    healthcheck:
      test: ['CMD', 'echo', 'RETURN 1;', '|', 'mgconsole']
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: infra/docker/api.Dockerfile
      target: development
    ports:
      - '3001:3001'
    environment:
      NODE_ENV: development
      # Supabase connection — injected from supabase status output
      SUPABASE_URL: ${SUPABASE_URL:-http://localhost:54321}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      DATABASE_URL: ${DATABASE_URL} # Direct Postgres URL for Drizzle ORM
      REDIS_URL: redis://redis:6379
      MEMGRAPH_URL: bolt://memgraph:7687
      MATH_SERVICE_URL: http://math:50051
      DEPLOYMENT_MODE: local
      TELEMETRY_ENABLED: 'false'
      KMS_PROVIDER: dev_stub # In-memory DEK stub for local dev
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
    volumes:
      - ./apps/api/src:/app/src # Hot-reload
      - ./packages:/packages
    depends_on:
      redis:
        condition: service_healthy
      memgraph:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'curl', '-sf', 'http://localhost:3001/health']
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    build:
      context: .
      dockerfile: infra/docker/web.Dockerfile
      target: development
    ports:
      - '3000:3000'
    environment:
      NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_URL:-http://localhost:54321}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      API_URL: http://api:3001
    volumes:
      - ./apps/web/src:/app/src # HMR
      - ./apps/web/public:/app/public
    depends_on:
      - api

  worker:
    build:
      context: .
      dockerfile: infra/docker/worker.Dockerfile
      target: development
    environment:
      NODE_ENV: development
      SUPABASE_URL: ${SUPABASE_URL:-http://localhost:54321}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      MEMGRAPH_URL: bolt://memgraph:7687
      MATH_SERVICE_URL: http://math:50051
      DEPLOYMENT_MODE: local
      TELEMETRY_ENABLED: 'false'
      KMS_PROVIDER: dev_stub
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
    volumes:
      - ./apps/worker/src:/app/src
      - ./packages:/packages
    depends_on:
      redis:
        condition: service_healthy

  math:
    build:
      context: .
      dockerfile: infra/docker/math.Dockerfile
      target: development
    ports:
      - '50051:50051' # gRPC
      - '8000:8000' # FastAPI HTTP (for health checks)
    volumes:
      - ./apps/math/src:/app/src # uvicorn --reload
    environment:
      ENV: development
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
    healthcheck:
      test: ['CMD', 'curl', '-sf', 'http://localhost:8000/health']
      interval: 10s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - '4317:4317' # gRPC
      - '4318:4318' # HTTP
    volumes:
      - ./infra/docker/observability/otel-collector-config.yaml:/etc/otel/config.yaml
    command: ['--config=/etc/otel/config.yaml']

  grafana:
    image: grafana/grafana:latest
    ports:
      - '3002:3000'
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_PATHS_PROVISIONING: /etc/grafana/provisioning
    volumes:
      - grafana_data:/var/lib/grafana
      - ./infra/docker/observability/grafana-provisioning:/etc/grafana/provisioning

  tempo:
    image: grafana/tempo:latest
    ports:
      - '3200:3200'
    volumes:
      - tempo_data:/var/tempo
      - ./infra/docker/observability/tempo-config.yaml:/etc/tempo/config.yaml
    command: ['-config.file=/etc/tempo/config.yaml']

  loki:
    image: grafana/loki:latest
    ports:
      - '3100:3100'
    volumes:
      - loki_data:/var/loki
      - ./infra/docker/observability/loki-config.yaml:/etc/loki/config.yaml
    command: ['-config.file=/etc/loki/config.yaml']

volumes:
  redis_data:
  memgraph_data:
  memgraph_log:
  grafana_data:
  tempo_data:
  loki_data:
```

### 1.8 Pre-commit hooks

Pre-commit hooks enforce code quality before a commit ever leaves the developer's machine:

```json
// .husky/pre-commit (via lint-staged)
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{py}": ["ruff check --fix", "black"],
    "supabase/migrations/*.sql": ["supabase db lint"],
    "**/*": ["node tools/anti-feature-check/index.js"]
  }
}
```

`supabase db lint` runs the Supabase linter against new migration files to catch missing RLS policies, missing indexes on foreign keys, and other common schema issues before the migration reaches a preview branch.

The anti-feature check (F41) runs on every file in every commit. It must pass before any commit lands.

### 1.9 Environment variable management

Local development uses `.env.local` files generated by `scripts/bootstrap.sh`. The Supabase CLI provides all Supabase-specific values via `supabase status --output env`:

```bash
# Supabase-provided (do not set manually)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJ...                      # Auto-generated for local dev
SUPABASE_SERVICE_ROLE_KEY=eyJ...              # Auto-generated for local dev
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

# Application-specific (set in .env.local.template)
REDIS_URL=redis://localhost:6379
MEMGRAPH_URL=bolt://localhost:7687
MATH_SERVICE_URL=http://localhost:50051
KMS_PROVIDER=dev_stub
TELEMETRY_ENABLED=false
DEPLOYMENT_MODE=local

# BYOK provider keys (local dev — use test/sandbox keys only)
ETHERSCAN_API_KEY=dev_...
CHAINALYSIS_API_KEY=dev_...
```

The `.env.local.template` is checked in. The generated `.env.local` files and `.env.supabase` are in `.gitignore`. The Supabase CLI rotates the local dev JWT secret on each `supabase start` — this is fine for development; production uses the Supabase project's managed JWT secret.

### 1.10 Type generation

Supabase generates TypeScript types from the database schema. This runs as part of CI and is checked in:

```bash
# Generate types from the local running instance
supabase gen types typescript --local > packages/db/src/types.ts

# Or from the remote project (for CI validation)
supabase gen types typescript \
  --project-id "${SUPABASE_PROJECT_ID}" > packages/db/src/types.ts
```

The generated `packages/db/src/types.ts` is committed. A CI check confirms that the checked-in types match what the current schema generates — if they diverge, the PR fails with a message to run `supabase gen types` and commit the result.

---

## 2. CI/CD Pipeline — GitHub Actions

### 2.1 Pipeline overview

Every code change passes through a tiered pipeline gated to its branch context:

| Trigger                      | Jobs                                                        | Supabase                              | Fly.io                    |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------- | ------------------------- |
| **Every push (any branch)**  | lint, type-check, anti-feature check, unit tests            | —                                     | —                         |
| **Pull request open/update** | all above + integration tests                               | Preview branch created                | PR review app deployed    |
| **Merge to `main`**          | build images, push to GHCR, sign with Sigstore, deploy      | Push migrations to production project | Deploy to production apps |
| **Tag `v*.*.*`**             | all above + air-gapped bundle + Helm chart + GitHub Release | —                                     | —                         |

### 2.2 Workflow files

```
.github/
  workflows/
    ci.yml          # Runs on every push: lint, type-check, anti-feature, unit tests
    pr.yml          # Runs on PR: integration tests + preview deploy
    deploy.yml      # Runs on merge to main: build, sign, push, deploy
    release.yml     # Runs on version tag: full release artifacts
```

### 2.3 ci.yml — Fast checks on every push

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches-ignore:
      - main # main handled by deploy.yml

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint type-check

  anti-feature-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Run anti-feature check (F41)
        run: node tools/anti-feature-check/index.js
        # Hard gate — any banned pattern fails the pipeline

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pnpm install --frozen-lockfile
      - run: pip install -r apps/math/requirements.txt
      - run: pnpm turbo test:unit
      - run: pytest apps/math/tests/unit/
```

### 2.4 pr.yml — Integration tests with Supabase preview branch

Per-PR integration tests run against a real Supabase preview branch (not a plain Postgres container). This mirrors exactly the schema, RLS policies, auth configuration, and storage configuration of the production project.

```yaml
# .github/workflows/pr.yml
name: PR Checks

on:
  pull_request:
    types: [opened, synchronize, reopened]

env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
  SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    outputs:
      preview_db_url: ${{ steps.branch.outputs.db_url }}
      preview_anon_key: ${{ steps.branch.outputs.anon_key }}
      preview_service_key: ${{ steps.branch.outputs.service_role_key }}

    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with: { version: latest }

      - name: Create Supabase preview branch
        id: branch
        run: |
          supabase branches create pr-${{ github.event.number }} \
            --project-ref ${{ env.SUPABASE_PROJECT_ID }} \
            --experimental

          # Poll until the branch is ready (branches take ~30s to provision)
          for i in $(seq 1 20); do
            STATUS=$(supabase branches get pr-${{ github.event.number }} \
              --project-ref ${{ env.SUPABASE_PROJECT_ID }} \
              --output json | jq -r '.status')
            [ "$STATUS" = "active" ] && break
            echo "Branch status: $STATUS (attempt $i/20)..."
            sleep 10
          done

          # Get branch connection details
          BRANCH_INFO=$(supabase branches get pr-${{ github.event.number }} \
            --project-ref ${{ env.SUPABASE_PROJECT_ID }} \
            --output json)

          echo "db_url=$(echo $BRANCH_INFO | jq -r '.db_url')" >> $GITHUB_OUTPUT
          echo "anon_key=$(echo $BRANCH_INFO | jq -r '.anon_key')" >> $GITHUB_OUTPUT
          echo "service_role_key=$(echo $BRANCH_INFO | jq -r '.service_role_key')" >> $GITHUB_OUTPUT

      - name: Apply migrations to preview branch
        run: |
          supabase db push \
            --db-url "${{ steps.branch.outputs.db_url }}"

      - name: Generate types and verify match
        run: |
          supabase gen types typescript \
            --db-url "${{ steps.branch.outputs.db_url }}" \
            > /tmp/generated-types.ts
          diff packages/db/src/types.ts /tmp/generated-types.ts || {
            echo "ERROR: Type mismatch. Run 'supabase gen types typescript --local > packages/db/src/types.ts' and commit."
            exit 1
          }

      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }

      - run: pnpm install --frozen-lockfile
      - run: pip install -r apps/math/requirements.txt

      - name: Start Redis and Memgraph for integration tests
        run: docker compose up -d redis memgraph --wait

      - name: Run integration tests (against Supabase preview branch)
        env:
          SUPABASE_URL: ${{ steps.branch.outputs.api_url }}
          SUPABASE_ANON_KEY: ${{ steps.branch.outputs.anon_key }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ steps.branch.outputs.service_key }}
          DATABASE_URL: ${{ steps.branch.outputs.db_url }}
          REDIS_URL: redis://localhost:6379
          MEMGRAPH_URL: bolt://localhost:7687
          KMS_PROVIDER: dev_stub
          TELEMETRY_ENABLED: 'false'
          DEPLOYMENT_MODE: test
        run: pnpm turbo test:integration

      - name: Cleanup preview branch on failure
        if: failure()
        run: |
          supabase branches delete pr-${{ github.event.number }} \
            --project-ref ${{ env.SUPABASE_PROJECT_ID }} --experimental

  deploy-review-app:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: success()
    env:
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

    steps:
      - uses: actions/checkout@v4

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Build and push PR image
        run: |
          docker buildx build \
            --platform linux/amd64 \
            --file infra/docker/api.Dockerfile \
            --target production \
            --tag ghcr.io/chainsight/api:pr-${{ github.event.number }}-${{ github.sha }} \
            --push \
            .

      - name: Deploy Fly.io review app for PR
        run: |
          fly deploy \
            --app chainsight-api-pr-${{ github.event.number }} \
            --image ghcr.io/chainsight/api:pr-${{ github.event.number }}-${{ github.sha }} \
            --env SUPABASE_URL=${{ needs.integration-tests.outputs.preview_api_url }} \
            --env SUPABASE_SERVICE_ROLE_KEY=${{ needs.integration-tests.outputs.preview_service_key }} \
            --ha=false \
            --strategy immediate \
            --yes  # Create app if it doesn't exist

      - name: Post review app URL to PR
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `🚀 Review app deployed:\n- **API:** https://chainsight-api-pr-${{ github.event.number }}.fly.dev\n- **Supabase preview branch:** pr-${{ github.event.number }}\n\nThis environment will be torn down when the PR is closed.`
            })

  teardown-preview:
    runs-on: ubuntu-latest
    if: github.event.action == 'closed'
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

    steps:
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Delete Supabase preview branch
        run: |
          supabase branches delete pr-${{ github.event.number }} \
            --project-ref ${{ secrets.SUPABASE_PROJECT_ID }} \
            --experimental || echo "Branch already deleted or never created"

      - name: Destroy Fly.io review app
        run: |
          fly apps destroy chainsight-api-pr-${{ github.event.number }} \
            --yes || echo "App already destroyed or never created"
```

### 2.5 deploy.yml — Merge to main

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/chainsight

permissions:
  contents: read
  packages: write
  id-token: write # Required for Sigstore keyless signing

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api, web, worker, math]

    outputs:
      api_digest: ${{ steps.push.outputs.digest }}

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push ${{ matrix.service }}
        id: push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: infra/docker/${{ matrix.service }}.Dockerfile
          target: production
          platforms: linux/amd64
          push: true
          sbom: true # Generate SBOM (included in OCI image)
          provenance: true # SLSA provenance attestation
          tags: |
            ${{ env.IMAGE_PREFIX }}/${{ matrix.service }}:latest
            ${{ env.IMAGE_PREFIX }}/${{ matrix.service }}:sha-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Install Cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign image with Sigstore (G23)
        run: |
          cosign sign --yes \
            ${{ env.IMAGE_PREFIX }}/${{ matrix.service }}@${{ steps.push.outputs.digest }}
        # Keyless signing: OIDC token from GitHub Actions → Fulcio CA → Rekor transparency log
        # No long-lived signing keys exist

  apply-db-migrations:
    runs-on: ubuntu-latest
    needs: build-and-push
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}

    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }

      - name: Link to production project
        run: |
          supabase link --project-ref ${{ env.SUPABASE_PROJECT_ID }}

      - name: Push migrations to production Supabase project
        run: |
          supabase db push
        # This applies any new migration files that haven't been applied yet.
        # Supabase tracks applied migrations in the supabase_migrations.schema_migrations table.
        # Safe to run on every deploy — no-op if migrations are already applied.

  deploy-to-fly:
    runs-on: ubuntu-latest
    needs: [build-and-push, apply-db-migrations]
    env:
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

    strategy:
      matrix:
        app:
          - name: chainsight-api
            service: api
          - name: chainsight-web
            service: web
          - name: chainsight-worker
            service: worker
          - name: chainsight-math
            service: math

    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy ${{ matrix.app.name }}
        run: |
          flyctl deploy \
            --app ${{ matrix.app.name }} \
            --image ${{ env.IMAGE_PREFIX }}/${{ matrix.app.service }}:sha-${{ github.sha }} \
            --strategy rolling \
            --wait-timeout 300
```

### 2.6 release.yml — Tag-triggered release artifacts

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write
  packages: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: Install Cosign
        uses: sigstore/cosign-installer@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Tag images with version
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          for svc in api web worker math; do
            # Re-tag the sha image with the version tag
            docker buildx imagetools create \
              --tag ghcr.io/chainsight/${svc}:${VERSION} \
              ghcr.io/chainsight/${svc}:sha-${GITHUB_SHA}
            
            # Sign the version-tagged image
            DIGEST=$(docker buildx imagetools inspect \
              ghcr.io/chainsight/${svc}:${VERSION} --format '{{.Manifest.Digest}}')
            cosign sign --yes ghcr.io/chainsight/${svc}@${DIGEST}
          done

      - name: Package Helm chart
        run: |
          helm package infra/helm/chainsight \
            --version ${GITHUB_REF_NAME#v} \
            --app-version ${GITHUB_REF_NAME#v}
          cosign sign-blob --yes \
            --output-certificate chainsight-${GITHUB_REF_NAME#v}.tgz.crt \
            --output-signature chainsight-${GITHUB_REF_NAME#v}.tgz.sig \
            chainsight-${GITHUB_REF_NAME#v}.tgz

      - name: Build air-gapped installer bundle
        run: |
          bash scripts/build-airgap-bundle.sh ${GITHUB_REF_NAME#v}
          # Bundle output: chainsight-${VERSION}-airgap.tar.gz
          cosign sign-blob --yes \
            --output-certificate chainsight-${GITHUB_REF_NAME#v}-airgap.tar.gz.crt \
            --output-signature chainsight-${GITHUB_REF_NAME#v}-airgap.tar.gz.sig \
            chainsight-${GITHUB_REF_NAME#v}-airgap.tar.gz

      - name: Generate release notes
        uses: orhun/git-cliff-action@v3
        with:
          config: git-cliff.toml
          args: --latest --strip header
        id: release_notes

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          body: ${{ steps.release_notes.outputs.content }}
          files: |
            chainsight-*.tgz
            chainsight-*.tgz.crt
            chainsight-*.tgz.sig
            chainsight-*-airgap.tar.gz
            chainsight-*-airgap.tar.gz.crt
            chainsight-*-airgap.tar.gz.sig
```

### 2.7 Anti-feature check (F41)

The anti-feature check runs on every commit and PR as a hard gate. It cannot be skipped.

```javascript
// tools/anti-feature-check/index.js
// Scans the entire codebase for F41-banned patterns.
// Add new banned patterns as they are committed to in the product design docs.

const BANNED_PATTERNS = [
  // Pattern: device fingerprinting or persistent user tracking
  {
    pattern: /fingerprint\.js|fingerprintjs/i,
    description: 'F41: Device fingerprinting library detected',
  },
  {
    pattern: /canvas\.toDataURL.*track|browser.*fingerprint.*id/i,
    description: 'F41: Canvas fingerprinting pattern detected',
  },

  // Pattern: behavioral analysis or profiling beyond investigation scope
  {
    pattern: /suspect_profile|entity_profile|behavior_score/i,
    description: 'F41: Suspect/entity behavioral profiling pattern detected',
  },

  // Pattern: third-party analytics SDKs (Mixpanel, Amplitude, Segment, etc.)
  {
    pattern: /mixpanel\.|amplitude\.|segment\.com|heap\.io|fullstory/i,
    description: 'F41: Third-party analytics SDK detected',
  },

  // Pattern: storing investigation content in external/vendor systems without encryption
  // (crude heuristic — review false positives; the principle is no plaintext case data to vendor)
  {
    pattern: /SUPABASE_ANON_KEY.*case_id|console\.log.*case_id|log.*ioc.*address/i,
    description: 'F41: Potential case data leakage to external system',
  },

  // Pattern: predictive policing inference
  {
    pattern: /risk_score.*predict|future.*crime.*probability|recidivism/i,
    description: 'F41: Predictive policing inference pattern detected',
  },
];

// ... (scanning logic walks the monorepo excluding node_modules and .git)
```

The tool exits with code 1 on any match, failing CI. Every new `BANNED_PATTERNS` entry must be added with a corresponding test case that confirms the check catches it.

### 2.8 Secret scanning

GitHub's native secret scanning is enabled on the repository. In addition, `detect-secrets` runs in the pre-commit hook:

```bash
# .husky/pre-commit (excerpt)
detect-secrets-hook --baseline .secrets.baseline
```

Any detected secret fails the commit and must be revoked before the commit can proceed.

### 2.9 Dependency scanning

Dependabot is configured for both npm and Docker base images:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: '/'
    schedule:
      interval: weekly
    groups:
      production-dependencies:
        dependency-type: production
      development-dependencies:
        dependency-type: development

  - package-ecosystem: docker
    directory: '/infra/docker'
    schedule:
      interval: weekly

  - package-ecosystem: github-actions
    directory: '/'
    schedule:
      interval: weekly
```

Trivy container scanning runs in the `deploy.yml` workflow and fails the pipeline on CRITICAL severity vulnerabilities.

---

## 3. SaaS Blind v1 Deployment — Fly.io + Supabase

### 3.1 Architecture overview

SaaS Blind Phase 0 uses two platforms:

- **Supabase (managed cloud)** — handles the full data layer: Postgres 16 + pgvector, Auth (GoTrue), Storage, Realtime, Edge Functions. No self-managed database instances.
- **Fly.io** — hosts the application layer: Fastify API, BullMQ workers, Python Math Service, Memgraph.
- **Upstash** — managed Redis for BullMQ job queues and session/cache.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INVESTIGATOR BROWSER                                                        │
│  Next.js app (Fly.io: chainsight-web)                                        │
└───────────────────────┬──────────────────────────────┬──────────────────────┘
                        │ HTTPS                        │ Supabase Realtime WS
                        ▼                              ▼
┌───────────────────────────────────┐   ┌─────────────────────────────────────┐
│  Fly.io (application layer)       │   │  Supabase (managed data layer)      │
│                                   │   │                                      │
│  chainsight-api (Fastify)         │◄──►  Postgres 16 + pgvector             │
│    ↕ gRPC                         │   │  GoTrue Auth (JWTs, MFA, WebAuthn)  │
│  chainsight-math (Python FastAPI) │   │  Storage (case docs, repro packs)   │
│    ↕ BullMQ                       │   │  Realtime (live case updates)       │
│  chainsight-worker (BullMQ)       │   │  Edge Functions (webhooks, triggers) │
│                                   │   │                                      │
│  chainsight-memgraph (Fly Volume) │   └─────────────────────────────────────┘
│                                   │
│  ──────────── Upstash ────────── │
│  Redis (BullMQ, session, cache)   │
└───────────────────────────────────┘
```

### 3.2 Supabase project configuration

The production Supabase project is provisioned once and configured via:

1. `supabase link --project-ref <project-id>` — links the local CLI to the project
2. `supabase db push` — applies all migrations in `supabase/migrations/` on every deploy
3. Supabase dashboard for project settings (auth providers, storage policies, SMTP for invite emails)

**Supabase project settings (configured once, documented for reproducibility):**

```toml
# Mirrors supabase/config.toml for production — same values as local dev

[auth]
enable_signup = false              # Invite-only
site_url = "https://app.chainsight.io"
additional_redirect_urls = ["https://app.chainsight.io"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
double_confirm_changes = true

[auth.email]
enable_signup = false
enable_confirmations = true
# SMTP configured via Resend (existing account) for invite and confirmation emails

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true

[auth.mfa.webauthn]
enroll_enabled = true
verify_enabled = true

[storage]
file_size_limit = "500MiB"
```

**Storage buckets (created via migration or Supabase CLI):**

```sql
-- In a migration file: create storage buckets programmatically
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('case-documents',    'case-documents',    false, 524288000, ARRAY['application/pdf', 'image/*', 'text/*']),
  ('repro-packs',       'repro-packs',       false, 524288000, ARRAY['application/json', 'application/zip']),
  ('audit-log-mirror',  'audit-log-mirror',  false, NULL,      ARRAY['application/json'])
ON CONFLICT (id) DO NOTHING;

-- RLS on storage objects: agency isolation
CREATE POLICY "case_documents_agency_isolation" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'case-documents'
    AND (storage.foldername(name))[1] = (
      SELECT agency_id::text FROM investigators WHERE id = auth.uid()
    )
  );
```

### 3.3 Fly.io application configuration

Each service runs as a separate Fly.io application. All four share the same GHCR-based container images.

**fly.toml files:**

```toml
# apps/api/fly.toml
app = "chainsight-api"
primary_region = "iad"      # US East; flip to "fra" for EU-first

[build]
  image = "ghcr.io/chainsight/api:latest"  # Overridden by CI deploy with sha tag

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = "stop"      # Scale to zero when idle
  auto_start_machines = true
  min_machines_running = 0         # Zero at rest; Phase 1 bump to 1
  processes = ["app"]

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/health"
  timeout = "5s"

[mounts]
  # No mounts for API — stateless; all data in Supabase + Upstash

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"

[env]
  PORT = "3001"
  NODE_ENV = "production"
  DEPLOYMENT_MODE = "saas_blind"
  TELEMETRY_ENABLED = "false"
  LOG_LEVEL = "info"
  OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector.internal:4317"
  # Supabase + Redis + KMS + provider keys set via `fly secrets set`
```

```toml
# apps/worker/fly.toml
app = "chainsight-worker"
primary_region = "iad"

[build]
  image = "ghcr.io/chainsight/worker:latest"

[processes]
  app = "node dist/main.js"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

[http_service]
  internal_port = 3002    # Health check endpoint only
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[env]
  NODE_ENV = "production"
  DEPLOYMENT_MODE = "saas_blind"
  TELEMETRY_ENABLED = "false"
```

```toml
# apps/math/fly.toml
app = "chainsight-math"
primary_region = "iad"

[build]
  image = "ghcr.io/chainsight/math:latest"

[[services]]
  internal_port = 50051    # gRPC
  protocol = "tcp"

[[vm]]
  size = "shared-cpu-2x"
  memory = "2gb"

[http_service]
  internal_port = 8000     # FastAPI health check
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[env]
  ENV = "production"
  DEPLOYMENT_MODE = "saas_blind"
```

```toml
# apps/memgraph/fly.toml
app = "chainsight-memgraph"
primary_region = "iad"

[build]
  image = "memgraph/memgraph:latest"

[mounts]
  source = "memgraph_data"
  destination = "/var/lib/memgraph"

[[vm]]
  size = "shared-cpu-2x"
  memory = "4gb"

[[services]]
  internal_port = 7687     # Bolt protocol (Fly private networking only)
  protocol = "tcp"
  # NOT exposed externally; only accessible within the Fly private network (6PN)

[env]
  MEMGRAPH_USER = "memgraph"
  # MEMGRAPH_PASSWORD set via fly secrets

[http_service]
  internal_port = 3000
  auto_stop_machines = "suspend"   # Suspend (not stop) to preserve Memgraph's in-memory state
  auto_start_machines = true
  min_machines_running = 0
```

### 3.4 Fly secrets management

All sensitive values are stored in Fly's secrets vault, not in `fly.toml` or environment files:

```bash
# Set secrets for each app (run once on initial setup; update individually on rotation)
# Supabase connection details
fly secrets set \
  SUPABASE_URL="https://<project-id>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  SUPABASE_ANON_KEY="eyJ..." \
  DATABASE_URL="postgresql://postgres.<project-id>:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \
  --app chainsight-api

# Redis (Upstash)
fly secrets set \
  REDIS_URL="rediss://:<password>@<endpoint>.upstash.io:6380" \
  --app chainsight-api

# Internal service URLs (Fly private networking)
fly secrets set \
  MATH_SERVICE_URL="http://chainsight-math.internal:50051" \
  MEMGRAPH_URL="bolt://chainsight-memgraph.internal:7687" \
  --app chainsight-api

# KMS (AWS KMS, accessed via IAM role attached to Fly machine)
fly secrets set \
  KMS_PROVIDER="awskms" \
  AWS_KMS_KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/..." \
  AWS_REGION="us-east-1" \
  --app chainsight-api

# BYOK provider API keys (example — set per provider install)
fly secrets set \
  ETHERSCAN_API_KEY="..." \
  CHAINALYSIS_API_KEY="..." \
  --app chainsight-api
```

### 3.5 Upstash Redis

Redis is provided by Upstash (managed, pay-per-request). No self-managed Redis container in production:

```
Upstash console → Create database → global (multi-region replica)
Region: us-east-1 primary (same as Fly primary region)
```

Upstash provides a TLS-only connection URL (`rediss://`). The BullMQ workers and API connect via this URL. At zero customers, Upstash costs ~$0/month (free tier: 10,000 requests/day). At pilot scale, cost is negligible.

### 3.6 Network topology

```
Internet
  │
  ├─► Fly.io Anycast → chainsight-web (Next.js)
  │     - HTTPS: 443 → internal: 3000
  │     - Supabase JS client: connects directly to Supabase for auth/realtime
  │
  └─► Fly.io Anycast → chainsight-api (Fastify)
        - HTTPS: 443 → internal: 3001
        - Supabase admin client (service role) → Supabase Postgres (pooler)
        - → chainsight-math.internal (gRPC, Fly 6PN private network)
        - → chainsight-worker.internal (BullMQ job creation via Redis)
        - → chainsight-memgraph.internal (Bolt, Fly 6PN)
        - → Upstash Redis (TLS)
        - → BYOK providers (HTTPS, capability router pattern)

Supabase (external managed service)
  ├─ Postgres pooler ← API (service role, server-side queries)
  ├─ Realtime WS ← Browser (anon JWT, row-level subscriptions)
  ├─ Storage ← API (signed URLs) and Browser (direct upload with JWT)
  ├─ Auth ← Browser (sign-in, MFA) and API (JWT verification)
  └─ Edge Functions ← Webhooks from providers, scheduled triggers
```

All Fly-to-Fly communication uses Fly's private IPv6 network (6PN). No inter-service traffic traverses the public internet.

### 3.7 Cost model at Phase 0

| Service               | Cost at zero customers  | Cost at pilot scale (5–10 agencies)               |
| --------------------- | ----------------------- | ------------------------------------------------- |
| **Supabase Pro**      | $25/month               | $25/month (base; storage and egress scale slowly) |
| **Fly.io — api**      | ~$0 (scale-to-zero)     | ~$30–60/month (shared-cpu-1x × 1–2 machines)      |
| **Fly.io — web**      | ~$0 (scale-to-zero)     | ~$20–40/month                                     |
| **Fly.io — worker**   | ~$0 (scale-to-zero)     | ~$15–30/month                                     |
| **Fly.io — math**     | ~$0 (scale-to-zero)     | ~$20–40/month                                     |
| **Fly.io — memgraph** | ~$5/month (1GB volume)  | ~$15–25/month (larger volume)                     |
| **Upstash Redis**     | ~$0 (free tier)         | ~$5–15/month                                      |
| **GitHub Actions**    | ~$0 (free tier minutes) | ~$0–10/month                                      |
| **GHCR**              | ~$0 (free tier)         | ~$0–5/month                                       |
| **Total**             | **~$30–35/month**       | **~$110–185/month**                               |

This is the cost of running the entire platform as a SaaS. AWS costs do not appear until Phase 2.

### 3.8 Phase 0 observability hosting

The observability stack (Grafana, Tempo, Loki, OTEL Collector) runs on Grafana Cloud free tier for Phase 0:

- 14-day retention
- 50GB logs
- 50GB traces
- 10k metrics series

This avoids the operational burden of self-hosting the observability stack while there are fewer than 10 customers. The OTEL Collector runs on Fly.io as a lightweight sidecar, forwarding to Grafana Cloud. Grafana Cloud is replaced with self-hosted Grafana (on AWS) during the Phase 2 migration.

### 3.9 Scale-to-zero implications and warm-up

Fly.io's `auto_stop_machines = "stop"` reduces idle cost to near-zero. The trade-off is cold-start latency (~2–5 seconds for the first request after an idle period). For Phase 0 pilot customers:

- This is acceptable during off-hours
- If a pilot customer has production SLA expectations, set `min_machines_running = 1` for the api app (~$5–10/month additional)
- The memgraph app uses `auto_stop_machines = "suspend"` rather than "stop" to preserve its in-memory state across the idle period

### 3.10 Deployment runbook (Phase 0)

```
DEPLOY TO PRODUCTION (SAAS BLIND — FLY.IO)

Normal deploy (merge to main):
  1. Merge PR → GitHub Actions build-and-push triggers automatically
  2. Watch CI: github.com/chainsight/chainsight/actions
  3. DB migrations apply first (supabase db push)
  4. Fly deploy follows (rolling strategy per service)
  5. Verify: curl -sf https://api.chainsight.io/health
  6. Check Grafana for error rate spike

Emergency rollback:
  fly releases --app chainsight-api     # Find previous sha tag
  fly deploy --app chainsight-api \
    --image ghcr.io/chainsight/api:sha-<previous-sha>

DB migration rollback:
  # Supabase migrations are forward-only by policy (Section 13.3)
  # For a bad migration: restore from Supabase PITR
  # (Supabase Pro includes PITR — contact Supabase support with timestamp)

Scale up for demo or load:
  fly scale count 2 --app chainsight-api
  fly scale vm shared-cpu-2x --app chainsight-api
```

---

## 4. SaaS Blind Migration to AWS — Phase 2

### 4.1 Migration rationale and trigger

Phase 0 SaaS Blind runs entirely on Supabase + Fly.io. This is the correct Phase 0 posture: fast to deploy, minimal operational burden, very low cost, leverages existing accounts.

**Migration trigger:** Phase 2 begins when the first government prospect requires SOC 2 Type 1 evidence **OR** when ARR crosses $100,000 — whichever comes first. The migration is a dedicated 10-week sprint that runs before new feature work begins. No migration work happens in Phase 0 or Phase 1.

**Why migrate at all?**

| Requirement                         | Supabase + Fly.io limitation                                                                                                               | AWS solution                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| SOC 2 Type 1                        | Supabase is a SaaS — auditors require that vendor controls be documented via their SOC 2 report, which exists but is not agency-controlled | RDS, ECS, S3 — all in the agency's own AWS org or ChainSight's audited AWS org |
| Data residency controls             | Supabase manages the Postgres instance; region is selectable but infrastructure is Supabase's                                              | Customer-specified AWS region; VPC isolation                                   |
| CJIS cloud requirements             | Fly.io is not FedRAMP authorized; Supabase is not FedRAMP authorized                                                                       | AWS GovCloud path is available; AWS has CJIS-compliant configurations          |
| Confidential computing (Phase 3)    | Nitro Enclaves require EC2 bare metal; not available on Fly.io or Supabase                                                                 | AWS Nitro Enclaves available on c6a, m6a instances                             |
| Per-tenant infrastructure isolation | Single Supabase project for all agencies (RLS provides logical isolation)                                                                  | Per-tenant RDS schema or database; VPC-level isolation option                  |

### 4.2 What migrates and what stays the same

**What migrates (data layer → AWS):**

| Supabase service        | AWS equivalent                                    | Notes                                            |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Postgres 16 + pgvector  | Amazon RDS for PostgreSQL                         | pg_dump/restore; carry DEKs unchanged            |
| Supabase Storage        | Amazon S3                                         | Signed URL migration; same encrypted blob format |
| Supabase Auth (GoTrue)  | Ory Kratos (self-hosted) or AWS Cognito           | WebAuthn support required; Ory Kratos preferred  |
| Supabase Realtime       | Soketi (self-hosted) or AWS API Gateway WebSocket | Realtime subscriptions re-implemented            |
| Supabase Edge Functions | AWS Lambda or ECS scheduled tasks                 | Deno → Node.js port (minor)                      |

**What migrates (application layer → AWS):**

| Fly.io service                   | AWS equivalent               | Notes                                                                                          |
| -------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| chainsight-api (Fastify)         | ECS Fargate                  | Same Docker image; deployment config changes only                                              |
| chainsight-worker (BullMQ)       | ECS Fargate                  | Same Docker image                                                                              |
| chainsight-math (Python gRPC)    | ECS Fargate                  | Same Docker image                                                                              |
| chainsight-memgraph (Fly Volume) | EC2 + EBS Volume             | Memgraph requires persistent volume; ECS Fargate does not support custom volumes at this scale |
| Upstash Redis                    | Amazon ElastiCache for Redis | Same Redis protocol; connection URL changes                                                    |

**What does NOT change:**

- Docker images (same containers deploy to ECS)
- Application source code (zero code changes)
- Supabase client calls → replaced with direct Postgres (Drizzle ORM) + custom auth (Ory Kratos JWT)
- Sigstore signing pipeline (G23)
- Anti-feature check (F41)
- RLS policies → migrated to Postgres RLS on RDS (identical SQL)
- Encryption hierarchy (per-agency DEKs, envelope encryption, AWS KMS)
- On-prem installer (unchanged, Section 5)

### 4.3 Pre-migration preparation (weeks 1–2)

Before the migration sprint begins, the following infrastructure must be ready:

```
AWS Organization setup:
  chainsight-prod account (production workloads)
  chainsight-staging account (pre-migration testing)
  chainsight-security account (CloudTrail logs, GuardDuty)

Terraform module structure (infra/terraform/):
  modules/
    rds/               # RDS Postgres
    ecs/               # ECS Fargate cluster, task definitions, services
    s3/                # S3 buckets with lifecycle, versioning, Object Lock
    kms/               # KMS keys per agency
    vpc/               # VPC, subnets, security groups
    alb/               # Application Load Balancer
    ecr/               # ECR (mirrors GHCR; AWS-internal pulls)
    elasticache/       # Redis cluster
    cloudwatch/        # Log groups, alarms
    route53/           # DNS records
  environments/
    staging/
    production/
```

Terraform state lives in S3 (chainsight-terraform-state bucket) with DynamoDB locking. State is never in the repository.

### 4.4 Migration runbook — Phase 2 (10 weeks)

#### Weeks 1–2: Staging AWS environment

```bash
# 1. Provision staging AWS environment
cd infra/terraform/environments/staging
terraform init
terraform plan -out=staging.tfplan
terraform apply staging.tfplan

# 2. Verify all AWS resources are provisioned
# RDS cluster, ECS cluster, S3 buckets, ElastiCache, ALB, etc.

# 3. Deploy application to ECS staging (same images from GHCR)
# ECS task definition pulls ghcr.io/chainsight/api:latest
# No code changes required — only environment variables change
```

#### Weeks 3–4: Postgres migration (Supabase → RDS)

The Postgres migration must preserve:

- All table data and schema
- All DEKs (wrapped with agency KMS keys — keys do NOT need to change; they are stored as ciphertext in the database)
- All RLS policies (identical SQL; RDS Postgres 16 supports the same policy syntax)
- pgvector extension (available on RDS Postgres 15+)

```bash
# Step 1: Enable logical replication on Supabase
# (Supabase Pro supports logical replication via the Replication tab)
# Configure a publication for all tables: CREATE PUBLICATION chainsight_pub FOR ALL TABLES;

# Step 2: Set up pglogical on RDS target
psql $RDS_URL -c "CREATE EXTENSION pglogical;"
psql $RDS_URL -c "SELECT pglogical.create_node('chainsight_rds', 'host=$RDS_HOST port=5432 dbname=chainsight');"

# Step 3: Initial schema migration
# Apply all supabase/migrations/*.sql to RDS in order
for migration in supabase/migrations/*.sql; do
  echo "Applying ${migration}..."
  psql $RDS_URL -f "${migration}"
done

# Step 4: Set up logical replication subscription (live sync begins)
psql $RDS_URL -c "
  SELECT pglogical.create_subscription(
    subscription_name := 'chainsight_supabase_sub',
    provider_dsn := 'host=$SUPABASE_DB_HOST port=5432 dbname=postgres user=postgres password=$SUPABASE_DB_PASSWORD',
    replication_sets := ARRAY['chainsight_pub']
  );
"

# Step 5: Monitor replication lag
psql $RDS_URL -c "
  SELECT subscription_name, received_lsn, latest_end_lsn,
         pg_size_pretty(pg_wal_lsn_diff(latest_end_lsn, received_lsn)) AS lag
  FROM pglogical.show_subscription_status();
"

# Step 6: When lag reaches < 1MB, initiate cutover
# (Cutover procedure: redirect writes to RDS, verify consistency, drop Supabase subscription)
```

**DEK preservation:** The agency DEKs are stored in the `agency_kms_config` table as ciphertext (wrapped with the agency's AWS KMS root key). Because the KMS keys are in AWS (unchanged between Phase 0 and Phase 2 — the same AWS KMS keys used in Phase 0 SaaS Blind), the DEKs are portable without re-wrapping. The migration copies the ciphertext DEKs directly.

#### Weeks 5–6: Auth migration (GoTrue → Ory Kratos)

Ory Kratos is preferred over AWS Cognito because it is self-hosted (same sovereignty posture as the rest of the stack), supports WebAuthn natively, and has a configuration-based identity schema that can model the `investigators` table structure.

```yaml
# infra/helm/kratos/values.yaml (excerpt)
kratos:
  config:
    identity:
      schemas:
        - id: investigator
          url: file:///etc/ory/kratos/identity.schema.json

    selfservice:
      flows:
        login:
          after:
            oidc:
              hooks:
                - hook: require-verified-address
        registration:
          enabled: false # Invite-only; registration is admin-initiated

    courier:
      smtp:
        connection_uri: 'smtps://resend.smtp:465?skip_ssl_verify=false'

    session:
      lifespan: '1h'

    totp:
      enabled: true

    webauthn:
      passwordless: true
      config:
        rp:
          id: 'app.chainsight.io'
          origin: 'https://app.chainsight.io'
          display_name: 'ChainSight'
```

**User migration:** Supabase GoTrue stores passwords as bcrypt hashes. Ory Kratos also supports bcrypt. The migration:

1. Export user records from Supabase `auth.users` table (id, email, encrypted_password, email_confirmed_at, created_at, metadata).
2. Import into Ory Kratos via the admin API (`POST /admin/identities`).
3. MFA enrollment (TOTP) is NOT portable — investigators must re-enroll after the migration. This is a known trade-off. Investigators are notified 2 weeks before cutover.

#### Weeks 7–8: Storage migration (Supabase Storage → S3)

```python
# scripts/migrate-storage.py
import boto3
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
s3 = boto3.client("s3", region_name="us-east-1")

BUCKETS = ["case-documents", "repro-packs", "audit-log-mirror"]

for bucket_name in BUCKETS:
    # List all objects in Supabase Storage bucket
    objects = supabase.storage.from_(bucket_name).list("", {"limit": 10000})

    for obj in objects:
        # Download from Supabase (generates a signed URL internally)
        file_data = supabase.storage.from_(bucket_name).download(obj["name"])

        # Upload to S3 with same key (preserving agency_id prefix structure)
        s3.put_object(
            Bucket=f"chainsight-{bucket_name}",
            Key=obj["name"],
            Body=file_data,
            # Objects are already encrypted with per-agency DEKs at the application level.
            # S3 SSE-KMS provides an additional encryption layer at rest.
            ServerSideEncryption="aws:kms",
            SSEKMSKeyId=AWS_KMS_KEY_ARN,
        )

        print(f"Migrated: {bucket_name}/{obj['name']}")
```

Storage migration runs in a batch job. Files are copied without re-encryption (the DEK-encrypted blobs are preserved as-is). After migration, the API's storage calls switch from the Supabase Storage SDK to the AWS S3 SDK — environment variable change, not a code change (the storage abstraction layer handles both).

#### Weeks 9–10: Realtime migration + cutover

**Realtime** is the most complex migration because investigator browsers maintain live WebSocket connections for case updates. The migration uses Soketi (self-hosted Pusher protocol implementation, deployed as ECS service):

```typescript
// The Supabase Realtime client is replaced with a Pusher-protocol client:
// packages/realtime-client/src/index.ts

// Phase 0 (Supabase Realtime):
const channel = supabase
  .channel(`case:${caseId}`)
  .on("postgres_changes", { event: "*", schema: "public", table: "belief_atoms" }, handler)
  .subscribe();

// Phase 2 (Soketi):
const pusher = new Pusher(SOKETI_APP_KEY, { wsHost: SOKETI_HOST, ... });
const channel = pusher.subscribe(`case-${caseId}`);
channel.bind("belief_atom_updated", handler);
// Server pushes events via Soketi when belief_atoms change (triggered by application code)
```

The Soketi migration requires the API to explicitly push events to the WebSocket server on belief atom changes. In Phase 0, Supabase Realtime handles this automatically via Postgres logical replication. The Phase 2 API adds explicit Soketi publish calls after write operations.

**Cutover plan:**

```
Day -7: Notify all pilot agencies of maintenance window
Day -1: Final backup snapshot from Supabase + S3 replication audit
Day 0 (cutover):
  1. Put SaaS Blind in maintenance mode (API returns 503)
  2. Verify pglogical replication lag = 0
  3. Switch API DNS to AWS ALB (Route 53 weighted routing: 0% Fly, 100% ALB)
  4. Verify RDS connectivity from ECS
  5. Run validation suite against AWS endpoint
  6. Send "migration complete" notification to agencies
  7. Remove maintenance mode
Day +7: Decommission Supabase project (after 7-day monitoring period)
Day +14: Decommission Fly.io apps
```

### 4.5 Terraform — ECS Fargate services

```hcl
# infra/terraform/modules/ecs/main.tf (excerpt)

resource "aws_ecs_cluster" "chainsight" {
  name = "chainsight-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "chainsight-api-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "ghcr.io/chainsight/api:${var.image_tag}"

      portMappings = [{ containerPort = 3001, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV",         value = "production" },
        { name = "DEPLOYMENT_MODE",  value = "saas_blind" },
        { name = "TELEMETRY_ENABLED", value = "false" },
        { name = "KMS_PROVIDER",     value = "awskms" },
        { name = "AWS_REGION",       value = var.aws_region },
      ]

      secrets = [
        # Secrets from AWS Secrets Manager — injected at container start
        { name = "DATABASE_URL",              valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "REDIS_URL",                 valueFrom = aws_secretsmanager_secret.redis_url.arn },
        { name = "JWT_SECRET",                valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
        { name = "AWS_KMS_KEY_ARN",           valueFrom = aws_secretsmanager_secret.kms_key_arn.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/chainsight/api/${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -sf http://localhost:3001/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "chainsight-api"
  cluster         = aws_ecs_cluster.chainsight.id
  task_definition = aws_ecs_task_definition.api.arn
  launch_type     = "FARGATE"
  desired_count   = var.api_desired_count  # 2 in production, 1 in staging

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}
```

### 4.6 RDS PostgreSQL configuration

```hcl
# infra/terraform/modules/rds/main.tf (excerpt)

resource "aws_rds_cluster" "chainsight" {
  cluster_identifier      = "chainsight-${var.environment}"
  engine                  = "aurora-postgresql"
  engine_version          = "16.1"
  database_name           = "chainsight"
  master_username         = "chainsight_admin"
  manage_master_user_password = true  # Secrets Manager rotation

  # Multi-AZ for production
  availability_zones      = var.availability_zones

  # Storage encryption — DEKs are application-level; this is the platform layer
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.rds.arn

  # PITR for 35-day recovery window
  backup_retention_period = 35
  preferred_backup_window = "03:00-04:00"

  # pgvector extension requires parameter group with rds.force_ssl = 1
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.chainsight.name

  skip_final_snapshot     = false
  final_snapshot_identifier = "chainsight-${var.environment}-final"

  tags = {
    "chainsight:environment" = var.environment
    "chainsight:service"     = "database"
  }
}

resource "aws_rds_cluster_parameter_group" "chainsight" {
  family = "aurora-postgresql16"
  name   = "chainsight-${var.environment}"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements,pglogical"
  }
}
```

### 4.7 Cost model at Phase 2

| Service           | Phase 0 cost           | Phase 2 cost (AWS, pilot scale)         | Phase 2 cost (AWS, 20+ customers)       |
| ----------------- | ---------------------- | --------------------------------------- | --------------------------------------- |
| Database          | Supabase Pro $25/month | Aurora PostgreSQL t4g.medium ~$65/month | Aurora PostgreSQL r6g.large ~$200/month |
| Auth              | Included in Supabase   | Ory Kratos ECS Fargate ~$20/month       | ~$40/month                              |
| Storage           | Included in Supabase   | S3 + CloudFront ~$5–20/month            | ~$30–100/month                          |
| Realtime          | Included in Supabase   | Soketi ECS Fargate ~$20/month           | ~$40/month                              |
| Application (ECS) | Fly.io ~$80–150/month  | ECS Fargate ~$150–250/month             | ~$400–800/month                         |
| Redis             | Upstash ~$5/month      | ElastiCache t4g.micro ~$25/month        | ElastiCache t3.medium ~$70/month        |
| Observability     | Grafana Cloud free     | Self-hosted on ECS ~$30/month           | ~$60/month                              |
| **Total**         | **~$110–185/month**    | **~$315–430/month**                     | **~$790–1,270/month**                   |

Phase 2 costs are ~2–3× Phase 0 costs. The increase is justified by SOC 2 compliance and government contract eligibility.

### 4.8 Open items for Phase 2 planning

These items must be resolved before the Phase 2 migration sprint begins:

1. **Auth choice final decision:** Ory Kratos vs. AWS Cognito. Ory Kratos is preferred (self-hosted, same sovereignty posture) but requires more operational investment. AWS Cognito is simpler but vendor-managed. Decision gate: Phase 1 end.

2. **Per-tenant database isolation level:** Single RDS cluster with per-agency schema isolation (via RLS and search_path) vs. separate RDS instances per agency. Single cluster is Phase 2 baseline. Separate instances is the Phase 3 option for agencies that require physical data isolation in the contract.

3. **AWS account structure for multi-region:** A single us-east-1 deployment suffices for Phase 2. Multi-region (for GDPR data residency or FedRAMP GovCloud) is Phase 3. The Terraform module structure is designed to support multi-region from the start.

4. **GitHub Actions self-hosted runners:** SOC 2 Type 1 will flag GitHub-hosted runners. Self-hosted runners on EC2 should be provisioned at the start of Phase 2. See open question D2 in Section 19.

---

## 5. On-Premises Installer — Phase 1+

### 5.1 Two install paths

On-premises customers receive two installer options to match their infrastructure:

1. **Helm chart for Kubernetes** — for customers with existing K8s clusters (enterprise, federal, large compliance teams).
2. **Docker Compose installer** — for smaller customers (local LE department, small compliance team) without K8s.

Both paths install identical software from the same signed container images. The difference is the orchestration layer, not the application.

### 5.2 What the customer must provide

| Resource             | Minimum for small deployment                                       | Recommended for full deployment                      |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| **Compute**          | 1 node: 16 vCPU, 64GB RAM (Compose path)                           | 3-node K8s cluster: 2×8 vCPU, 32GB each + 1 GPU node |
| **Storage**          | 500GB SSD for Postgres + MinIO + Memgraph                          | 2TB NVMe RAID for primary; separate backup storage   |
| **Network**          | 1Gbps internal; 100Mbps egress for BYOK provider calls             | 10Gbps internal; 1Gbps egress                        |
| **Identity**         | LDAP/AD or OIDC provider for SSO                                   | LDAP/AD with MFA enforced                            |
| **KMS**              | HashiCorp Vault (provided config included) or cloud KMS via agency | HSM-backed Vault or Thales Luna / Entrust nShield    |
| **TLS certificates** | Agency-issued or Let's Encrypt with internal ACME                  | Agency-issued certificates signed by agency PKI      |
| **DNS**              | Internal DNS entry for the deployment FQDN                         | Internal DNS with split-horizon if needed            |
| **Backup storage**   | NFS share or S3-compatible endpoint for backups                    | Separate site backup storage for DR                  |

**GPU (for local LLM inference, v0.9 AI strategy):**

- Tier A specialists (Phi-4, Qwen 3.5 8B): 1× NVIDIA A10G or A100 40GB
- Tier B workers (DeepSeek V4 Pro 37B MoE): 2× A100 80GB or H100
- Tier C frontier (Llama 4 70B or DeepSeek V4 Pro Max): 4-8× H100

GPU is not required for Phase 1. The on-prem installer works in CPU-only mode using Ollama (slower, but functional). GPU is required for air-gapped deployments where no commercial LLM API can be called.

### 5.3 Helm chart structure

```
infra/helm/chainsight/
  Chart.yaml
  values.yaml          # Defaults — customers override with values.production.yaml
  values.schema.json   # Validation schema for values
  templates/
    _helpers.tpl
    configmap.yaml
    secrets.yaml        # Reference to KMS secrets, not plaintext values
    deployments/
      api.yaml
      web.yaml
      worker.yaml
      math.yaml
    services/
      api-svc.yaml
      web-svc.yaml
      math-svc.yaml
    statefulsets/
      postgres.yaml     # Only if customer wants bundled Postgres
      redis.yaml        # Only if customer wants bundled Redis
      memgraph.yaml
    ingress.yaml
    hpa.yaml
    pdb.yaml
    serviceaccounts.yaml
    network-policies.yaml
```

**values.yaml (excerpt):**

```yaml
# infra/helm/chainsight/values.yaml

global:
  imageRegistry: 'ghcr.io/chainsight'
  imageTag: '1.0.0' # Pinned per release; customer updates manually or via deferred-update workflow
  imagePullPolicy: IfNotPresent
  storageClass: '' # Customer provides; defaults to cluster default

  # Sovereignty: no vendor telemetry by default
  telemetry:
    enabled: false
    optInDetailedMetrics: false
    vendorEndpoint: '' # Only populated if customer opts in

  # Encryption
  kms:
    provider: vault # vault | awskms | gcpkms | azurekeyvault | dev_stub
    vaultAddr: '' # Required if provider=vault
    vaultToken: '' # Use secretRef in production
    vaultPath: 'secret/chainsight'

api:
  replicaCount: 2
  resources:
    requests:
      cpu: '500m'
      memory: '1Gi'
    limits:
      cpu: '2000m'
      memory: '4Gi'
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70

  # Blind support access (per v0.7 deployment model)
  supportAccess:
    enabled: true # Scoped, audited, revocable vendor support
    auditLogRef: '' # Where to write support action logs

postgres:
  # If managed = false, customer provides the connection string
  managed: true # Set to false if customer provides their own Postgres
  host: ''
  port: 5432
  database: chainsight
  existingSecret: chainsight-db-secret

redis:
  managed: true
  host: ''
  port: 6379
  existingSecret: chainsight-redis-secret

memgraph:
  replicaCount: 1
  persistence:
    enabled: true
    size: 100Gi
    storageClass: ''

minio:
  # On-prem object storage; replace with customer's existing S3-compatible store
  managed: true
  endpoint: ''
  existingSecret: chainsight-minio-secret

ollama:
  # Optional: only needed if running local LLM inference
  enabled: false
  gpu:
    enabled: false
    count: 1
  models:
    - phi4
    - qwen2.5:8b

observability:
  # Self-hostable — all telemetry stays inside the agency
  opentelemetry:
    enabled: true
    endpoint: 'http://otel-collector:4317'
  grafana:
    enabled: true
    adminExistingSecret: chainsight-grafana-secret
  tempo:
    enabled: true
  loki:
    enabled: true
```

### 5.4 Docker Compose installer (small deployments)

For customers without Kubernetes:

```bash
# The installer is a single shell script downloaded via the release page
# or delivered on installation media (air-gapped path)

# install.sh
#!/usr/bin/env bash
set -e

CHAINSIGHT_VERSION=${1:-"1.0.0"}
INSTALL_DIR="/opt/chainsight"

echo "==> ChainSight On-Premises Installer v${CHAINSIGHT_VERSION}"
echo "    This installer requires root or sudo."

# 1. Pre-flight checks
./preflight.sh  # See Section 5.5

# 2. Extract and install Docker Compose file
mkdir -p ${INSTALL_DIR}
cp docker-compose.production.yml ${INSTALL_DIR}/
cp .env.template ${INSTALL_DIR}/.env

# 3. Pull images (online) or load from bundle (air-gapped)
if [ "${AIRGAP}" = "true" ]; then
  for img in api web worker math; do
    docker load --input images/${img}-${CHAINSIGHT_VERSION}.tar
  done
else
  docker compose --env-file ${INSTALL_DIR}/.env pull
fi

# 4. Initialize secrets (interactive or from provided config file)
./setup-secrets.sh

# 5. Initialize database
docker compose --env-file ${INSTALL_DIR}/.env run --rm api npm run db:migrate

# 6. Start services
docker compose --env-file ${INSTALL_DIR}/.env up -d

echo "==> ChainSight installation complete."
echo "    Web UI: https://${CHAINSIGHT_FQDN}"
echo "    Admin setup: https://${CHAINSIGHT_FQDN}/admin/setup"
echo ""
echo "    Next steps:"
echo "      1. Complete admin setup at the URL above"
echo "      2. Configure your KMS/Vault integration"
echo "      3. Install your BYOK provider API keys"
echo "      4. Run the validation script: ./validate.sh"
```

### 5.5 Pre-flight checks

```bash
# preflight.sh — run before installation
#!/usr/bin/env bash
set -e

ERRORS=0

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: $1 not found (required)"
    ERRORS=$((ERRORS + 1))
  fi
}

check_port() {
  if nc -z localhost "$1" 2>/dev/null; then
    echo "ERROR: Port $1 is already in use"
    ERRORS=$((ERRORS + 1))
  fi
}

check_disk() {
  AVAILABLE=$(df -BG "$1" | tail -1 | awk '{print $4}' | tr -d 'G')
  if [ "$AVAILABLE" -lt "$2" ]; then
    echo "ERROR: $1 has ${AVAILABLE}GB available; need at least ${2}GB"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "==> Pre-flight checks"

check_command docker
check_command docker-compose
check_command openssl
check_command curl

# Check Docker version
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null)
if [ "$(printf '%s\n' "24.0" "${DOCKER_VERSION}" | sort -V | head -n1)" != "24.0" ]; then
  echo "ERROR: Docker >= 24.0 required; found ${DOCKER_VERSION}"
  ERRORS=$((ERRORS + 1))
fi

# Check available memory
MEMORY_GB=$(free -g | awk '/^Mem:/{print $2}')
if [ "${MEMORY_GB}" -lt 16 ]; then
  echo "WARNING: ${MEMORY_GB}GB RAM available; 16GB+ recommended for full operation"
fi

# Check ports
check_port 5432
check_port 6379
check_port 7687
check_port 3000
check_port 3001

# Check disk space
check_disk / 200   # 200GB minimum on root
check_disk /var 50 # 50GB for Docker images and volumes

# Check TLS certificate
if [ -n "${TLS_CERT_PATH}" ]; then
  if ! openssl x509 -in "${TLS_CERT_PATH}" -noout 2>/dev/null; then
    echo "ERROR: TLS certificate at ${TLS_CERT_PATH} is invalid"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ "${ERRORS}" -gt 0 ]; then
  echo ""
  echo "Pre-flight checks failed with ${ERRORS} error(s). Resolve before proceeding."
  exit 1
fi

echo "==> Pre-flight checks passed."
```

### 5.6 Validation scripts

Post-install validation confirms the deployment is functional:

```bash
# validate.sh
#!/usr/bin/env bash
set -e

BASE_URL="https://${CHAINSIGHT_FQDN}"
TOKEN="..."  # Admin token from setup step

echo "==> Running post-install validation"

# 1. Health checks
curl -sf "${BASE_URL}/health" | jq '.status == "ok"' || exit 1
curl -sf "${BASE_URL}/api/health" | jq '.status == "ok"' || exit 1

# 2. Database connectivity
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/db-check" || exit 1

# 3. Redis connectivity
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/redis-check" || exit 1

# 4. Memgraph connectivity
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/graph-check" || exit 1

# 5. Object storage connectivity
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/storage-check" || exit 1

# 6. KMS connectivity
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/kms-check" || exit 1

# 7. Encryption round-trip
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/encryption-check" || exit 1

# 8. License validation
curl -sf -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/admin/license-check" || exit 1

echo "==> Validation passed. ChainSight is ready."
```

### 5.7 Upgrade procedure

Upgrades on-prem are customer-controlled. They receive a signed update package (see Section 6.3) and choose when to apply it.

```bash
# upgrade.sh
#!/usr/bin/env bash
set -e

NEW_VERSION="${1}"
BACKUP_DIR="/opt/chainsight/backups/pre-upgrade-${NEW_VERSION}"

echo "==> ChainSight upgrade to ${NEW_VERSION}"
echo "    This will briefly interrupt service."

# 1. Verify the update package signature (Sigstore; see Section 14)
cosign verify-blob \
  --certificate=chainsight-${NEW_VERSION}.pem \
  --signature=chainsight-${NEW_VERSION}.sig \
  chainsight-${NEW_VERSION}.tar.gz

# 2. Create pre-upgrade backup
mkdir -p "${BACKUP_DIR}"
docker compose exec -T postgres pg_dump -U chainsight chainsight | \
  gzip > "${BACKUP_DIR}/postgres-pre-upgrade.sql.gz"

# 3. Pull / load new images
if [ "${AIRGAP}" = "true" ]; then
  tar -xzf chainsight-${NEW_VERSION}.tar.gz -C /tmp/chainsight-upgrade/
  for img in api web worker math; do
    docker load --input /tmp/chainsight-upgrade/images/${img}-${NEW_VERSION}.tar
  done
else
  CHAINSIGHT_VERSION="${NEW_VERSION}" docker compose pull
fi

# 4. Run migrations (before new images start)
CHAINSIGHT_VERSION="${NEW_VERSION}" docker compose run --rm api npm run db:migrate

# 5. Rolling restart
CHAINSIGHT_VERSION="${NEW_VERSION}" docker compose up -d --remove-orphans

# 6. Validation
sleep 10
./validate.sh || {
  echo "==> Validation failed after upgrade! Rolling back..."
  ./rollback.sh "${NEW_VERSION}"
  exit 1
}

echo "==> Upgrade to ${NEW_VERSION} complete."
```

---

## 6. Air-Gapped Deployment — Phase 1+ Hardened / Phase 2+ IL5/IL6

### 6.1 Air-gapped threat model

An air-gapped ChainSight deployment operates in an environment with:

- No outbound network connectivity to ChainSight's vendor infrastructure
- No outbound connectivity to commercial LLM APIs
- No outbound connectivity to commercial data providers (BYOK calls go to agency-internal mirrors or are disabled)
- Software updates arrive via physical media or one-way data diode (G21)
- All model weights pre-loaded at installation time

This is the deployment posture for IL5/IL6 federal customers, intelligence community customers, and any agency that classifies their casework at a level where outbound data transfer is prohibited.

### 6.2 Offline installer media format

The air-gapped installer is a single `.tar.gz` bundle with a detached Sigstore signature:

```
chainsight-1.0.0-airgap.tar.gz
chainsight-1.0.0-airgap.tar.gz.sig
chainsight-1.0.0-airgap.tar.gz.crt
```

Bundle contents:

```
chainsight-1.0.0-airgap/
  install.sh               # The installer script
  preflight.sh             # Pre-flight checks
  validate.sh              # Post-install validation
  images/
    api-1.0.0.tar            # Docker image tarball (docker save output)
    web-1.0.0.tar
    worker-1.0.0.tar
    math-1.0.0.tar
    postgres-16.tar
    redis-7.tar
    memgraph-2.x.tar
    minio-latest.tar
    otel-collector-latest.tar
    grafana-latest.tar
    tempo-latest.tar
    loki-latest.tar
  models/                  # Optional; included if GPU-LLM bundle selected
    phi4.gguf
    qwen2.5-8b.gguf
    ollama-latest.tar
  helm/
    chainsight-1.0.0.tgz   # Helm chart for K8s deployments
  configs/
    docker-compose.production.yml
    .env.template
    observability/         # Grafana dashboards, OTEL config, etc.
  db/
    migrations/            # All Postgres migrations in order
  docs/
    INSTALL.md
    UPGRADE.md
    RELEASE_NOTES.md
  manifest.json            # Content hash of every file; signed separately
```

The installer loads Docker images from tarballs:

```bash
for img in api web worker math postgres redis memgraph minio otel-collector grafana tempo loki; do
  echo "Loading ${img}..."
  docker load --input images/${img}-${CHAINSIGHT_VERSION}.tar
done
```

### 6.3 Signed update packages

Air-gapped updates arrive as new installer bundles. The verification chain:

```bash
# 1. Verify the Sigstore bundle (G23)
# The customer installs the cosign binary from the initial installation media
# The transparency log entry is embedded in the .crt file for offline verification

cosign verify-blob \
  --certificate chainsight-${NEW_VERSION}-airgap.tar.gz.crt \
  --signature chainsight-${NEW_VERSION}-airgap.tar.gz.sig \
  --certificate-identity "release@chainsight.dev" \
  --certificate-oidc-issuer "https://accounts.google.com" \
  chainsight-${NEW_VERSION}-airgap.tar.gz

# 2. Verify the manifest (every file's SHA256 hash)
python3 verify_manifest.py manifest.json

# 3. Proceed with upgrade
./upgrade.sh "${NEW_VERSION}"
```

The `manifest.json` is signed separately by the same Sigstore certificate, providing double attestation of content integrity.

### 6.4 No phone-home guarantee

The air-gapped installer enforces no-phone-home at multiple layers:

**Application layer:** The `TELEMETRY_ENABLED=false` environment variable is the default in the air-gapped `.env.template`. Telemetry opt-in toggles are disabled at the admin UI level. No telemetry code paths fire when this flag is false.

**License validation (offline):** Per v0.7 Part 4, licenses validate locally using a signed license certificate. No external validation call is made. The certificate format:

```json
{
  "license_id": "lic_...",
  "agency_id": "...",
  "deployment_mode": "air_gapped",
  "features": ["...", "..."],
  "seat_count": 50,
  "valid_from": "2026-01-01",
  "valid_until": "2027-01-01",
  "signature": "..." // Vendor's Ed25519 signature over the above fields
}
```

The API validates this certificate at startup using the vendor's hardcoded public key. No network call required.

**Network layer:** The air-gapped installer configures the application to reject any outbound network attempt not explicitly configured in the BYOK provider install:

```typescript
// apps/api/src/lib/network-policy.ts
// In air-gapped mode, all outbound HTTP is blocked unless routed through
// an explicitly configured AgencyProviderInstall endpoint.
if (process.env.AIRGAP_MODE === 'true') {
  // Patch global fetch to block non-whitelisted domains
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!isAllowedByCapabilityRouter(url)) {
      throw new Error(`AIRGAP_VIOLATION: blocked outbound call to ${url}`);
    }
    return originalFetch(input, init);
  };
}
```

### 6.5 Physical media vs. one-way diode (G21)

**Decision (G21 open, resolved here with both paths supported):**

**Physical media path (USB/DVD):**

- Installer bundle copied to USB or DVD
- Customer IT team carries media to air-gapped environment
- Standard for smaller deployments and branch offices
- DVD preferred over USB for write-once integrity guarantee
- Bundle ≤ 4GB (without GPU model weights) fits on a single DVD-9

**One-way data diode path:**

- Vendor places update bundle in a transfer zone
- Customer's one-way diode (Owl Cyber Defense, Waterfall Security, or equivalent) transfers data from low-side (internet) to high-side (air-gapped)
- No reverse channel possible — physically enforced
- Used by IC and DoD customers with existing diode infrastructure
- ChainSight provides a dedicated transfer agent that monitors the drop zone and validates signatures before staging for upgrade

The installer script detects which mode is in use via `--delivery-mode physical|diode` and adjusts accordingly.

### 6.6 NVIDIA GPU integration for local LLM inference

For air-gapped deployments running AI-assisted investigation, GPU integration is required. The platform supports three inference runtimes (per v0.9 strategy):

**Ollama (default for simplicity):**

```yaml
# In on-prem values.yaml
ollama:
  enabled: true
  gpu:
    enabled: true
    count: 1
    driver: nvidia
  models:
    - name: phi4
      quantization: q4_k_m # Balanced quality/performance
    - name: qwen2.5:8b
      quantization: q4_k_m
  resources:
    limits:
      nvidia.com/gpu: 1
```

**vLLM (for production throughput):**

```yaml
# In on-prem values.yaml
vllm:
  enabled: true
  models:
    - name: deepseek-v4-pro-37b
      weights_path: /models/deepseek-v4-pro
      tensor_parallel_size: 2 # Spread across 2 GPUs
      max_model_len: 32768
  resources:
    limits:
      nvidia.com/gpu: 2
```

**NVIDIA NIM (for IL5/IL6 with NIM-certified models):**

```yaml
# In on-prem values.yaml
nim:
  enabled: true
  endpoint: 'http://nim-server:8000' # Customer-managed NIM server
  # ChainSight routes Tier C requests to NIM; Tiers A and B to vLLM
```

The capability router (Pillar 3) treats the local inference endpoint identically to any external API. Switching from commercial Anthropic to a local vLLM endpoint is a `values.yaml` change, not a code change.

**Hardware sizing guide (included in installation documentation):**

| Workload                                           | GPU minimum             | Notes                                                    |
| -------------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| Tier A specialists only (Phi-4, Qwen 8B)           | 1× A10G 24GB            | Sufficient for small team (<5 concurrent investigations) |
| Tier A + B (add DeepSeek V4 Pro 37B MoE)           | 2× A100 40GB            | Suitable for department deployment                       |
| Full three-tier stack (add Llama 4 70B for Tier C) | 4× A100 80GB or 2× H100 | Agency deployment                                        |
| IL6 high-performance                               | 8× H100                 | 4× for Tier C, 2× for Tier B, 2× for Tier A              |

---

## 7. Confidential Computing Rollout — Phase 3

### 7.1 Phase 3 rationale (G22 resolution)

Per G22, the lean is to ship envelope encryption + audited support access as the v1 floor and add confidential computing in Phase 3. This is confirmed:

- **Phase 0:** Per-tenant envelope encryption + per-agency KMS root keys + audited support access = strong privacy guarantee better than any incumbent SaaS.
- **Phase 3:** Add AWS Nitro Enclaves for the hot-path operations that must touch plaintext (Belief State writes during active investigation, Math Service calls with decrypted data).

The business rationale for Phase 3 timing: confidential computing is complex to operate and adds latency. Shipping it in Phase 3 means it reaches production alongside SOC 2 Type 2 completion and FedRAMP Moderate groundwork — the moment when federal customers doing due diligence care most about it.

### 7.2 Which services run in enclaves

Not every service needs enclave protection. The enclave boundary is drawn around the services that must process agency plaintext:

| Service                       | Enclave required | Why                                                                 |
| ----------------------------- | ---------------- | ------------------------------------------------------------------- |
| Belief State Service hot path | Yes              | Reads and writes case plaintext (BeliefAtom content)                |
| Math Service                  | Yes              | Processes decrypted financial values                                |
| LLM orchestrator proxy        | Yes              | Forwards decrypted prompts to Tier C models                         |
| Verifier Agent                | Yes              | Processes decrypted report drafts                                   |
| Narrative Agent               | Yes              | Generates from decrypted BeliefAtoms                                |
| API gateway                   | No               | Only routes encrypted data; no plaintext                            |
| Worker (BullMQ)               | No               | Only moves encrypted payloads between services                      |
| Graph store (Memgraph)        | No               | Encrypted at rest; query patterns are acceptable leakage per design |
| Cache layer                   | No               | Encrypted with per-agency DEKs; vendor reads ciphertext only        |

### 7.3 AWS Nitro Enclaves architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  ECS Fargate Task (or EC2 parent instance)                       │
│                                                                  │
│  ┌──────────────────────────────────┐   ┌──────────────────────┐│
│  │  Parent (untrusted)              │   │  Nitro Enclave       ││
│  │  - API routing                   │◄──►  - Belief State hot  ││
│  │  - Encrypted payload handling    │   │    path              ││
│  │  - No access to enclave memory   │   │  - Math Service      ││
│  └──────────────────────────────────┘   │  - LLM Proxy         ││
│                                         │                      ││
│                                         │  Attestation:        ││
│                                         │  - PCR values        ││
│                                         │  - Certificate chain ││
│                                         └──────────────────────┘│
│                                                                  │
│  The enclave has NO network interface.                           │
│  The only communication is via vsock to the parent.             │
└──────────────────────────────────────────────────────────────────┘
```

The enclave process:

1. **Enclave starts** → generates attestation document (PCR values, measurement of enclave code)
2. **Agency client initiates session** → requests attestation document from enclave via the parent's relay
3. **Agency verifies attestation** → checks PCR values against the published code hash in the Sigstore transparency log
4. **If attestation passes** → agency authorizes DEK release to the enclave via KMS `kms:Decrypt` with a condition on the enclave's attestation
5. **Enclave receives DEK** → decrypts data for processing
6. **All outputs from enclave** are re-encrypted with the agency's DEK before leaving the enclave

### 7.4 Attestation flow (customer verification)

ChainSight provides a verification tool that customers can run to confirm the enclave code matches the published release:

```bash
# chainsight-verify-enclave (shipped to customers as a standalone binary)
# Customer runs this before granting DEK access to any enclave session

./chainsight-verify-enclave \
  --enclave-endpoint https://api.chainsight.io/enclave/attestation \
  --release-version 3.0.0 \
  --transparency-log https://rekor.sigstore.dev

# Output:
# ==> Fetching enclave attestation document...
# ==> Fetching published code hash from Sigstore transparency log...
#     Entry: https://rekor.sigstore.dev/api/v1/log/entries/...
#     Signed by: release@chainsight.dev
#     Timestamp: 2026-01-15T10:00:00Z
# ==> Comparing PCR values:
#     PCR0 (enclave image): sha384:abc123... ✓ MATCH
#     PCR1 (kernel + config): sha384:def456... ✓ MATCH
#     PCR2 (application): sha384:789012... ✓ MATCH
# ==> Attestation verified. The running enclave matches the published release.
# ==> You may now authorize DEK release to this enclave session.
```

If any PCR value fails to match, the tool prints `MISMATCH` and the customer must NOT release their DEK. This is the enforceable technical guarantee that the vendor cannot deploy a backdoored version of the enclave without it being detectable.

---

## 8. Observability Stack

### 8.1 Stack overview

The observability stack is **identical between SaaS Blind and On-Premises**. This is a key sovereignty requirement: on-prem customers own all their telemetry with no dependency on vendor-operated monitoring infrastructure.

Stack:

- **OpenTelemetry Collector** — aggregation and forwarding hub
- **Tempo** — distributed tracing backend
- **Loki** — log aggregation
- **Grafana** — dashboards and alerting
- **Prometheus** (optional) — metrics scraping for on-prem deployments with existing Prometheus infrastructure

### 8.2 OpenTelemetry instrumentation

Every service emits traces, metrics, and logs via OTEL SDK:

**TypeScript services (api, worker):**

```typescript
// packages/observability/src/index.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function initTelemetry(serviceName: string) {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION,
      'chainsight.deployment_mode': process.env.DEPLOYMENT_MODE, // saas_blind | on_premises | air_gapped
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      }),
      exportIntervalMillis: 30000,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  process.on('SIGTERM', () => sdk.shutdown());
}
```

**Per-tenant span attributes:** Every API request handler adds tenant-scoped attributes to its trace span:

```typescript
// apps/api/src/middleware/telemetry.ts
import { trace } from '@opentelemetry/api';

export function tenantTelemetryMiddleware(req, reply, done) {
  const span = trace.getActiveSpan();
  if (span && req.agencyId) {
    // Tag spans with agency ID for per-tenant filtering
    // IMPORTANT: never include case data or investigation details in spans
    span.setAttributes({
      'chainsight.agency_id': req.agencyId,
      'chainsight.user_id': req.userId,
      // No case_id, no address, no tx_hash in telemetry
    });
  }
  done();
}
```

### 8.3 Grafana dashboard templates

Default dashboards ship as Grafana provisioning files:

**Overview dashboard** — `observability/grafana-dashboards/overview.json`:

- Request rate (p50, p95, p99 latency) per service
- Error rate per service
- Queue depth (BullMQ)
- Active DB connections
- Cache hit rate (Redis)
- Memory and CPU per container

**Per-tenant dashboard** — `observability/grafana-dashboards/per-tenant.json`:

- Requests per agency (anonymized)
- API cost per agency (aggregated; no case content)
- Error rate per agency
- Active sessions per agency

**AI cost dashboard** — `observability/grafana-dashboards/ai-cost.json`:

- LLM token consumption per model per role
- Provider API spend by model
- Cost per case (aggregate — no case identifiers visible to vendor)
- Cache hit rate for provider calls

**Infrastructure health dashboard** — `observability/grafana-dashboards/infra.json`:

- Postgres connection pool, WAL lag, replication lag
- Redis memory usage, eviction rate
- Memgraph query latency, cache hit rate
- MinIO/S3 request rate and error rate

### 8.4 OTEL Collector configuration

```yaml
# infra/docker/observability/otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: '0.0.0.0:4317'
      http:
        endpoint: '0.0.0.0:4318'

processors:
  # Remove any case data that accidentally made it into a span attribute
  # This is a defense-in-depth filter; instrumentation should never include case data
  attributes/scrub_case_data:
    actions:
      - key: 'case.id'
        action: delete
      - key: 'address'
        action: delete
      - key: 'tx_hash'
        action: delete
      - key: 'ioc'
        action: delete

  batch:
    timeout: 1s
    send_batch_size: 1024

  memory_limiter:
    limit_mib: 512

exporters:
  otlp/tempo:
    endpoint: 'tempo:4317'
    tls:
      insecure: true

  loki:
    endpoint: 'http://loki:3100/loki/api/v1/push'
    labels:
      attributes:
        service.name: 'service'
        chainsight.agency_id: 'agency_id'

  prometheus:
    endpoint: '0.0.0.0:8889'

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes/scrub_case_data, batch]
      exporters: [otlp/tempo]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes/scrub_case_data, batch]
      exporters: [loki]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

### 8.5 Per-tenant data isolation in metrics and logs

Grafana uses agency-scoped data sources so operators can only see their own tenant's data:

```yaml
# observability/grafana-datasources.yaml
datasources:
  - name: Tempo
    type: tempo
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: 'loki'
      serviceMap:
        datasourceUid: 'prometheus'
      lokiSearch:
        datasourceUid: 'loki'

  - name: Loki
    type: loki
    url: http://loki:3101
    jsonData:
      # SaaS Blind: each agency admin only sees their agency's logs
      # On-Prem: agency owns the entire Loki instance; all logs visible
      derivedFields:
        - name: agency_id
          matcherRegex: '"agency_id":"([^"]+)"'
          url: '${__value.raw}'
```

For SaaS Blind, Grafana's native multi-tenant support (organizations feature) ensures each agency's admin sees only their agency's data. The vendor's operations team sees aggregate metrics but not per-agency investigation-level logs (consistent with the blindness guarantee).

---

## 9. Telemetry and the Blindness Guarantee

### 9.1 What telemetry the vendor sees

This is a contractual and technical commitment (Pillar 4). The vendor's observability stack only ever sees:

**By default (no opt-in required):**
| Signal | What it contains | What it explicitly excludes |
|---|---|---|
| Uptime / error rate | HTTP status codes, latency, error class (not message) | No request bodies, no case IDs, no addresses, no LLM outputs |
| Seat count | Active users per agency (count only) | No user identities, no role assignments |
| Deployment region | Which Fly/AWS region | Nothing else |
| Software version | Semver string | Nothing else |
| Billing-relevant counters | Which feature tier is active | No case volume, no investigation details |

**What is never in vendor telemetry:**

- Case codenames, IDs, or any case identifiers
- IOC values (addresses, transaction hashes, names)
- Attribution data
- Belief State contents
- Report drafts or final reports
- Investigator identities
- Suspect or victim identities
- Provider response contents
- LLM prompt contents or outputs
- Any data that would constitute PII or investigation-sensitive information

### 9.2 The opt-in toggle implementation

The opt-in toggle is a real, auditable control. It is not a UI theater element that changes a display while sending telemetry regardless.

```typescript
// packages/telemetry/src/index.ts

interface TelemetryConfig {
  vendorOptIn: boolean; // default: false
  detailedFeatureUsage: boolean; // default: false (opt-in)
  crashReports: boolean; // default: false (opt-in)
  abTestParticipation: boolean; // default: false (opt-in)
}

class TelemetryClient {
  private config: TelemetryConfig;
  private vendorEndpoint: string | null;

  constructor(config: TelemetryConfig, vendorEndpoint: string | null) {
    this.config = config;
    // vendorEndpoint is null in air-gapped deployments; set only in SaaS Blind
    // with explicit vendor opt-in
    this.vendorEndpoint = vendorEndpoint;
  }

  // The only signals sent to vendor endpoint — strictly minimal
  async emitBillingHeartbeat(agencyId: string, activeSeats: number, tier: string) {
    if (!this.config.vendorOptIn || !this.vendorEndpoint) return;
    // This is the ONLY call to the vendor endpoint
    await fetch(`${this.vendorEndpoint}/billing/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({
        // Opaque agency token — not the agency ID itself
        agency_token: await hashAgencyId(agencyId),
        active_seats: activeSeats,
        tier: tier,
        // No case data, no user data, no investigation data
      }),
    });
  }

  // Detailed feature telemetry — only if opted in AND vendorOptIn
  async emitFeatureUsage(event: FeatureUsageEvent) {
    if (!this.config.vendorOptIn || !this.config.detailedFeatureUsage) return;
    if (!this.vendorEndpoint) return;
    // event: {feature: "case_created" | "path_styled" | ..., ts: timestamp}
    // Never includes case IDs, investigator IDs, or content
    await fetch(`${this.vendorEndpoint}/telemetry/feature`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }
}
```

The opt-in toggle change is logged to the agency's immutable audit trail:

```typescript
// When an admin changes the telemetry opt-in setting:
await auditLog.append({
  actor: adminUserId,
  action: 'TELEMETRY_OPT_IN_CHANGED',
  target_ref: `agency:${agencyId}:telemetry_config`,
  payload: { from: previousState, to: newState },
});
```

### 9.3 The OTEL collector telemetry boundary

The OTEL Collector's `attributes/scrub_case_data` processor (Section 8.4) is the technical guarantee that case data never enters the observability pipeline, even if instrumentation code has a bug. It acts as a sanitizing layer before any signal leaves the application containers.

For on-premises deployments, the OTEL collector sends data only to locally-hosted Tempo and Loki — never to an external endpoint. No vendor endpoint is configured in the on-prem Helm chart values.

---

## 10. Audited Support Access Infrastructure

### 10.1 The workflow (v0.7 Section 2.3 implementation)

When an agency on SaaS Blind requests vendor support:

1. Agency opens a support ticket via the support portal (without including case data in the ticket).
2. Vendor support team identifies the required access scope and requests an access grant.
3. Agency admin reviews the request and provisions a scoped, time-boxed token via the admin UI.
4. Vendor support performs actions within the granted scope.
5. Every action is logged in real time to the agency's audit trail — visible in the admin UI as the actions happen.
6. Token expires automatically at the configured time (minimum 1 hour, maximum 48 hours).
7. Agency can revoke at any moment.

### 10.2 Data model

```typescript
SupportAccessGrant {
  id: uuid
  agency_id: uuid
  requested_by: string         // Vendor support engineer identifier
  granted_by: investigator_id  // Agency admin who approved
  granted_at: timestamp
  expires_at: timestamp        // Hard expiry; cannot be extended without a new grant

  scopes: SupportScope[]       // What the vendor can do
  allowed_resources: string[]  // Optional: specific case IDs, tables, etc.

  status: enum                 // active | expired | revoked
  revoked_at: timestamp | null
  revoked_by: investigator_id | null

  audit_log_ref: string        // Foreign key to the audit log section for this grant
}

SupportScope {
  scope: enum  // read_logs | read_metrics | restart_services |
               // read_db_schema (no data) | read_encrypted_blobs |
               // execute_debug_script | ssh_readonly
  // Explicit NOT allowed: read plaintext case data, execute arbitrary SQL,
  // access KMS keys, modify agency configuration without agency approval
}

SupportAction {
  id: uuid
  grant_id: uuid
  actor: string                // Vendor support engineer
  action_type: enum            // read | execute | restart | query
  resource: string             // What was accessed/executed
  command_or_query: string     // Exact command or query text
  output_hash: sha256 | null   // Hash of the output (not the output itself)
  ts: timestamp
  duration_ms: int
  success: bool
}
```

### 10.3 Real-time agency audit view

The agency admin UI shows a live feed of vendor support actions:

```
SUPPORT ACCESS — ACTIVE GRANT (expires in 3h 24m)
Grant ID: grant_01J...
Granted by: Admin (J. Smith)
Scope: read_logs, read_metrics, restart_services

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIVE ACTION LOG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
14:22:03  READ LOGS      apps/api/logs  (1000 lines tail)      ✓ 0.3s
14:22:18  READ METRICS   prometheus/api_request_rate            ✓ 0.1s
14:22:45  READ LOGS      apps/worker/logs (last 500 lines)     ✓ 0.2s
14:23:12  RESTART SVC    worker (graceful drain + restart)     ✓ 8.4s
14:23:21  READ LOGS      apps/worker/logs (last 100 lines)     ✓ 0.1s

[ REVOKE ACCESS NOW ]                                [ EXPORT LOG ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The `REVOKE ACCESS NOW` button immediately invalidates the grant. Any in-flight action at the time of revocation is logged as `INTERRUPTED BY AGENCY REVOCATION`.

### 10.4 Implementation: scoped access token

The vendor support engineer receives a short-lived JWT scoped to the allowed operations:

```typescript
// Generated by the admin UI, sent to vendor support engineer via the support portal
const grantToken = jwt.sign(
  {
    sub: 'support:chainsight.dev',
    agency_id: agencyId,
    grant_id: grantId,
    scopes: grant.scopes,
    exp: Math.floor(grant.expires_at.getTime() / 1000),
  },
  GRANT_SIGNING_KEY, // Rotated per-grant; derived from agency KMS root key
  { algorithm: 'EdDSA' },
);
```

The API checks this token on every request from the support engineer:

```typescript
// apps/api/src/middleware/support-access.ts
async function checkSupportAccess(req, reply) {
  const token = req.headers['x-support-grant-token'];
  if (!token) return; // Not a support access request

  const grant = await verifySupportGrantToken(token);
  if (!grant || grant.status !== 'active') {
    return reply.status(403).send({ error: 'Invalid or expired support grant' });
  }

  // Check the requested action against the grant's scopes
  if (!grant.scopes.includes(req.supportAction)) {
    return reply.status(403).send({ error: 'Action not within grant scope' });
  }

  // Log this action to the agency's audit trail IN REAL TIME
  await auditLog.append({
    actor: `support:${grant.requested_by}`,
    action: 'SUPPORT_ACCESS_ACTION',
    target_ref: req.url,
    payload: {
      grant_id: grant.id,
      action_type: req.method,
      resource: req.url,
      command: req.body?.command,
    },
  });

  req.supportGrant = grant;
}
```

---

## 11. Disaster Recovery

### 11.1 RPO/RTO targets

| Deployment                                 | RPO            | RTO            | Notes                                                          |
| ------------------------------------------ | -------------- | -------------- | -------------------------------------------------------------- |
| SaaS Blind v1 (Fly.io, Phase 0)            | 1 hour         | 4 hours        | Single-region; limited DR posture                              |
| SaaS Blind v2 (AWS, Phase 1+)              | 15 minutes     | 1 hour         | Multi-AZ; automated failover                                   |
| SaaS Blind v3 (AWS multi-region, Phase 2+) | 5 minutes      | 30 minutes     | Cross-region replication                                       |
| On-Premises                                | Agency-defined | Agency-defined | DR is the agency's responsibility; ChainSight provides scripts |

These are targets, not guarantees. The SLAs in the MSA reflect them.

### 11.2 Backup cadence

**Postgres (primary data store):**

- Continuous WAL archiving to S3/Tigris (point-in-time recovery)
- Daily full backup snapshot (retained for 30 days)
- Weekly backup verified by restore to a test instance and hash comparison
- On-premises: customer configures backup destination; ChainSight provides backup scripts

**Redis:**

- RDB snapshot every 15 minutes to S3/Tigris
- AOF enabled with `appendfsync everysec`
- Redis is reconstructible from Postgres for most data (sessions and in-flight queues are the only state not in Postgres); point-in-time restore is a fallback, not the primary recovery path

**Memgraph:**

- Nightly `DUMP DATABASE` to MinIO/S3 via a BullMQ scheduled job
- Memgraph data is reconstructible from Postgres (the graph is a derived view of the case data); the nightly dump accelerates recovery

**S3/Tigris (object storage):**

- S3 Object Lock (WORM) enabled on audit log buckets
- Cross-region replication enabled for case documents and Reproducibility Packs (Phase 1+)
- Versioning enabled on all buckets; delete markers on accidental deletion

**Audit logs:**

- Append-only Postgres table with hash-chained entries
- Mirrored to S3 with Object Lock on every write (per v1.0 engineering doc)
- Optional Merkle root anchoring to public chain at case-close (opt-in, per G2)

### 11.3 Per-agency restore

Reproducibility Pack architecture makes per-agency restore first-class. For each agency:

1. **Case data restore** — from Postgres point-in-time recovery, filtered to the agency's rows via `agency_id`
2. **Object storage restore** — from S3 versioning, scoped to the agency's bucket prefix
3. **Memgraph restore** — from the nightly dump; data for other agencies is ignored during restore
4. **DEK integrity** — after restore, the agency's KMS root key is validated against a fresh encrypt/decrypt round-trip to confirm key integrity

Per-agency restore script:

```bash
# scripts/restore-agency.sh
#!/usr/bin/env bash
set -e

AGENCY_ID="${1}"
RESTORE_POINT="${2}"  # ISO timestamp or "latest"

echo "==> Restoring agency ${AGENCY_ID} to ${RESTORE_POINT}"

# 1. Restore Postgres to point-in-time (target instance)
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier chainsight-prod \
  --db-cluster-identifier chainsight-restore-${AGENCY_ID} \
  --restore-to-time "${RESTORE_POINT}"

# 2. Filter to agency-only data (via pg_dump with WHERE clause)
PGPASSWORD=... pg_dump \
  --host chainsight-restore-${AGENCY_ID}.cluster-xyz.us-east-1.rds.amazonaws.com \
  --no-tablespaces \
  --table "cases" --where "agency_id='${AGENCY_ID}'" \
  chainsight | gzip > agency-${AGENCY_ID}-restore.sql.gz

# 3. Apply to agency's target namespace
# (continues similarly for object storage, Memgraph, etc.)
```

### 11.4 Incident runbook (abbreviated)

The detailed incident runbook lives in `/docs/runbooks/incident.md`. Key decision tree:

```
INCIDENT DETECTED
│
├─ Is ChainSight unreachable for > 5 minutes?
│   → Page on-call (PagerDuty / personal alert)
│   → Check Grafana status dashboard
│   → Check Fly.io / AWS health console
│
├─ Is it a data issue (corruption, loss)?
│   → Do NOT attempt writes until cause is identified
│   → Engage per-agency restore procedure
│   → Notify affected agencies within 1 hour
│
├─ Is it a security incident?
│   → Follow security incident runbook (/docs/runbooks/security-incident.md)
│   → Revoke all active support access grants immediately
│   → Do NOT roll back until evidence is preserved
│
└─ Is it a performance degradation?
    → Check queue depths (BullMQ dashboard)
    → Check database connection pool utilization
    → Scale workers if queue depth > 500
    → Check for slow queries via Postgres pg_stat_statements
```

---

## 12. Cost Management

### 12.1 Infrastructure cost tracking per tenant

Per-tenant cost attribution flows through three mechanisms:

**Application-layer tagging:** Every BullMQ job, every database query, and every BYOK provider call emits a span attribute `chainsight.agency_id`. The OTEL collector aggregates these into Prometheus metrics, and Grafana renders per-agency cost breakdowns.

**AWS Cost Allocation Tags:** All AWS resources (ECS tasks, RDS connections, S3 requests) are tagged with `chainsight:agency_id` at the infrastructure level for AWS Cost Explorer attribution.

**Provider spend telemetry (F23/v0.6):** The cost telemetry system (designed in v0.6 Section 9.8) tracks API call costs per provider per agency:

```typescript
// packages/capability-router/src/cost-tracker.ts
class CostTracker {
  async recordProviderCall(
    agencyId: string,
    caseId: string,
    providerInstallId: string,
    capability: string,
    estimatedCost: Decimal,
    cacheHit: boolean,
  ) {
    await db.insert(providerCostLog).values({
      agency_id: agencyId,
      case_id: caseId,
      provider_install_id: providerInstallId,
      capability,
      estimated_cost: estimatedCost,
      cache_hit: cacheHit,
      ts: new Date(),
    });

    // Emit to metrics for real-time dashboard
    costHistogram.record(estimatedCost.toNumber(), {
      agency_id: agencyId,
      provider: providerInstallId,
      capability,
      cache_hit: String(cacheHit),
    });
  }
}
```

### 12.2 AI cost telemetry

Per v0.9 Section 3.4, LLM spend is tracked per model per role per agency:

```typescript
// Every AgentCall record includes cost information
AgentCall {
  id: uuid
  case_id: uuid
  agent_name: string
  model_card_id: uuid
  inputs_hash: sha256      // No plaintext prompt stored
  outputs_hash: sha256     // No plaintext output stored
  ts: timestamp
  input_tokens: int
  output_tokens: int
  cost_usd: Decimal
  tier: enum               // A | B | C
}
```

The cost dashboard aggregates these by agency, role, model, and time period — giving agencies complete visibility into their AI spend without exposing case content to the vendor.

### 12.3 Provider API spend visibility (F23)

The Provider Marketplace UI (v0.3) shows a live cost telemetry section, as designed in v0.6 Section 9.8. Implementation notes for the solo dev:

- Cost is estimated, not exactly measured, because most providers don't return exact cost per call in their API responses.
- The platform uses a **price sheet** (maintained per provider in the ProviderDefinition catalog) to estimate cost from the response's rate-limit headers (which typically include request counts and quota consumed).
- Quarterly, the admin can reconcile the platform's estimates against provider invoices using the billing audit pack export.

### 12.4 Customer billing data extraction

For SaaS Blind customers, billing data extraction must happen without exposing case data:

```typescript
// apps/api/src/routes/billing/audit-pack.ts
// Endpoint: GET /api/admin/billing/audit-pack
// Returns: What billing data the vendor has on this agency

router.get('/billing/audit-pack', async (req, reply) => {
  const agencyId = req.agencyId;

  const pack = {
    generated_at: new Date().toISOString(),
    agency_token: await hashAgencyId(agencyId), // Opaque token, not agency ID
    billing_period: req.query.period,
    active_seats: await countActiveSeats(agencyId),
    feature_tier: await getFeatureTier(agencyId),
    // Gross volume buckets — no case-level breakdown
    api_volume_bucket: await getVolumeBucket(agencyId), // "low" | "medium" | "high"
    // Nothing else — no case IDs, no investigation details, no user identities
  };

  return reply.send(pack);
});
```

---

## 13. Release Management

### 13.1 Version pinning per tenant (SaaS Blind)

Per v0.7 Section 5.10, SaaS Blind agencies can defer updates. Implementation:

```typescript
// Each agency has a version policy
AgencyVersionPolicy {
  agency_id: uuid
  current_version: semver          // What this agency is running
  auto_update: bool                // Default: false for Phase 2+ when this feature ships
  update_delay_days: int           // Minimum days before new version is applied; default 7
  pinned_version: semver | null    // If set, never auto-update past this version
  update_allowlist: semver[]       // If set, only update to these specific versions
}
```

The deployment system respects per-agency version policies:

```yaml
# ECS task definition uses the agency-specific image tag
# Resolved at deployment time by the release orchestrator
image: ghcr.io/chainsight/api:${AGENCY_VERSION}
```

In practice for Phase 0 (Fly.io), all agencies run the same version. Version pinning per tenant is a Phase 2 feature when the SaaS Blind customer base justifies the operational complexity.

### 13.2 Staged rollouts

Production releases follow a staged rollout sequence:

```
1. Staging environment (100% of traffic for 24h)
2. Canary group (1-5% of production agencies; 24h observation)
3. Wave 1 (25% of agencies; 48h)
4. Wave 2 (75% of agencies; 24h)
5. Full rollout (100%)
```

Agencies in each wave are selected to span the customer profile distribution: small, medium, large; different time zones; different classification levels.

For Phase 0 with fewer than 10 pilot customers, the staged rollout simplifies to: staging → pilot customers (sequential, one per day).

### 13.3 Rollback procedure

```bash
# scripts/rollback.sh
#!/usr/bin/env bash

PREVIOUS_VERSION="${1}"

echo "==> Rolling back to ${PREVIOUS_VERSION}"

# SaaS Blind (Fly.io Phase 0)
fly deploy --image ghcr.io/chainsight/api:${PREVIOUS_VERSION} --app chainsight-api
fly deploy --image ghcr.io/chainsight/worker:${PREVIOUS_VERSION} --app chainsight-worker
fly deploy --image ghcr.io/chainsight/web:${PREVIOUS_VERSION} --app chainsight-web
fly deploy --image ghcr.io/chainsight/math:${PREVIOUS_VERSION} --app chainsight-math

# Wait for health checks
sleep 30
curl -sf https://api.chainsight.io/health || {
  echo "==> Rollback health check failed! Manual intervention required."
  exit 1
}

echo "==> Rollback to ${PREVIOUS_VERSION} complete."
```

Database migrations that cannot be rolled back (irreversible schema changes) must be designed as forward-only with backward compatibility: the new schema must be readable by the previous version of the application. This is enforced by a migration review checklist in the PR template.

### 13.4 Per-tenant feature flags

Feature flags allow progressive feature rollout per agency without a code deploy:

```typescript
// packages/feature-flags/src/index.ts
// Simple implementation for Phase 0: JSON config in Redis
// Phase 2: migrate to a proper feature flag service (LaunchDarkly, Unleash, or Flagsmith)

class FeatureFlags {
  async isEnabled(flag: string, agencyId: string): Promise<boolean> {
    const config = await redis.get(`ff:${flag}`);
    if (!config) return false;

    const { enabled_for_all, enabled_for_agencies, disabled_for_agencies } = JSON.parse(config);

    if (disabled_for_agencies?.includes(agencyId)) return false;
    if (enabled_for_agencies?.includes(agencyId)) return true;
    return enabled_for_all ?? false;
  }
}
```

Feature flag changes are logged to the audit trail.

### 13.5 Customer-controlled deferred-update workflow

For On-Premises customers (Phase 1+), the deferred-update workflow:

1. ChainSight publishes a new release to the release channel (online) or delivers signed update package (air-gapped).
2. The on-prem installer detects the new version (or the customer is notified via their support channel).
3. The admin UI shows the update notification: "Version 1.2.0 is available. Release notes: [link]. Signature verified. ✓"
4. The agency admin clicks "Schedule update" and picks a maintenance window.
5. At the maintenance window, the update applies automatically, runs pre-flight and validation checks, and rolls back automatically if validation fails.
6. The agency admin receives a notification: "Update to 1.2.0 complete." or "Update to 1.2.0 FAILED — rolled back to 1.1.0."

---

## 14. Signed Releases and Sigstore

### 14.1 Signing architecture (G23 locked: Sigstore)

Every release artifact is signed using Sigstore's keyless signing. The signing chain:

```
GitHub Actions OIDC token
  → Sigstore Fulcio (certificate authority)
    → Short-lived signing certificate (10 minutes)
      → Signs: Docker images, Helm chart, installer bundle, manifest.json
        → Certificate + signature → Sigstore Rekor (transparency log)
          → Immutable, append-only log entry
```

No long-lived signing keys exist. Every signature is tied to a specific GitHub Actions workflow run, at a specific time, with a specific OIDC identity (`release@chainsight.dev` via GitHub Actions).

### 14.2 What gets signed

| Artifact                         | Signed | How                                                   |
| -------------------------------- | ------ | ----------------------------------------------------- |
| Docker images (per service)      | Yes    | `cosign sign` on the OCI digest                       |
| Helm chart (OCI artifact)        | Yes    | `cosign sign` on the chart digest                     |
| Air-gapped installer bundle      | Yes    | `cosign sign-blob` on the tar.gz                      |
| Release manifest (manifest.json) | Yes    | `cosign attest` with custom predicate type            |
| SBOM (per image)                 | Yes    | Embedded in OCI image via `docker buildx --sbom=true` |
| SLSA provenance                  | Yes    | Generated by `docker buildx --provenance=true`        |

### 14.3 Customer verification tooling

Customers verify releases before installation or upgrade:

```bash
# Verify a Docker image
cosign verify \
  --certificate-identity "https://github.com/chainsight/chainsight/.github/workflows/release.yml@refs/tags/v1.0.0" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/chainsight/api:1.0.0

# Verify an air-gapped installer bundle
cosign verify-blob \
  --certificate chainsight-1.0.0-airgap.tar.gz.crt \
  --signature chainsight-1.0.0-airgap.tar.gz.sig \
  --certificate-identity "release@chainsight.dev" \
  chainsight-1.0.0-airgap.tar.gz
```

The customer tooling is a standalone binary (`chainsight-verify`) distributed alongside each release, so customers without a Sigstore tool pre-installed can still verify.

### 14.4 Reproducible build guarantee

Per v0.7 Section 2.1, every release is built reproducibly from public source. The build process:

1. Every dependency is pinned in `pnpm-lock.yaml` (Node) and `requirements.txt` (Python).
2. Docker builds use `--platform linux/amd64` deterministically.
3. The build environment is a pinned GitHub Actions runner image.
4. Any customer or third party can clone the repo at the tagged commit and build identical images.

```bash
# Reproduce build from source
git clone https://github.com/chainsight/chainsight.git
git checkout v1.0.0
docker buildx build \
  --platform linux/amd64 \
  --file infra/docker/api.Dockerfile \
  --target production \
  --output type=tar,dest=api-1.0.0-reproduced.tar \
  .

# Compare digests
docker load --input api-1.0.0-reproduced.tar
docker inspect chainsight/api:reproduced --format='{{.Id}}'
# Should match the published digest for ghcr.io/chainsight/api:1.0.0
```

A reproducible build check runs quarterly. If a build cannot be reproduced, it is a P1 security issue.

---

## 15. Source-Code Escrow Program — Phase 2

### 15.1 Program structure (F44 implementation)

Per F44, enterprise and government tier customers receive source-code escrow as part of their contract. The escrow is held by a neutral third party.

**Escrow agent options (customer choice):**

- Iron Mountain (standard; government-accepted)
- NCC Group Escrow (preferred for technical customers; they can audit the deposit)
- Escrow London / EscrowTech (international customers)

### 15.2 Escrow deposit process

Deposits are made on every major release (and optionally on every minor release for government customers):

```bash
# scripts/escrow-deposit.sh
#!/usr/bin/env bash
set -e

VERSION="${1}"
ESCROW_AGENT="${ESCROW_AGENT:-iron_mountain}"

echo "==> Creating escrow deposit for v${VERSION}"

# 1. Create a full source archive
git archive --format=tar.gz --prefix=chainsight-${VERSION}/ \
  HEAD > chainsight-${VERSION}-source.tar.gz

# 2. Include build tooling and instructions
tar -rf chainsight-${VERSION}-source.tar.gz \
  ESCROW_BUILD_INSTRUCTIONS.md \
  infra/docker/ \
  .github/workflows/

# 3. Sign the archive
cosign sign-blob \
  --output-certificate chainsight-${VERSION}-source.tar.gz.crt \
  --output-signature chainsight-${VERSION}-source.tar.gz.sig \
  chainsight-${VERSION}-source.tar.gz

# 4. Encrypt for escrow agent
gpg --recipient "${ESCROW_AGENT_KEY_ID}" \
  --encrypt chainsight-${VERSION}-source.tar.gz > \
  chainsight-${VERSION}-source.tar.gz.gpg

# 5. Upload to escrow agent's SFTP server
sftp ${ESCROW_AGENT_SFTP} <<EOF
put chainsight-${VERSION}-source.tar.gz.gpg
put chainsight-${VERSION}-source.tar.gz.crt
put chainsight-${VERSION}-source.tar.gz.sig
EOF

echo "==> Escrow deposit complete for v${VERSION}"
```

### 15.3 Trigger events and release procedure

Per F44, the escrow is released to customers upon:

- Vendor bankruptcy or dissolution
- Vendor abandonment (no commercially reasonable maintenance for >12 months)
- Vendor acquisition by a hostile actor (subject to dispute resolution)
- Vendor material breach of the MSA

The release procedure is defined in the escrow agreement and requires:

1. The triggering event to be certified by the escrow agent or a court order.
2. The customer to formally request release.
3. The escrow agent to decrypt and deliver the source.

### 15.4 Customer access mechanics

Upon escrow release, customers receive:

- Full source code (identical to the GitHub repository at the deposited tag)
- `ESCROW_BUILD_INSTRUCTIONS.md` — step-by-step instructions to build and deploy from source
- The signed Docker images (or build scripts to reproduce them)
- A limited license to operate the software for their own use

The license grants the customer rights to:

- Continue running the deposited version indefinitely
- Modify the source for internal maintenance
- Hire contractors to maintain it

The license explicitly prohibits:

- Commercial redistribution
- Operating the platform as a competing service

---

## 16. Certification Readiness Ops

### 16.1 SOC 2 Type 1 — Phase 2 (F42)

SOC 2 Type 1 audits the design of controls (not operating effectiveness). It requires:

**DevOps practices required by SOC 2 Type 1:**

| Control area             | Required practice                        | How ChainSight implements it                                    |
| ------------------------ | ---------------------------------------- | --------------------------------------------------------------- |
| Change management        | All changes go through documented review | GitHub PR-based workflow; no direct pushes to main              |
| Access control           | Principle of least privilege             | IAM roles per service; no shared credentials; Vault for secrets |
| Availability             | Uptime monitoring, incident response     | Grafana alerts; PagerDuty; documented incident runbook          |
| Confidentiality          | Encryption at rest and in transit        | KMS DEK hierarchy; TLS everywhere; no plaintext storage         |
| Processing integrity     | Audit trail of all data operations       | Immutable hash-chained audit log; Postgres replication          |
| Security monitoring      | Log review, anomaly detection            | CloudWatch GuardDuty (AWS); Grafana alerts (Fly)                |
| Vulnerability management | Dependency scanning, penetration testing | Dependabot + Snyk in CI; annual pentest from Phase 2            |

**Continuous-control evidence collection (automated):**

```bash
# scripts/soc2-evidence-collect.sh
# Run weekly; output goes to /evidence/ directory for auditor review

# 1. Access log export (who accessed what infrastructure)
aws cloudtrail lookup-events \
  --start-time "$(date -d '7 days ago' --iso-8601)" \
  --end-time "$(date --iso-8601)" \
  --output json > evidence/cloudtrail-access-$(date +%Y%m%d).json

# 2. Change management log (merged PRs)
gh pr list --state merged \
  --json number,title,author,mergedAt,reviewDecision \
  --search "merged:>$(date -d '7 days ago' --iso-8601)" > \
  evidence/merged-prs-$(date +%Y%m%d).json

# 3. Security scan results
pnpm audit --json > evidence/npm-audit-$(date +%Y%m%d).json
trivy image ghcr.io/chainsight/api:latest --format json > \
  evidence/trivy-scan-$(date +%Y%m%d).json

# 4. Uptime report
curl -sf "https://api.grafana.com/api/alerts/states-for-alert-rule/..." > \
  evidence/uptime-$(date +%Y%m%d).json

# 5. Backup verification log
cat /var/log/chainsight/backup-verification.log > \
  evidence/backup-verification-$(date +%Y%m%d).log
```

### 16.2 SOC 2 Type 2 — Phase 3

Type 2 requires 6-12 months of demonstrated control operation. The evidence collection scripts from Phase 2 run continuously; by Phase 3, there is a full year of evidence.

Additional Type 2 requirements:

- Employee security training records (tracked in HR system)
- Vendor security reviews (for Fly.io, AWS, Sigstore, Upstash)
- Incident response exercises (tabletop exercises, documented outcomes)
- Access reviews (quarterly review of who has access to what)

### 16.3 ISO 27001 — Phase 3

ISO 27001 requires an Information Security Management System (ISMS). The ISMS documentation lives in `/docs/isms/`. Key documents:

- Information Security Policy
- Risk Assessment and Treatment Plan
- Asset Inventory
- Access Control Policy
- Cryptography Policy (aligned with Pillar 4 encryption hierarchy)
- Incident Response Procedure
- Business Continuity Plan

### 16.4 CJIS Conformance — Phase 3

CJIS applies to US state and local law enforcement. Key requirements and their implementation:

| CJIS requirement              | Implementation                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Advanced authentication (MFA) | TOTP required; WebAuthn for hardware key support (already in v1.0 engineering)   |
| Encryption in transit         | TLS 1.2+ everywhere; TLS 1.3 preferred                                           |
| Encryption at rest            | AES-256 via KMS DEK hierarchy                                                    |
| Audit logging                 | Immutable hash-chained audit log; retained per CJIS requirement (minimum 1 year) |
| Personnel screening           | Vendor employees with support access undergo background checks                   |
| Physical security             | AWS data center security; relevant SOC 2 reports from AWS                        |
| Incident response             | Documented in incident runbook; notifications to agency within CJIS time limits  |

### 16.5 FedRAMP Moderate — Phase 4

FedRAMP Moderate adds:

**Infrastructure requirements:**

- Deployment exclusively in AWS GovCloud (us-gov-east-1 or us-gov-west-1)
- Only FedRAMP-authorized services used (AWS services are authorized; Fly.io is not)
- Separate GovCloud infrastructure isolated from commercial AWS deployment

**Process requirements:**

- Sponsoring federal agency required before authorization begins
- System Security Plan (SSP) — 200+ page document
- 3PAO assessment (Third-Party Assessment Organization)
- ATO (Authority to Operate) from the sponsoring agency

**Timeline (Phase 3 prep → Phase 4 authorization):**

- Phase 3: Identify sponsoring agency; begin SSP; move SaaS to GovCloud
- Phase 4: Complete 3PAO assessment; authorization process (~12-18 months)

---

## 17. Phase 0 Ship Checklist

### 17.1 Infrastructure ready

- [ ] Docker Compose local dev stack runs with one command (`scripts/bootstrap.sh`)
- [ ] All pre-commit hooks installed and passing (lint, type-check, anti-feature check, secret scan)
- [ ] GitHub Actions workflows passing: lint, type-check, unit tests, integration tests, anti-feature CI
- [ ] Container images build without errors for all four services (api, web, worker, math)
- [ ] GitHub Actions releases a signed image to GHCR on push to main (cosign keyless signing working)
- [ ] Sigstore transparency log entries verifiable by `cosign verify`
- [ ] Fly.io applications deployed: chainsight-api, chainsight-web, chainsight-worker, chainsight-math, chainsight-memgraph
- [ ] Supabase project provisioned: Postgres + pgvector enabled, GoTrue Auth configured, Storage buckets created, Realtime enabled
- [ ] `supabase db push` applies all migrations to the production project without errors
- [ ] Supabase Auth configured: invite-only, MFA (TOTP + WebAuthn) enabled, SMTP via Resend
- [ ] Upstash Redis provisioned and accessible from all Fly apps
- [ ] All Fly secrets set (Supabase URL + service role key + anon key, DATABASE_URL pooler, Redis URL, KMS keys, BYOK provider API keys)

### 17.2 Sovereignty and security

- [ ] Offline license validation working: signed license certificate validated at API startup without network call
- [ ] Per-tenant envelope encryption: BeliefAtoms encrypted with per-agency DEK; DEK wrapped with agency KMS root key
- [ ] KMS provider abstraction working: AWS KMS for SaaS Blind, dev stub for local
- [ ] Telemetry opt-in toggle: `TELEMETRY_ENABLED=false` correctly suppresses all vendor telemetry calls
- [ ] Anti-feature CI check: confirmed to fail on a synthetic banned pattern
- [ ] Audit log: append-only Postgres table with hash chain; first entry verifiable
- [ ] Support access workflow: agency admin can generate and revoke a support grant; vendor action logging to audit trail confirmed working (can be tested with a local admin and self-support simulation)

### 17.3 Observability

- [ ] OTEL Collector running and receiving spans from api, web, worker, math
- [ ] Grafana connected to Tempo (traces) and Loki (logs)
- [ ] Overview dashboard showing request rate, error rate, latency
- [ ] `attributes/scrub_case_data` processor: confirmed that span attributes do not include case IDs or addresses in test runs

### 17.4 Deployability

- [ ] Phase 0 demo reproducible: paste an Ethereum tx hash → Inspector populates → Reproducibility Pack exports → hash chain verifiable
- [ ] On-prem Docker Compose installer: `install.sh` runs clean on a fresh Ubuntu 22.04 server (test on a VM)
- [ ] Helm chart: `helm install` runs clean against a local Kind cluster
- [ ] Pre-flight checks: all checks pass on a clean install; fail appropriately when a prereq is missing
- [ ] Validation script: all checks pass after a clean install

### 17.5 Certification commitments

- [ ] F41 anti-feature commitments documented in public-facing materials (landing page, MSA draft)
- [ ] F42 certification roadmap published (in product docs or README)
- [ ] F43 outside counsel engaged for federal contracting, civil rights, IP/privacy, and litigation
- [ ] F44 EOL and data portability guarantees in MSA template
- [ ] Reproducibility Pack format specification document published (for third-party interop)

### 17.6 Deployment runbook

The deployment runbook lives at `/docs/runbooks/deployment.md`. Phase 0 abbreviated:

```
DEPLOY A NEW VERSION TO SAAS BLIND (FLY.IO)

1. Merge PR to main
   → CI builds, signs, and pushes images automatically
   → Verify CI is green in GitHub Actions

2. Watch Fly deployment
   fly logs --app chainsight-api
   fly status --app chainsight-api

3. Verify health
   curl -sf https://api.chainsight.io/health

4. If health fails:
   fly releases --app chainsight-api  # Find previous version tag
   fly deploy --image ghcr.io/chainsight/api:<prev-version>
```

### 17.7 Customer onboarding runbook

```
ONBOARDING A NEW AGENCY (SAAS BLIND)

1. Provision agency in admin dashboard
   - Create Agency record with KMS root key reference
   - Generate initial admin user credentials
   - Send onboarding email via Resend

2. Agency configures KMS
   - Agency admin provides their KMS provider details (AWS KMS ARN, Vault address, etc.)
   - Platform validates KMS connectivity via test encrypt/decrypt
   - First DEK is generated and wrapped with agency root key

3. Agency installs BYOK providers
   - Walk agency admin through the Provider Marketplace
   - First provider: Etherscan (required for Ethereum tracing)
   - Validate each key via the marketplace health check

4. Create first case
   - Walk investigator through creating Case #1 (can be a training case)
   - Verify IOC ingestion works
   - Confirm Reproducibility Pack generation

5. Confirm observability
   - Verify agency appears in Grafana per-tenant dashboard
   - Confirm no case data in OTEL spans

6. Deliver
   - Send "you're live" email
   - Schedule 30-day check-in
```

---

## 18. Phase 0 Implementation Plan — Weeks 1–8

This is the literal week-by-week DevOps work, running in parallel with the backend and frontend builds described in v1.0 engineering Part 4.

### Week 1: Repository and CI foundations

**DevOps tasks:**

- Initialize Turborepo monorepo structure (matches v1.0 engineering spec)
- Configure `pnpm workspaces` and base `turbo.json`
- Write `Dockerfile` targets (development, production) for all four services
- Write base `docker-compose.yml` for local development
- Set up GitHub Actions: lint + type-check workflow (fastest feedback loop first)
- Configure Dependabot for both npm and Docker base images
- Set up pre-commit hooks (Husky + lint-staged)
- Write `scripts/bootstrap.sh` — one-command local setup
- Set up GHCR as the container registry

**Deliverable:** `git clone` → `./scripts/bootstrap.sh` → running local stack in under 10 minutes.

### Week 2: Supabase setup + testing infrastructure + anti-feature CI

**DevOps tasks:**

- Create Supabase project (Pro tier); link CLI via `supabase link`
- Write `supabase/config.toml` with invite-only auth, TOTP + WebAuthn MFA, storage policies
- Write initial migrations: schema tables, RLS policies, pgvector indexes, storage bucket definitions
- Configure `supabase gen types typescript` and add type-check CI step
- Configure Vitest for unit tests (API, worker) and pytest for the math service
- Write GitHub Actions PR workflow with Supabase preview branch creation (`supabase branches create`) + teardown
- Write integration test workflow connecting to Supabase preview branch (replaces plain Postgres service container)
- Implement anti-feature check script (`tools/anti-feature-check/`) with F41 banned patterns
- Add anti-feature check to pre-commit hooks AND CI
- Add `supabase db lint` to pre-commit hooks (catches missing RLS, missing FK indexes)
- Create test fixtures (`supabase/seed.sql`) and `scripts/bootstrap.sh` one-command dev setup
- Set up `pnpm lint-staged` with eslint, prettier, ruff, black

**Deliverable:** `./scripts/bootstrap.sh` → full local stack running in <10 minutes. PR opens → Supabase preview branch created → integration tests run against it → branch torn down on PR close. Anti-feature CI working.

### Week 3: Fly.io deployment baseline

**DevOps tasks:**

- Set up Fly.io applications: chainsight-api, chainsight-web, chainsight-worker, chainsight-math, chainsight-memgraph
- Configure Upstash Redis (global replica)
- Write `fly.toml` for each service (scale-to-zero, health checks, Fly 6PN private networking)
- Configure all Fly secrets: Supabase URL + service role key, DATABASE_URL (Supabase pooler), Redis URL, KMS keys
- Write GitHub Actions `deploy.yml`: `supabase db push` (migrations first) → build images → push to GHCR → `flyctl deploy` per service
- Add health check endpoints to the API (`/health`, `/readyz`)

**Deliverable:** `git push` to main → CI → `supabase db push` to production → deployed to Fly → `https://api.chainsight.io/health` returns 200.

### Week 4: Sigstore signing and release pipeline

**DevOps tasks:**

- Install Sigstore cosign in CI (keyless signing via OIDC)
- Add `cosign sign` step to build-and-push workflow for all images
- Write `git-cliff.toml` for automated release note generation
- Write GitHub Actions release workflow (per-tag)
- Write Helm chart skeleton (`infra/helm/chainsight/`) with values.yaml
- Test Sigstore verification: `cosign verify` against a signed image
- Write customer verification docs and include `chainsight-verify` binary in release assets

**Deliverable:** Tag `v0.1.0` → GitHub Release created → images signed → Helm chart published → release notes generated.

### Week 5: Observability stack

**DevOps tasks:**

- Add OTEL SDK instrumentation to API, worker, and math service
- Deploy OTEL Collector, Tempo, Loki, Grafana in local docker-compose
- Write OTEL Collector config with `attributes/scrub_case_data` processor
- Create default Grafana dashboards: overview, per-tenant, AI cost, infra health
- Add observability services to Fly.io deployment (or use Grafana Cloud free tier for Phase 0)
- Write Grafana dashboard provisioning files

**Deliverable:** All services emit traces. Grafana shows request latency, error rates, and queue depth. No case data appears in any span.

### Week 6: Offline license validation and sovereignty controls

**DevOps tasks:**

- Implement signed license certificate format (Ed25519 signature over license fields)
- Write license validation logic in the API startup path (validates against hardcoded public key)
- Implement telemetry opt-in toggle (no-op when `TELEMETRY_ENABLED=false`)
- Write the `attributes/scrub_case_data` test: assert no case-identifying attributes appear in test spans
- Add support access grant workflow (data model + API endpoints + admin UI stub)
- Write audit log append-only check: attempt to modify a past entry and confirm it fails

**Deliverable:** Platform starts without network call. Telemetry opt-in toggle confirmed to work. Audit log immutability confirmed by test.

### Week 7: On-premises installer and pre-flight checks

**DevOps tasks:**

- Write `install.sh` for Docker Compose installer
- Write `preflight.sh` with all system requirement checks
- Write `validate.sh` for post-install validation
- Write `upgrade.sh` with signature verification and rollback
- Build production `docker-compose.production.yml` (no dev volume mounts, proper health checks, resource limits)
- Write `.env.template` with all required variables documented
- Write Helm chart values schema (`values.schema.json`) for validation on install
- Test on a fresh Ubuntu 22.04 VM: full install → validate → upgrade → rollback cycle

**Deliverable:** `./install.sh 0.1.0` runs clean on a fresh server. Upgrade and rollback work.

### Week 8: Air-gapped installer bundle and Phase 0 demo

**DevOps tasks:**

- Write GitHub Actions job to produce the air-gapped installer bundle (`.tar.gz` with all Docker images)
- Add `manifest.json` generation to the release workflow
- Sign the installer bundle with cosign
- Test the air-gapped install path: no internet access, load from bundle, validate
- Write `INSTALL.md`, `UPGRADE.md`, `RELEASE_NOTES.md` templates for the bundle
- Run Phase 0 demo end-to-end: paste tx hash → trace → Reproducibility Pack → verify hash chain
- Fix any DevOps issues found during the demo run

**Deliverable:** Air-gapped installer bundle produced and signed for v0.1.0. Phase 0 demo runs successfully.

### Honest assessment: what gets dropped if time runs out

This is a solo developer operating against a fixed 8-week clock. If something must slip, this is the priority order for deferral:

1. **Helm chart completeness** — A working Docker Compose installer is sufficient for Phase 0. Helm chart polish can happen in Week 9+.
2. **Air-gapped bundle size optimization** — The bundle works; it may be 8GB instead of the target 4GB. Optimization is Phase 1.
3. **Grafana dashboard polish** — A few default dashboards is enough. Full dashboard suite is Phase 1.
4. **Per-tenant version pinning** — All agencies on the same version in Phase 0 is fine.
5. **Automated evidence collection scripts** — SOC 2 prep is Phase 2; manual evidence collection is acceptable in Phase 0.

What must NOT slip:

- One-command local bootstrap (developer velocity depends on it every day)
- Anti-feature CI check (F41 compliance; committed from day one)
- Sigstore signing (G23 committed from Phase 0)
- Offline license validation (Pillar 4; no phone-home from Phase 0)
- Telemetry opt-in toggle (Pillar 4)

---

## 19. Open Questions

These are questions for the founder that affect specific DevOps decisions. They do not block Phase 0 work but must be answered before Phase 1 begins.

### D1 — Fly.io to AWS migration timing

**Question:** Is the Phase 1 migration to AWS triggered by a specific event (first enterprise contract signed? $X ARR? SOC 2 readiness decision?) or on a fixed timeline (e.g., month 6)?

**DevOps implication:** The migration requires 8 weeks of focused effort. If it happens in parallel with significant feature development, the solo dev will be spread thin. A clear trigger event allows it to be planned and scheduled as a dedicated sprint.

**Recommendation:** Trigger on "first government prospect requires SOC 2 evidence" OR "$100K ARR," whichever comes first.

### D2 — Self-hosted GitHub Actions runners

**Question:** When do we provision self-hosted GitHub Actions runners? SOC 2 Type 1 will likely flag that using GitHub-hosted runners means build secrets could theoretically be logged by GitHub infrastructure.

**DevOps implication:** Self-hosted runners require a dedicated machine (cloud or physical), and their operational maintenance adds burden to the solo dev.

**Recommendation:** Provision self-hosted runners when Phase 1 SOC 2 prep begins. They are not required for Phase 0 pilot work.

### D3 — Fly.io region for first pilot customer

**Question:** Where is the first pilot customer located? US or EU? The region selection (fra vs. iad as primary) has latency implications for them.

**DevOps implication:** Fly.io's primary region drives the lowest latency for that customer. Change is inexpensive now; gets more complex as data accumulates.

**Recommendation:** If first customer is US-based, flip primary region to iad. If EU, stay on fra.

### D4 — GPU procurement path for first on-prem customer

**Question:** What is the hardware provisioning pathway for the first on-prem customer that needs local LLM inference? Will they source their own GPU hardware, or does ChainSight offer hardware as part of the deal?

**DevOps implication:** If ChainSight needs to configure and ship hardware, there is a logistics and support burden that is not in the current solo-dev scope.

**Recommendation:** In Phase 1, ChainSight ships the software with GPU-configuration guides. Agency procures their own hardware. ChainSight provides installation support (as a paid service for the Classified tier). Hardware-as-a-service is a Phase 3 consideration.

### D5 — Secret management for long-term solo-dev ops

**Question:** All production secrets are currently in Fly.io secrets and Terraform state. As the platform grows, what is the secret management architecture? HashiCorp Vault? AWS Secrets Manager? 1Password Secrets?

**DevOps implication:** A solo developer managing many customers' secrets has operational risk (single point of failure). Rotating compromised secrets must be possible without downtime.

**Recommendation:** Phase 0: Fly.io secrets + AWS Secrets Manager. Phase 1: HashiCorp Vault (self-hosted, matches the on-prem KMS architecture) with auto-unseal via AWS KMS. Vault becomes the single secrets plane for both SaaS and on-prem.

### D6 — Observability stack for SaaS Blind Phase 0

**Question:** Run observability stack (Grafana + Tempo + Loki) self-hosted on Fly.io, or use Grafana Cloud (free tier for Phase 0)?

**DevOps implication:** Grafana Cloud free tier limits: 14-day retention, limited users. Good enough for Phase 0. Self-hosted is operationally heavier but required when SOC 2 work begins (cloud-hosted observability means evidence lives on a third-party platform).

**Recommendation:** Grafana Cloud free tier for Phase 0. Migrate to self-hosted during Phase 1 AWS migration.

### D7 — Code signing key management (edge case)

**Question:** Sigstore keyless signing means each signing event is tied to a specific GitHub Actions OIDC identity. If the GitHub organization changes (rename, transfer, org restructure), the certificate identity pattern changes and old verifications break.

**DevOps implication:** Customers who pin release verification to the certificate identity string would have their verification scripts break after an org rename.

**Recommendation:** Establish the final GitHub organization name before Phase 0 ships. Document this as a "do not rename after Phase 0" constraint. Add the certificate identity string to the MSA as a verifiable commitment.

### D8 — Iron Mountain vs. NCC Group for Phase 2 escrow

**Question:** Which escrow agent should be the default for the standard enterprise contract?

**DevOps implication:** NCC Group performs a technical review of the escrowed source (they can verify it builds and runs). This is more credible for sophisticated customers but costs more. Iron Mountain is the standard "file and forget" choice.

**Recommendation:** Offer both. Standard enterprise tier: Iron Mountain. Government and Classified tiers: NCC Group with technical verification. The Phase 2 escrow program documents both options in the MSA.

### D9 — Database migration strategy for breaking schema changes

**Question:** What is the policy for irreversible database schema changes (adding NOT NULL columns, dropping tables)?

**DevOps implication:** The current rollback procedure assumes schema migrations can be reversed. For truly irreversible changes, the rollback path is "restore from backup + replay WAL," not "run reverse migration."

**Recommendation:** Lock a policy before the first customer data exists: (a) all migrations must be backward-compatible with the previous release for at least 24 hours; (b) if an irreversible change is required, it ships in two releases — first add the new schema element while keeping the old one, then in the second release remove the old element after confirming rollback is no longer needed.

---

## Closing Notes

### Complexity acknowledgment

This design is comprehensive. For a solo developer, its full implementation is a multi-quarter effort running alongside actual product engineering. The Phase 0 implementation plan (Section 18) is realistic — it covers what a solo dev can execute in 8 weeks while simultaneously building the application.

**What gets built in Phase 0:** Local dev environment (`supabase start` + Docker Compose), CI/CD (GitHub Actions with Supabase preview branches + Fly.io review apps), Supabase + Fly.io SaaS Blind deployment, Sigstore signing, basic observability (Grafana Cloud), offline license validation, telemetry toggle, on-prem installer (Docker Compose). This is enough to call Phase 0 done per the v0.7 phasing commitment.

**What gets built in Phase 1:** On-prem Helm chart hardening, air-gapped installer polish, per-tenant observability isolation, support access workflow (full production implementation), disaster recovery automation.

**What gets built in Phase 2:** AWS migration sprint (Supabase → RDS, Fly.io → ECS Fargate, GoTrue → Ory Kratos, Storage → S3, Realtime → Soketi), self-hosted observability stack, SOC 2 evidence collection automation, source-code escrow program.

**What gets built in Phase 3 and beyond:** Confidential computing (Nitro Enclaves), per-tenant version pinning, per-tenant infrastructure isolation, FedRAMP groundwork.

### The solo-dev scaling constraint

The hardest DevOps problem for a solo developer is not any specific technical challenge — it is the operational burden of being the only person on call. Every system described in this document adds some operational surface. The discipline required is to keep that surface minimal in Phase 0:

- Supabase managed services (Postgres, Auth, Storage, Realtime) and Fly.io minimize operational burden compared to self-hosted equivalents.
- GitHub-hosted Actions runners eliminate runner maintenance.
- Sigstore keyless signing eliminates key management.
- Grafana Cloud free tier eliminates observability hosting.

As the platform grows and revenue supports it, the first DevOps hire will inherit a well-designed system with runbooks for every procedure. That hire should be able to take on-call in Week 1 without a knowledge-transfer period measured in months.

---

_Document version: 1.0.0 | June 2026 | All locked decisions from v0.3 through v0.9 honored._
