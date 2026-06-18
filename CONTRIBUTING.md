# Contributing to ChainSight

## Daily workflow (solo developer + AI agents)

Before you write code, re-read **three** things:

1. `/docs/chainsight_v1_0_engineering.md` — the canonical north star
2. `/docs/chainsight_v1_0_integrated_index.md` — the launchpad
3. The discipline doc for what you're touching today

## Top-of-mind reminders (the daily ten)

1. **The Belief State is the foundation.** Every feature writes BeliefAtoms.
2. **The Math Service owns every number.** Never let an LLM type a value.
3. **The cache exists from day one.**
4. **Reproducibility from day one.** Every case has a Pack.
5. **The capability router has no vendor names.** Always `router.resolve(capability, args)`.
6. **No private agent knowledge.** Every agent reads/writes the Belief State.
7. **Verifier on every drafted sentence.**
8. **Test against the ground-truth flywheel.**
9. **Sovereignty isn't bolted on later.**
10. **The investigator is the smartest sensor.**

## Branch and commit conventions

- `main` is always deployable.
- Branches: `feat/short-description`, `fix/short-description`, `refactor/short-description`.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Every PR runs CI: lint, typecheck, test, anti-feature scan, Supabase migration lint.

## Anti-feature commitments

These features will NEVER be built. The CI scan enforces. See v0.8 F41.

- No predictive policing
- No demographic correlation
- No mass surveillance modes
- No untargeted dragnet features
- No crypto trading or personal-portfolio features
- No vendor-managed key escrow
- No silent telemetry
- No vendor-as-broker (v1)
- No "trust us" privacy claims

## Local setup

```bash
pnpm install
pnpm supabase:start
docker compose -f infra/docker/docker-compose.yml up -d
cp .env.example .env.local
# fill in .env.local
pnpm dev
```
