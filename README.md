# ChainSight

> Autonomous, court-defensible blockchain investigation platform.

**Status:** Phase 0 — Foundations. Solo developer + AI agent execution.

## What is this?

ChainSight is an autonomous, court-defensible blockchain investigation platform. Investigators paste IOCs, drop documents, and click through a transaction-centric graph. AI agents handle tracing, attribution, swap/bridge decoding, obfuscation detection, and report drafting. Every claim is provenanced, every number deterministic, every output replayable.

The four pillars:

1. **Belief State Service** — every AI claim is provenanced, tiered, challengeable
2. **Reproducibility Pack** — every report replays bit-for-bit forever
3. **BYOK Provider & Storage Marketplace + Cache + In-House Heuristics** — agencies use their existing data deals or run with zero external dependencies
4. **Sovereign Deployment** — agencies retain operational privacy regardless of deployment mode

The vendor is never a counterparty to the investigation.

## Architecture (high-level)

```
chainsight/
├── apps/
│   ├── web/        # Next.js 15 (App Router, React 19)
│   ├── api/        # Fastify backend
│   ├── worker/     # BullMQ workers
│   └── math/       # Python FastAPI + gRPC math service
├── packages/
│   ├── shared-types/         # Shared TypeScript types
│   ├── belief-state/         # Belief State Service client
│   ├── capability-router/    # Provider routing
│   ├── agents/               # Agent definitions
│   ├── reproducibility/      # Pack builder
│   └── math-client/          # gRPC client for math service
├── infra/
│   ├── docker/    # Docker Compose for local dev
│   ├── helm/      # K8s deployment (On-Prem)
│   ├── fly/       # Fly.io app definitions (SaaS Blind v1)
│   └── terraform/ # AWS (Phase 2+)
├── supabase/
│   └── migrations/ # SQL migrations
└── tools/
    ├── eval/      # ML evaluation harness
    └── fine-tune/ # Training pipelines
```

## Stack (Phase 0 SaaS Blind v1)

- **Database**: Supabase managed Postgres 16+ with RLS + pgvector
- **Auth**: Supabase Auth (TOTP MFA + WebAuthn for high-impact actions)
- **Object storage**: Supabase Storage
- **Realtime**: Supabase Realtime (deconfliction alerts, supervisor dashboard, presence)
- **Cache**: Upstash Redis
- **Graph**: Memgraph (self-hosted on Fly.io volumes)
- **App hosting**: Fly.io
- **CI/CD**: GitHub Actions + Sigstore release signing
- **KMS**: AWS KMS (independent of Supabase)
- **Encryption**: libsodium app-layer; ciphertext into Supabase

## Getting started

Prerequisites:

- Node.js 22+
- pnpm 9+
- Docker (for local Memgraph + Redis)
- Supabase CLI: `npm install -g supabase`
- Fly CLI: `curl -L https://fly.io/install.sh | sh`
- Python 3.12+ (for math service)
- uv (Python package manager): `pip install uv`

Setup:

```bash
# Install dependencies
pnpm install

# Start local Supabase emulator
pnpm supabase:start

# Start local Memgraph + Redis
docker compose -f infra/docker/docker-compose.yml up -d

# Apply migrations
pnpm supabase db push

# Start dev servers
pnpm dev
```

## Project documentation

The full design pack lives in `/docs/` and includes:

- The v1.0 engineering north star
- Eight discipline deep-design documents (backend, AI/ML, data, frontend, security, devops, compliance, GTM)
- The integrated index
- The journey docs (v0.1 → v0.9)

Total: 28 design documents, ~1.5 MB of cross-validated architecture.

## License

Proprietary. All rights reserved.

Open-core release of the periphery (connectors, detectors, Pack viewers) planned for Phase 2.
