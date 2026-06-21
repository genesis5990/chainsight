# ChainSight v1.1 — Technical Core Engineering Specification

> **Document type:** Build-ready engineering specification for the five technical-core modules
> **Audience:** Solo developer + AI agents writing Phase 1 production code
> **Predecessors:** v1.0 Engineering · v1.0 Backend Architecture · v1.0 Data Engineering · v1.0 AI/ML Engineering · v1.0 Frontend Architecture · v1.1 Supervisor Dashboard Addendum
> **Status:** v1.1 spec — supersedes the relevant subsections of v1.0 Backend Architecture (§1.5, §1.6) and v1.0 AI/ML Engineering (§2.3) with concrete, buildable detail
> **Build phase:** Phase 1 — transition from Phase-0 UI mockups to production backend
> **Anti-features reaffirmed (F41):** No predictive policing. No demographic correlation. No mass surveillance. No silent telemetry. No key escrow.

---

## §0 — Document framing

### 0.1 What this spec covers

The five **technical-core** modules — the engine room behind the Phase-0 UI mockups now live at `/inspector-demo`, `/canvas-demo`, `/wallet-demo`, `/supervisor-demo`, and `/attribution-demo`:

1. **Tracer Agent** — autonomous and human-guided hop expansion across one or many chains. The thing that turns "address X" into "address X plus the 14-hop subgraph that follows the money."
2. **Belief State Service** — the case ledger. Every claim emitted by any module is a `BeliefAtom`; every read is a query against the ledger. The source of truth for what the system "knows."
3. **Pathfinder** — graph search inside the case subgraph. Click-to-extend, lasso, auto-pathfind, natural-language "where did the money go?" — all four PSR selection modes resolve through this service.
4. **Math Service** — the single authority for arithmetic on cryptocurrency values, fiat conversions, FIFO/LIFO/proportional methodologies, fee math, and confidence scoring.
5. **Transaction Inspector pipeline** — the 8-section streaming popup the investigator double-clicks any node to summon. Combines structured chain data, decoded actions, BeliefAtom citations, and LLM narrative under a strict citation contract.

### 0.2 What this spec does NOT cover (deferred)

- Capability Router internals (v1.0 Backend §1.7 already covers).
- Reproducibility Pack format (v1.0 Backend §1.8).
- Chain-of-Custody hash chain (v1.0 Backend §1.9; cryptographic primitives in v1.0 Security & Sovereignty).
- Critic Agent, Bridge Agent, Swap Agent, OSINT Agent, Attribution Agent, Watcher Agent (Phase 2 — v1.0 AI/ML §2.x).
- CADNP cross-agency protocol (v1.1 Supervisor Dashboard Addendum §6).
- Front-end (covered by v1.0 Frontend Architecture; this spec assumes the data shapes shipped in `@chainsight/shared-types`).

### 0.3 Document conventions

- **TypeScript** snippets are the source of truth for API shapes (the API is Fastify v5 + tsup-bundled monorepo TS).
- **Python** snippets are for the Math Service only (FastAPI + gRPC via grpclib).
- **SQL** snippets are PostgreSQL 16-flavored. The Supabase project (`uyiabyyovwhciitlzkal`) is the Phase 1 host; the same DDL works against a self-hosted Postgres + pgvector for on-prem.
- All times are `timestamptz` UTC. All money is **integer minor units of the native chain currency** (wei for ETH, satoshis for BTC, lamports for SOL); fiat conversions are derived, never stored.
- All IDs are `uuid` v7 (time-sortable). Never expose raw IDs to chain-data providers (that would leak the case load).
- Filenames inside the monorepo are written relative to the repo root (e.g. `packages/belief-state/src/index.ts`).

### 0.4 Build sequence

This spec is structured so each module can be built **in the order it appears** with the previous module(s) already running:

| Week | Module                                            | Why                                                                   |
|------|---------------------------------------------------|-----------------------------------------------------------------------|
| 1    | Belief State Service (CRUD + event log + RLS)     | Everything else writes to it. Get the ledger live first.              |
| 2    | Math Service (gRPC, value/fee, FIFO only)         | Inspector needs it, Tracer needs it. Ship the hot path.               |
| 3    | Transaction Inspector pipeline (provider + LLM)   | The most-visible deliverable; proves the citation contract works.     |
| 4    | Pathfinder (k-shortest on the case subgraph)      | Unblocks PSR live wiring.                                             |
| 5–6  | Tracer Agent (single-hop → branching → budget)    | The hardest module; depends on all four above being stable.           |
| 7    | Cross-cutting hardening (caching, observability)  | Locks the gains in.                                                   |
| 8    | Integration test pass + Reproducibility Pack v1   | Phase 1 acceptance gate.                                              |

---

## §1 — The module map

```
                              ┌──────────────────────────────────────────┐
                              │                Web (Next.js)             │
                              │  Inspector · Canvas · PSR · Wallet · etc │
                              └────────────────┬─────────────────────────┘
                                               │ tRPC/HTTP (Fastify v5)
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              chainsight-api (Fastify v5)                         │
│  ┌─────────────────┐  ┌───────────────────┐  ┌────────────────┐ ┌────────────┐   │
│  │  tRPC routers   │  │  Capability       │  │  Workflow      │ │ Authz/RLS  │   │
│  │ (typed by mono- │  │  Router (BYOK)    │  │  Manager       │ │ middleware │   │
│  │  repo)          │  │                   │  │  (BullMQ)      │ │            │   │
│  └────┬───────┬────┘  └────────┬──────────┘  └───────┬────────┘ └────────────┘   │
│       │       │                │                     │                           │
│       │       │                │                     │                           │
│       │       ▼                ▼                     ▼                           │
│       │  ┌──────────────────────────────────────────────────────────────────┐    │
│       │  │              packages/belief-state  (logical service)            │    │
│       │  │   emit / challenge / supersede / query / link-evidence           │    │
│       │  └──────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │              ┌────────────────────────────────────────────┐              │
│       └─────────────►│   packages/pathfinder  (logical service)   │              │
│                      │   shortest / k-shortest / auto / nl-query  │              │
│                      └────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────────────────────────┘
        │  gRPC (HTTP/2, no TLS in dev, mTLS in prod)
        ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        chainsight-math (Python · FastAPI + gRPC)                 │
│  ComputeValueAtBlock · ComputeFeeInFiat · ApplyFifoToHop · ProportionalSplit     │
│  ComputeConfidence · DecodeAction (delegates structured decode to ethers/web3.py)│
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲
        │
┌───────┴──────────────────────────────────────────────────────────────────────────┐
│                   chainsight-worker (Node · BullMQ on Upstash Redis)             │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │              packages/tracer-agent  (logical service)                    │    │
│  │  TraceJob orchestrator · HopPipeline · Frontier · Budget · Critic stub   │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │              packages/inspector-pipeline  (logical service)              │    │
│  │  Section streamer · Citation Verifier · LLM client (BYOK)                │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲                                          ▲
        │ Redis pub/sub                            │ chain-data providers (BYOK)
        ▼                                          │
┌──────────────────────┐                           │
│  Web (SSE listener)  │                  Etherscan · Alchemy · Helius · …
└──────────────────────┘
```

Three deployable processes (matching the existing Fly apps):

- `chainsight-api-dev` — Fastify, tRPC routers, embedded `packages/belief-state` + `packages/pathfinder` + Capability Router.
- `chainsight-worker-dev` — BullMQ consumer; embeds `packages/tracer-agent` + `packages/inspector-pipeline`.
- `chainsight-math-dev` — Python; the only non-Node process; reached over gRPC.

The Web app talks only to the API. Workers and Math never face the internet.

---

## §2 — Shared primitives

### 2.1 Canonical types (ship into `@chainsight/shared-types`)

These are the wire-level shapes used across every module. They are additions / firm-ups to what's already in `packages/shared-types/src/`.

```ts
// packages/shared-types/src/core.ts

export type Uuid = string;
export type CaseId = Uuid;
export type AtomId = Uuid;
export type ChainId = 'eth' | 'btc' | 'sol' | 'tron' | 'polygon' | 'arbitrum' | 'base';
export type AddressRef = `${ChainId}:${string}`;        // e.g. "eth:0x742d…"
export type TxRef      = `${ChainId}_tx:${string}`;     // e.g. "eth_tx:0xabc…"
export type ClusterRef = `cluster:${ChainId}:${string}`;
export type SubjectRef = AddressRef | TxRef | ClusterRef;

/** Integer minor units of native chain currency, BigInt as decimal string for JSON. */
export type IntegerAmount = string;                     // e.g. "47200000000000000000" (47.2 ETH in wei)

/** ISO-4217 currency code, e.g. "USD". */
export type FiatCurrency = string;

/** A block on a specific chain. */
export interface BlockRef {
  chain: ChainId;
  block_height: number;
  block_hash: string;                                   // hex, lower-case, with 0x prefix for EVM
  block_time_utc: string;                               // ISO timestamp
}

/** A reference to a single edge in the case subgraph. */
export interface EdgeRef {
  chain: ChainId;
  tx_hash: string;                                      // canonical lower-case
  /** 0-indexed within the transaction. For EVM, internal-call ordering applies. */
  edge_index: number;
}

/** Composite confidence on a 0..1 scale; produced by Math Service. */
export interface Confidence {
  value: number;                                        // 0..1
  /** Why this number — the inputs the Math Service used. */
  inputs: {
    basis_tier: 'T0' | 'T2' | 'T3';
    provider_corroboration_count: number;
    sanctions_match: boolean;
    obfuscation_penalty: number;
    age_decay: number;
  };
  /** Stable across runs given identical inputs. */
  recipe_hash: string;
}
```

### 2.2 Idempotency and request fingerprinting

Every mutating call from Web → API and from API → Worker carries an **idempotency key** in the `X-Idempotency-Key` header (Web → API) or `idempotency_key` job field (API → Worker). The key is `BLAKE3(actor_id || endpoint || canonical(input))` — clients compute it; the server verifies and persists on first write.

Idempotency rows live in:

```sql
CREATE TABLE idempotency_records (
  key            text PRIMARY KEY,
  actor_id       uuid NOT NULL,
  endpoint       text NOT NULL,
  input_hash     bytea NOT NULL,
  result_payload jsonb NOT NULL,
  status         text NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX idempotency_records_expires_idx ON idempotency_records (expires_at);
```

A nightly worker job drops expired rows. Re-using a key with a different input hash is a 409.

### 2.3 Auth + tenant scope

Every authenticated request carries an `AgencyContext`:

```ts
export interface AgencyContext {
  user_id: Uuid;
  agency_id: Uuid;
  active_case_id: CaseId | null;                        // null on dashboard pages
  /** Resolved at session creation; never trust client headers. */
  roles: ('investigator' | 'supervisor' | 'admin')[];
  /** For supervisor APIs only. */
  supervisory_scope_id: Uuid | null;
  /** Provider tokens already on file via the Capability Router. */
  available_capabilities: string[];
}
```

`AgencyContext` is rebuilt server-side from the session cookie on every request — never trust client-provided fields. The context is the input to every Postgres Row-Level-Security policy.

### 2.4 Error envelope

All API errors use a single envelope. The Web app already knows how to render this.

```ts
export interface ApiError {
  code:
    | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict'
    | 'rate_limited' | 'budget_exhausted' | 'provider_unavailable'
    | 'invalid_input' | 'internal'
    | 'evidence_immutable' | 'idempotency_conflict';
  message: string;                                      // human readable, no PII
  retry_after_seconds?: number;
  affected_capabilities?: string[];                     // for provider failures
  trace_id: string;                                     // for support
}
```

`evidence_immutable` is the special case: any attempt to mutate a BeliefAtom referenced in a finalized Reproducibility Pack returns this and the UI displays the "this evidence is locked" affordance.

---

## §3 — Belief State Service

The case ledger. **Every fact the system knows is a `BeliefAtom`.** Every read is a query against this module. Every other module both writes to it and reads from it.

### 3.1 Module shape

`packages/belief-state/` — a TypeScript module that runs **inside** the `chainsight-api` Fastify process and **also inside** the worker process. Both processes share the same code via the monorepo. Database connections are pooled per-process (PgBouncer at the Supabase edge; 25 connections per worker, 100 for the API).

It exposes one interface:

```ts
// packages/belief-state/src/index.ts

export interface BeliefStateService {
  // ---------- writes ----------
  emit(atom: BeliefAtomInput, ctx: AgencyContext): Promise<BeliefAtom>;
  challenge(atomId: AtomId, reason: string, ctx: AgencyContext): Promise<BeliefAtomChallenge>;
  resolveChallenge(challengeId: Uuid, resolution: ChallengeResolution, ctx: AgencyContext): Promise<BeliefAtomChallenge>;
  supersede(oldAtomId: AtomId, newAtom: BeliefAtomInput, ctx: AgencyContext): Promise<BeliefAtom>;
  retract(atomId: AtomId, reason: string, ctx: AgencyContext): Promise<BeliefAtomRetraction>;
  linkEvidence(atomId: AtomId, evidence: SupportingEvidence, ctx: AgencyContext): Promise<BeliefAtom>;

  // ---------- reads ----------
  getAtom(atomId: AtomId, ctx: AgencyContext): Promise<BeliefAtom | null>;
  queryAtoms(filter: AtomFilter, ctx: AgencyContext): Promise<BeliefAtom[]>;
  getAtomsBySubject(subjectRef: SubjectRef, caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtom[]>;
  getAtomsByCase(caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtom[]>;
  getOpenChallenges(caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtomChallenge[]>;

  // ---------- streams (for canvas live updates) ----------
  subscribe(caseId: CaseId, ctx: AgencyContext): AsyncIterable<BeliefStateEvent>;
}
```

### 3.2 The `BeliefAtom` shape

```ts
export interface BeliefAtomInput {
  case_id: CaseId;
  subject_ref: SubjectRef;                              // what the atom is about
  predicate: AtomPredicate;                             // what is claimed
  object_payload: object;                               // structured payload, predicate-specific
  basis: 'T0' | 'T2' | 'T3';                            // tier
  basis_detail: string;                                 // free text — "Binance subpoena #BNB-2024-0184"
  confidence_input?: Partial<Confidence['inputs']>;     // Math Service computes the full Confidence
  supporting_evidence?: SupportingEvidence[];
  emitted_by_kind: 'human' | 'agent' | 'system';
  emitted_by_id: Uuid;                                  // investigator_id or agent_id
  parent_atom_id?: AtomId;                              // for chained inferences
  reproducibility_inputs?: object;                      // exact inputs to deterministically replay this emission
}

export type AtomPredicate =
  // structural (asserted by chain data)
  | 'tx_exists'
  | 'address_received'
  | 'address_sent'
  | 'contract_called'
  | 'token_transferred'
  | 'block_includes_tx'
  // analytic (asserted by agents or math)
  | 'has_cluster_membership'
  | 'has_attribution'
  | 'has_obfuscation_marker'
  | 'has_taint_share'
  | 'has_confidence_score'
  | 'has_value_at_block'
  // investigator
  | 'investigator_marked'
  | 'investigator_attributed'
  | 'investigator_commented'
  | 'case_opened'
  | 'case_closed'
  | 'ioc_added'
  | 'path_promoted'
  // supervisor (write-restricted)
  | 'supervisor_deconfliction_decision'
  | 'supervisor_review_approved'
  | 'supervisor_review_sent_back';

export interface BeliefAtom extends BeliefAtomInput {
  id: AtomId;
  emitted_at: string;
  confidence: Confidence;                               // computed by Math Service before persist
  status: 'asserted' | 'challenged' | 'superseded' | 'retracted';
  superseded_by?: AtomId;
  superseded_at?: string;
  challenges: BeliefAtomChallenge[];
  /** Hash of canonical-serialized atom payload — used by the Reproducibility Pack chain. */
  payload_hash: string;
  /** Set when the atom is included in a finalized Reproducibility Pack. */
  locked_at?: string;
  locked_in_pack_id?: Uuid;
}
```

### 3.3 The event log

Every state change emits an immutable event:

```ts
export type BeliefStateEvent =
  | { kind: 'atom_emitted',    atom: BeliefAtom }
  | { kind: 'atom_challenged', challenge: BeliefAtomChallenge }
  | { kind: 'atom_resolved',   challenge: BeliefAtomChallenge }
  | { kind: 'atom_superseded', old_atom_id: AtomId, new_atom: BeliefAtom }
  | { kind: 'atom_retracted',  retraction: BeliefAtomRetraction }
  | { kind: 'evidence_linked', atom_id: AtomId, evidence: SupportingEvidence };
```

Events go into `belief_events` (append-only) and are also published to Redis pub/sub on `case:{case_id}:beliefs` so the Web canvas can re-render in real time via Supabase Realtime forwarding.

### 3.4 Supabase schema

```sql
-- Atoms: the present-state row per atom_id.
CREATE TABLE belief_atoms (
  id                   uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  case_id              uuid NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  subject_ref          text NOT NULL,
  subject_kind         text NOT NULL,                    -- 'address' | 'tx' | 'cluster'
  predicate            text NOT NULL,
  object_payload       jsonb NOT NULL,
  basis                text NOT NULL CHECK (basis IN ('T0','T2','T3')),
  basis_detail         text NOT NULL,
  confidence           jsonb NOT NULL,                   -- full Confidence struct
  supporting_evidence  jsonb NOT NULL DEFAULT '[]',
  emitted_by_kind      text NOT NULL CHECK (emitted_by_kind IN ('human','agent','system')),
  emitted_by_id        uuid NOT NULL,
  emitted_at           timestamptz NOT NULL DEFAULT now(),
  parent_atom_id       uuid REFERENCES belief_atoms(id),
  reproducibility_inputs jsonb,
  status               text NOT NULL DEFAULT 'asserted'
                         CHECK (status IN ('asserted','challenged','superseded','retracted')),
  superseded_by        uuid REFERENCES belief_atoms(id),
  superseded_at        timestamptz,
  payload_hash         bytea NOT NULL,
  locked_at            timestamptz,
  locked_in_pack_id    uuid
);

CREATE INDEX belief_atoms_case_idx           ON belief_atoms (case_id, emitted_at DESC);
CREATE INDEX belief_atoms_subject_idx        ON belief_atoms (case_id, subject_kind, subject_ref);
CREATE INDEX belief_atoms_predicate_idx      ON belief_atoms (case_id, predicate);
CREATE INDEX belief_atoms_status_idx         ON belief_atoms (case_id, status) WHERE status IN ('asserted','challenged');
CREATE INDEX belief_atoms_pack_idx           ON belief_atoms (locked_in_pack_id) WHERE locked_in_pack_id IS NOT NULL;

-- Challenges: a separate table because there can be many per atom.
CREATE TABLE belief_atom_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  atom_id         uuid NOT NULL REFERENCES belief_atoms(id),
  case_id         uuid NOT NULL REFERENCES cases(id),
  reason          text NOT NULL,
  challenged_by   uuid NOT NULL,
  challenged_at   timestamptz NOT NULL DEFAULT now(),
  resolution      text CHECK (resolution IN ('upheld','superseded','withdrawn')),
  resolution_note text,
  resolved_by     uuid,
  resolved_at     timestamptz
);
CREATE INDEX belief_atom_challenges_atom_idx ON belief_atom_challenges (atom_id);
CREATE INDEX belief_atom_challenges_open_idx ON belief_atom_challenges (case_id) WHERE resolved_at IS NULL;

-- Retractions: similar separation.
CREATE TABLE belief_atom_retractions (
  id            uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  atom_id       uuid NOT NULL REFERENCES belief_atoms(id),
  case_id       uuid NOT NULL REFERENCES cases(id),
  reason        text NOT NULL,
  retracted_by  uuid NOT NULL,
  retracted_at  timestamptz NOT NULL DEFAULT now()
);

-- Events: append-only log for replay + canvas streaming.
CREATE TABLE belief_events (
  id              uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  case_id         uuid NOT NULL,
  kind            text NOT NULL,
  payload         jsonb NOT NULL,
  emitted_at      timestamptz NOT NULL DEFAULT now(),
  /** Sequence number per case — strict ordering for replay. */
  case_seq        bigint NOT NULL
);
CREATE INDEX belief_events_case_seq_idx ON belief_events (case_id, case_seq);

-- Per-case sequence generator.
CREATE TABLE case_event_seq (
  case_id  uuid PRIMARY KEY,
  next_seq bigint NOT NULL DEFAULT 1
);
```

### 3.5 Row-Level Security

```sql
-- A user can read a belief_atom iff they are on the case ACL.
CREATE POLICY belief_atoms_read ON belief_atoms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM case_acl
       WHERE case_acl.case_id = belief_atoms.case_id
         AND case_acl.user_id = auth.uid()
    )
  );

-- A user can write iff they have the relevant role on the case.
CREATE POLICY belief_atoms_write ON belief_atoms FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_acl
       WHERE case_acl.case_id   = belief_atoms.case_id
         AND case_acl.user_id   = auth.uid()
         AND case_acl.can_write = true
    )
  );

-- A locked atom is read-only for everyone except the reproducibility-pack rebuild process.
CREATE POLICY belief_atoms_no_update_locked ON belief_atoms FOR UPDATE
  USING (locked_at IS NULL)
  WITH CHECK (locked_at IS NULL);
```

The same pattern applies to `belief_atom_challenges`, `belief_atom_retractions`, and `belief_events`. Service-role connections (worker → DB) bypass RLS via the `service_role` key and are gated by the `AgencyContext` enforcement in the application layer.

### 3.6 The `emit` flow (the hot path)

```
emit(input, ctx)
  ├── 1. validate input against predicate-specific schema (Zod)
  ├── 2. authorize: case_acl includes (ctx.user_id, can_write)
  ├── 3. compute confidence via Math Service (gRPC)
  ├── 4. serialize canonical payload; compute payload_hash = BLAKE3
  ├── 5. begin txn:
  │     ├── INSERT INTO belief_atoms
  │     ├── nextval from case_event_seq
  │     └── INSERT INTO belief_events (kind='atom_emitted', case_seq)
  ├── 6. commit
  ├── 7. PUBLISH to redis 'case:{id}:beliefs' (best-effort; failure logged but does not abort the txn)
  └── 8. return the new BeliefAtom
```

The transaction is short (target P50 <8 ms, P99 <40 ms). Math Service confidence computation runs in parallel where possible: validation + authz happen first, then Math is called while we begin the transaction.

**Concurrency:** writers don't lock readers. A subject can have many concurrent atom emissions across the same case — that's the point. Multi-row atomicity is only required within a single `emit` (the atom + the event must commit together).

### 3.7 The `supersede` flow

```
supersede(oldAtomId, newInput, ctx)
  ├── 1. validate + authorize
  ├── 2. SELECT old atom FOR UPDATE  -- short row lock
  ├── 3. if locked_at IS NOT NULL → throw evidence_immutable
  ├── 4. compute new atom (steps 3-4 from emit)
  ├── 5. txn:
  │     ├── UPDATE old.status = 'superseded', superseded_by = new.id, superseded_at = now()
  │     ├── INSERT new atom
  │     └── INSERT event (kind='atom_superseded')
  └── 6. commit + publish
```

Locked atoms can be **referenced** by new atoms (the new atom's `parent_atom_id` points at the locked one), but they cannot be mutated. This is the G5 contract: once an atom enters a finalized Reproducibility Pack, it is forever a snapshot.

### 3.8 The `linkEvidence` flow

Used when the investigator later attaches a subpoena response, a memo, or a screenshot to an existing atom. **Does not mutate `payload_hash`** (the atom's content is unchanged); appends to `supporting_evidence` array and updates `confidence` (via Math Service recompute).

If the atom is locked, this falls back to emitting a new `has_confidence_score` atom whose `parent_atom_id` points at the locked one. The original confidence number stays in the Reproducibility Pack; the updated confidence is visible in the canvas going forward.

### 3.9 Caching

The Belief State Service uses a **two-tier cache**:

- **L1 (in-process, per request):** a `Map<AtomId, BeliefAtom>` populated during one request. Most handlers read the same atom 2–4 times; L1 avoids the round-trip.
- **L2 (Redis):** `getAtom` and `getAtomsBySubject` are cached for 60 seconds with key `bs:atom:{id}` / `bs:subject:{case}:{kind}:{ref}`. Writes invalidate by pattern delete.

`queryAtoms` is **not** cached — too many possible filter combinations; rely on Postgres indexes (`belief_atoms_predicate_idx`, etc.) and the 100-row LIMIT.

The L2 cache is **case-scoped**: the cache key always includes the case_id, so a tenancy bug never serves one case's data to another.

### 3.10 Streaming subscribers

Canvas pages call `bs.subscribe(caseId, ctx)` which returns an `AsyncIterable<BeliefStateEvent>`. Under the hood it's a Redis pub/sub consumer wrapped with SSE for the wire. Each subscriber filters events by `case_acl` server-side before forwarding to the client. The first event the subscriber receives is `kind: 'snapshot_marker'` carrying the current `case_seq`, so the client can backfill any events it missed via `getEvents(caseId, since_seq)`.

Subscribers are capped per case (Phase 1: 16 concurrent SSE streams) to prevent runaway connections; oldest is dropped if the cap is hit.

---

## §4 — Math Service

The Math Service owns **every number** the system produces. No other module computes value, fee, conversion, methodology, or confidence math directly.

### 4.1 Module shape

`apps/math/` — Python 3.12 + FastAPI for health/control, **grpclib** for the hot path. Deployed as `chainsight-math-dev` on Fly.io.

Dependencies:

- `grpclib` + `protobuf` — wire format
- `pydantic` v2 — schema validation
- `web3.py` 7.x — EVM decoding helpers (delegated calls; we don't reimplement ABI parsing)
- `python-bitcoinlib` (vendored) — BTC primitives
- `httpx` — Capability Router callbacks (only for fiat-price feeds; never for chain RPC — that's the API's responsibility to pre-fetch)

### 4.2 The gRPC service definition

```proto
// apps/math/proto/math.proto
syntax = "proto3";
package chainsight.math;

service MathService {
  // ---------- value math ----------
  rpc ComputeValueAtBlock(ComputeValueAtBlockRequest) returns (ComputeValueAtBlockResponse);
  rpc ComputeFeeInFiat(ComputeFeeInFiatRequest) returns (ComputeFeeInFiatResponse);
  rpc BatchPriceLookup(BatchPriceLookupRequest) returns (BatchPriceLookupResponse);

  // ---------- methodology math ----------
  rpc ApplyFifoToHop(ApplyMethodologyRequest) returns (ApplyMethodologyResponse);
  rpc ApplyLifoToHop(ApplyMethodologyRequest) returns (ApplyMethodologyResponse);
  rpc ApplyProportionalToHop(ApplyMethodologyRequest) returns (ApplyMethodologyResponse);
  rpc ApplyTaintToPath(ApplyTaintRequest) returns (ApplyTaintResponse);

  // ---------- confidence math ----------
  rpc ComputeConfidence(ComputeConfidenceRequest) returns (ComputeConfidenceResponse);

  // ---------- decode helpers ----------
  rpc DecodeAction(DecodeActionRequest) returns (DecodeActionResponse);
}
```

Selected request/response shapes:

```proto
message ComputeValueAtBlockRequest {
  string chain        = 1;        // "eth", "btc", ...
  string amount_minor = 2;        // BigInt as decimal string
  uint64 block_height = 3;
  string fiat         = 4;        // "USD"
  // Pre-fetched price snapshot if API already has it; else Math fetches via its own provider client.
  PriceSnapshot price_hint = 5;
}

message PriceSnapshot {
  string source        = 1;       // "coingecko" | "kraken" | "internal-snapshot"
  string price_usd     = 2;       // decimal string
  string snapshot_time = 3;       // ISO timestamp
  string provider_request_id = 4; // for audit
}

message ComputeValueAtBlockResponse {
  string value_native_minor = 1;  // unchanged input, for round-trip clarity
  string value_native_major = 2;  // formatted, e.g. "47.20000000"
  string value_fiat         = 3;  // decimal string, e.g. "172500.00"
  string fiat_currency      = 4;
  string price_used         = 5;
  string price_source       = 6;
  string recipe_hash        = 7;  // deterministic input fingerprint
  google.protobuf.Timestamp computed_at = 8;
}

message ApplyMethodologyRequest {
  string methodology = 1;         // "fifo" | "lifo" | "proportional"
  string chain       = 2;
  string subject_address  = 3;
  uint64 block_height_at  = 4;
  // Pre-loaded UTXO/balance set; supplied by Tracer or Inspector.
  repeated Lot existing_lots = 5;
  repeated Lot incoming_lots = 6;
  // For a hop: how much of the outflow are we tracing?
  string outflow_minor = 7;
}

message Lot {
  string lot_id        = 1;
  string acquired_minor = 2;
  string acquired_at_block = 3;
  string source_tx_hash   = 4;
  // For tainted lots: 0..1 fraction of this lot considered tainted.
  string taint_fraction   = 5;
}

message ApplyMethodologyResponse {
  repeated MethodologySelection selections = 1;
  string total_attributed_minor = 2;
  string remaining_outflow_minor = 3;
  string recipe_hash = 4;
}

message MethodologySelection {
  string lot_id = 1;
  string amount_consumed_minor = 2;
  string taint_contributed_minor = 3;
}
```

(Full proto in `apps/math/proto/math.proto`. The shapes above are representative; the proto is the source of truth and is generated into both `apps/math/pb/` and `packages/math-client/`.)

### 4.3 Determinism contract

Every Math RPC produces a `recipe_hash` over **all inputs that affected the output**, including the version of the methodology code:

```
recipe_hash = BLAKE3(
  methodology_name ||
  methodology_code_version ||           -- e.g. "fifo@v1.3.0"
  canonical_json(request_payload)
)
```

Two calls with the same `recipe_hash` MUST produce byte-identical outputs. This is the reproducibility contract — the Reproducibility Pack stores `recipe_hash` alongside the result, and the verifier replays by sending the same input and comparing hashes.

Determinism rules:

- Math Service is **stateless** between requests. No global mutation. No clock reads (except in audit timestamps which don't affect outputs).
- All floating point arithmetic forbidden in the hot path. Decimal math uses Python's `Decimal` with `getcontext().prec = 78` (covers 256-bit integers in scientific notation).
- Price lookups are **versioned at the source**: if a price hint is supplied, Math uses it verbatim; if not, Math fetches a price and the response includes the snapshot timestamp + provider request ID, so a replay must supply the same hint.

### 4.4 Methodology implementations (Phase 1)

Phase 1 ships three:

- **FIFO** — earliest acquired lots consumed first. Default for clarity / common-law jurisdictions.
- **LIFO** — latest first. Used when victim funds were the most recent inflow (some BEC scenarios).
- **Proportional** — pro-rata across all lots at the hop time. Common in mixed-pool tracing.

Taint is computed per methodology: for each selection, `taint_contributed = (lot.taint_fraction × amount_consumed)`. The recipe stores the full selection vector, not just the totals, so an investigator can later see exactly which lots fed which outflow.

### 4.5 Confidence math

```ts
// Reference TS implementation in packages/math-client/src/confidence.ts (for parity tests)

function computeConfidence(inputs: ConfidenceInputs): number {
  const w = {
    basis: { T0: 0.50, T2: 0.30, T3: 0.10 },
    corroboration: 0.10,        // up to 5 providers, 0.02 each
    sanctions: 0.05,            // bonus for OFAC-confirmed
    obfuscation: -0.10,         // penalty for mixer/peel signals
    age_decay: -0.05,           // older than 180 days
  };
  let c = w.basis[inputs.basis_tier];
  c += Math.min(0.10, inputs.provider_corroboration_count * 0.02);
  if (inputs.sanctions_match) c += w.sanctions;
  c += w.obfuscation * inputs.obfuscation_penalty;     // 0..1 from the obfuscation scan
  c += w.age_decay  * inputs.age_decay;                // 0..1
  return Math.max(0, Math.min(1, c));
}
```

The exact weights ship with `code_version` so a methodology update produces a new `recipe_hash`. Replays use the version stored in the Reproducibility Pack.

### 4.6 gRPC client integration

API and Worker use the shared `packages/math-client/` TS client:

```ts
// packages/math-client/src/index.ts

import { createChannel, createClient, Metadata, Status } from 'nice-grpc';
import { MathServiceDefinition } from './pb/math';

export class MathClient {
  private client = createClient(MathServiceDefinition, createChannel(process.env.MATH_URL!));
  // gRPC connection reuse — same channel for the life of the process

  async computeValueAtBlock(req: ComputeValueAtBlockRequest, ctx: AgencyContext): Promise<ComputeValueAtBlockResponse> {
    return this.client.computeValueAtBlock(req, {
      metadata: Metadata({
        'x-actor-id': ctx.user_id,
        'x-agency-id': ctx.agency_id,
        'x-trace-id': currentTraceId(),
      }),
      deadline: new Date(Date.now() + 2_000),         // 2 s hard timeout
    });
  }
  // ... other RPCs
}
```

Deadlines on every RPC are non-optional. A Math call that exceeds its deadline kills the request chain with `provider_unavailable` and the investigator sees a polite "math service slow — retry?" message.

### 4.7 Concurrency model

- Math Service uses a **single uvicorn process with 4 workers** per Fly machine. Each worker is single-threaded async.
- Hot path RPCs (`ComputeValueAtBlock`, `ComputeFeeInFiat`, methodology applies) are pure CPU → no event loop blocking risk; we don't await anything inside them.
- DecodeAction may need a `web3.py` RPC call (e.g. to fetch a contract ABI it doesn't have locally). Those go through an in-process LRU cache of ABIs keyed on `(chain, contract_address)`. Cold misses incur one RPC call via the API's pre-fetched cache (passed in the request payload) — Math itself does not call chain providers directly.

### 4.8 Caching

- **In-process LRU** (10 000 entries): keyed on `recipe_hash`. Same recipe = cached result. Hit ratio target ≥0.7 in steady state.
- **Redis L2** (60 s TTL): the API caches Math responses keyed on `math:{recipe_hash}` so two concurrent API requests for the same value don't hit Math twice.
- **No invalidation**: Math results are pure functions of their inputs. The cache key is the input fingerprint; if the inputs change, the key changes.

### 4.9 Observability

- Every RPC emits one structured log line: `{trace_id, rpc, recipe_hash, duration_ms, status}`.
- Prometheus counters: `math_rpc_total{rpc, status}`, `math_rpc_duration_seconds{rpc}` (histogram), `math_cache_hit_total{tier}`.
- Failure budget: 0.1 % error rate on the hot path = page; 1 % p99 latency >100 ms = warn.

---

## §5 — Transaction Inspector Pipeline

The 8-section streaming popup the investigator double-clicks any node to summon. Combines structured chain data, decoded actions, BeliefAtom citations, and LLM narrative — under a strict **citation contract** that every narrative sentence must cite a BeliefAtom or be flagged.

### 5.1 Module shape

`packages/inspector-pipeline/` — runs **inside the worker** (BullMQ consumer). The API receives the user click, enqueues `inspector:analyze` with the tx_ref and case_id, then returns immediately. The worker runs the pipeline and streams progress events back to the Web via Redis pub/sub → SSE.

### 5.2 The 8 sections

(Numbered to match the existing `/inspector-demo` mockup.)

| § | Section                  | Source                              | Streams? | Phase 1 implementation                                |
|---|--------------------------|-------------------------------------|----------|--------------------------------------------------------|
| 1 | Header (hash, block, ts) | Chain-data provider                 | No       | Structured fetch                                       |
| 2 | Parties                  | Chain + Belief State attributions   | No       | Structured fetch + atom join                           |
| 3 | Decoded action           | Math `DecodeAction`                 | Yes      | Math RPC, may stream phases                            |
| 4 | Value & fees             | Math `ComputeValueAtBlock` + `Fee`  | No       | Math RPC                                               |
| 5 | Methodology context      | Math `ApplyFifoToHop`               | No       | Math RPC; only if a path with methodology exists       |
| 6 | Counterparty attribution | Belief State + Attribution Agent    | Yes      | Agent stub Phase 1; full attribution Phase 2           |
| 7 | Narrative summary        | LLM (BYOK)                          | Yes      | Streaming token-by-token                               |
| 8 | Citations & actions      | Citation Verifier output            | No       | Computed after §7 completes                            |

Sections marked "Streams" emit incremental updates via the same pub/sub channel; the Web renders them as they arrive.

### 5.3 The pipeline state machine

```
inspector:analyze {tx_ref, case_id, ctx, idempotency_key}
  │
  ├── 0. cache lookup (Redis): inspector:{tx_ref}:{ctx.agency_id}
  │     hit → publish all 8 sections from cache → done
  ├── 1. provider fetch (parallel):
  │     ├── chain-data: full tx + receipt + traces  (Capability Router)
  │     ├── chain-data: block header
  │     └── attribution provider: known-entity lookup for counterparties
  │     ↓ section 1 + 2 ready → publish
  ├── 2. math decode (gRPC DecodeAction):
  │     ↓ section 3 ready → publish
  ├── 3. math value (gRPC ComputeValueAtBlock + ComputeFeeInFiat):
  │     ↓ section 4 ready → publish
  ├── 4. methodology (if case has a path through this tx):
  │     ↓ section 5 ready → publish (or skip)
  ├── 5. attribution agent stub (Phase 1: query existing belief atoms):
  │     ↓ section 6 ready → publish
  ├── 6. emit BeliefAtoms (one per structural fact + one per attribution)
  ├── 7. LLM narrative (BYOK via Capability Router):
  │     stream → publish tokens as they arrive
  │     final →
  ├── 8. citation verify:
  │     for each sentence in §7, verify it cites an atom_id; flag unsupported sentences
  │     ↓ section 8 ready → publish
  ├── 9. cache write: inspector:{tx_ref}:{ctx.agency_id} TTL 1 hour
  └── 10. emit BeliefAtom: predicate='inspector_run_completed', payload includes section hashes
```

Each section emit goes onto Redis at `case:{case_id}:inspector:{tx_ref}` and the Web subscribes per popup.

### 5.4 The citation contract

Every sentence in §7 (the narrative) must cite at least one BeliefAtom. The format:

```
"The transaction transferred 47.2 ETH from John Doe's Binance deposit ⟦atom:01HXY…⟧ to a Tornado Cash 10-ETH pool ⟦atom:01HXZ…⟧."
```

The Citation Verifier (§8) parses the narrative for `⟦atom:{id}⟧` markers, checks each id exists and belongs to the same case, and:

- **All sentences cited** → §8 shows a green "Citations verified · 6 atoms".
- **Some sentences uncited** → §8 lists them with a red banner: "1 sentence in this summary is not backed by a BeliefAtom. Verify before relying."
- **No sentences cited** → the whole §7 is rendered behind a "Unverified narrative — click to reveal" gate.

The LLM is prompted (system prompt in `packages/inspector-pipeline/src/prompts/narrative.ts`) to cite an atom for every factual sentence. The Critic Agent (Phase 2) catches systematic citation drift; in Phase 1, the Verifier surfaces it.

### 5.5 The LLM call (Phase 1)

- Selected model: `capability_router.select_model('inspector_narrative', ctx)`. Default per F30 marketplace: investigator's chosen "narrative" role model; falls back to a small local model if BYOK keys are absent.
- Temperature: 0.2. Top-p: 0.95. Max output tokens: 1024.
- Streaming via the provider's SSE.
- Input contains:
  - Pre-rendered §1–§6 as JSON
  - The list of BeliefAtoms emitted so far in step 6 (id + predicate + subject + object_payload)
  - A constraint message: "Every factual sentence MUST cite a BeliefAtom by id. If you cannot cite an atom, do not state the fact."
- BYOK billing: every token is metered against the investigator's connected provider; nothing flows through ChainSight's account.

### 5.6 Caching strategy

- **Hit path (cache hit):** entire response (all 8 sections) published from cache in <200 ms.
- **Cold path:** §1+§2 within 800 ms (provider RTT-bound), §3–§5 within 1.5 s (Math RPCs), §6 within 2 s (agent stub), §7 starts streaming within 3 s and completes within 8 s. P95 cold total: 5 s; P99: 10 s. **Numbers match v1.0 Backend §1.5.**
- Cache key: `inspector:{tx_ref}:{ctx.agency_id}:{methodology}` — methodology is part of the key because §5 depends on it.
- Invalidation: when a new BeliefAtom about this `tx_ref` lands, the cache for the tx_ref is dropped (across all methodologies). The next Inspector run pulls fresh atoms.

### 5.7 Idempotency + concurrency

- Two concurrent requests for the same `(tx_ref, ctx.agency_id, methodology)` are de-duplicated at the BullMQ layer: the first job runs; the second attaches as a subscriber to the same Redis channel and never re-runs the pipeline.
- The Inspector pipeline is **not** reentrant for the same job ID — a worker that crashes mid-run leaves the job in `failed`; the user sees a "retry" button. We do not silently re-do half-completed runs because the LLM call has cost.

### 5.8 Persistence

Beyond the Redis cache:

- §1–§6 results are stored in `inspector_runs` keyed on `(tx_ref, methodology, recipe_hash_bundle)` for a 30-day TTL.
- §7 narrative is **not stored** by default (it's an LLM output the user may consider sensitive); the user can choose to persist it explicitly (a "Save narrative to case" button) which emits an `investigator_commented` BeliefAtom.
- The act of running the Inspector emits a `system`-kind BeliefAtom `predicate='inspector_run_completed'` with the section hashes — that atom proves the run happened and is enough to deterministically replay.

```sql
CREATE TABLE inspector_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  case_id               uuid NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  tx_ref                text NOT NULL,
  methodology           text NOT NULL,
  ran_at                timestamptz NOT NULL DEFAULT now(),
  ran_by_id             uuid NOT NULL,
  section_1_header      jsonb,
  section_2_parties     jsonb,
  section_3_decoded     jsonb,
  section_4_value_fees  jsonb,
  section_5_methodology jsonb,
  section_6_attribution jsonb,
  section_8_citations   jsonb,
  recipe_hash_bundle    jsonb NOT NULL,  -- per-section recipe_hashes
  cache_key             text NOT NULL,
  emitted_atom_ids      uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX inspector_runs_tx_idx ON inspector_runs (tx_ref, methodology);
CREATE INDEX inspector_runs_case_idx ON inspector_runs (case_id, ran_at DESC);
```

---

## §6 — Pathfinder

The graph-search service that powers PSR's four selection modes (click / lasso / auto / NL) plus any case-internal pathing query (e.g. the Court Mode "previous hop" / "next hop" navigation).

### 6.1 Module shape

`packages/pathfinder/` — runs **inside the API**. It does not have its own process. Internally it talks to two stores:

- **PostgreSQL** (Supabase): authoritative truth for nodes/edges (denormalized from BeliefAtoms by a materialization worker).
- **In-process graph store**: a per-case adjacency cache (Map<NodeRef, Edge[]>) loaded on first query, kept warm by a 5-minute touch.

Phase 1 deliberately does **not** introduce a separate graph database (Memgraph, Neo4j). Case subgraphs are small (median 200 nodes, p99 5 000 nodes by month-3 forecast); Postgres + an in-process adjacency map is fast enough. A graph DB lands in v1.2 once we have real cardinality data.

### 6.2 The API

```ts
// packages/pathfinder/src/index.ts

export interface PathfinderService {
  // Click-to-extend: from one node, find the shortest path to another.
  shortest(req: ShortestPathRequest, ctx: AgencyContext): Promise<PathResult | null>;

  // Auto-pathfind: enumerate up to K paths from A to B with caps.
  kShortest(req: KShortestRequest, ctx: AgencyContext): Promise<PathResult[]>;

  // Lasso selection: given a set of nodes, find paths that pass through them all.
  through(req: ThroughRequest, ctx: AgencyContext): Promise<PathResult[]>;

  // Natural-language: parse the prompt to a structured query then dispatch.
  nlQuery(req: NlQueryRequest, ctx: AgencyContext): Promise<NlQueryResult>;

  // Subgraph hover queries — used by the Inspector pop-out and tooltips.
  neighbors(req: NeighborsRequest, ctx: AgencyContext): Promise<Neighbor[]>;
}

export interface ShortestPathRequest {
  case_id: CaseId;
  from: SubjectRef;
  to: SubjectRef;
  max_hops?: number;             // default 10
  /** If true, edges must respect block-height ordering (from earlier → later). */
  temporal?: boolean;            // default true
  /** Methodology — affects edge weights for taint-aware pathing. */
  methodology?: 'fifo' | 'lifo' | 'proportional';
}

export interface PathResult {
  path_id: string;               // deterministic hash of the node sequence
  nodes: SubjectRef[];
  edges: EdgeRef[];
  total_value_minor: IntegerAmount;
  total_value_fiat: string;
  obfuscation_hops: number;      // count of mixer/peel edges traversed
  bridges_crossed: number;
  earliest_block: BlockRef;
  latest_block: BlockRef;
  /** Lower = better rank in the result list. */
  rank_score: number;
  rank_inputs: {
    hop_count: number;
    value_carried: number;       // normalized 0..1
    obfuscation_penalty: number;
    bridge_penalty: number;
    age_penalty: number;
  };
  recipe_hash: string;
}
```

### 6.3 The materialized graph store

Belief State emissions are translated into an explicit edge table by a background worker (`worker:graph-materializer`, runs every 5 s coalesced):

```sql
CREATE TABLE case_subgraph_edges (
  id            uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  case_id       uuid NOT NULL,
  chain         text NOT NULL,
  from_subject  text NOT NULL,
  to_subject    text NOT NULL,
  edge_kind     text NOT NULL,             -- 'tx_native' | 'tx_token' | 'internal' | 'bridge_hop'
  tx_ref        text NOT NULL,
  edge_index    int NOT NULL,
  block_height  bigint NOT NULL,
  block_time    timestamptz NOT NULL,
  value_minor   numeric(80,0) NOT NULL,    -- big enough for any chain
  obfuscation_marker text,                 -- 'mixer' | 'peel' | NULL
  bridge_marker      text,                 -- 'native' | 'wrapped' | NULL
  source_atom_id uuid NOT NULL REFERENCES belief_atoms(id),
  UNIQUE (case_id, tx_ref, edge_index)
);
CREATE INDEX case_subgraph_edges_from_idx ON case_subgraph_edges (case_id, from_subject, block_height);
CREATE INDEX case_subgraph_edges_to_idx   ON case_subgraph_edges (case_id, to_subject, block_height);
CREATE INDEX case_subgraph_edges_kind_idx ON case_subgraph_edges (case_id, edge_kind);

CREATE TABLE case_subgraph_nodes (
  case_id       uuid NOT NULL,
  subject_ref   text NOT NULL,
  subject_kind  text NOT NULL,
  chain         text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  in_edge_count int NOT NULL DEFAULT 0,
  out_edge_count int NOT NULL DEFAULT 0,
  total_in_minor numeric(80,0) NOT NULL DEFAULT 0,
  total_out_minor numeric(80,0) NOT NULL DEFAULT 0,
  attribution_count int NOT NULL DEFAULT 0,
  sanctions_hit bool NOT NULL DEFAULT false,
  PRIMARY KEY (case_id, subject_ref)
);
```

The materializer consumes BeliefAtoms with structural predicates (`tx_exists`, `address_received`, `address_sent`, `contract_called`, `token_transferred`) and upserts rows. It is **idempotent** (UNIQUE constraint on `(case_id, tx_ref, edge_index)`); duplicate emissions are no-ops.

### 6.4 In-process adjacency cache

When `shortest` or `kShortest` is called and no cached graph exists for the case, the Pathfinder loads the case's nodes+edges into memory:

```ts
interface CaseGraph {
  case_id: CaseId;
  loaded_at: number;
  nodes: Map<SubjectRef, NodeData>;
  outgoing: Map<SubjectRef, EdgeData[]>;
  incoming: Map<SubjectRef, EdgeData[]>;
  /** For obfuscation/bridge-aware ranking. */
  edge_index: Map<string, EdgeData>;   // keyed on `${tx_ref}:${edge_index}`
}
```

Size budgets (sized for p99 5 000-node case):

- ~80 bytes per node + ~120 bytes per edge → median 200 nodes × 600 edges ≈ 90 KB; p99 5 000 × 18 000 ≈ 2.5 MB.
- Loaded graphs cached in an LRU (capacity 64 cases per API process). With 4 API replicas, that's ~250 cached cases.
- **Refresh policy:** the materializer publishes `case:{id}:graph-updated` on Redis pub/sub when it commits new edges. Each API process invalidates its local cache for that case on receipt.

### 6.5 Algorithms

**`shortest`:** BFS from `from`, with temporal ordering enforced (only traverse edges whose `block_height >= current_path_max_block_height`). Returns the first path found; null if no path within `max_hops`. P50 target <50 ms on a 5 000-node graph.

**`kShortest`:** Yen's algorithm on the in-memory graph, capped at `max_hops` (default 20) and `branching_cap` (default 50). Returns up to `K` (default 5) paths sorted by `rank_score`. P50 <500 ms on a 5 000-node graph; P99 <5 s. Hard cap of 30 s — past that, return whatever we have with a `truncated: true` flag.

**`through`:** for lasso selection — find paths that pass through every node in the lasso set. Implemented as iterated `shortest` between consecutive lassoed nodes in temporal order; if any leg has no path, the whole request returns empty.

**`neighbors`:** direct map lookup against `outgoing`/`incoming`. Returns up to `limit` (default 100) entries with optional filters on edge_kind, value range, time range.

### 6.6 Ranking

```ts
function rankScore(p: PathInputs): number {
  // Lower is better.
  return (
      p.hop_count * 1.0
    + p.obfuscation_penalty * 5.0           // an obfuscation hop adds 5 to the score
    + p.bridge_penalty * 3.0
    + (1 - p.value_carried) * 2.0           // paths carrying more value rank better
    + p.age_penalty * 1.5
  );
}
```

The rank weights are versioned (`pathfinder_rank@v1`) and included in `recipe_hash` so Reproducibility Pack replays produce the same ordering.

### 6.7 Natural-language queries

`nlQuery` accepts a freeform string and dispatches to a structured query:

```ts
export interface NlQueryRequest {
  case_id: CaseId;
  prompt: string;        // "where did the ransom go from John Doe's wallet?"
  from_hint?: SubjectRef;
  /** Methodology context. */
  methodology?: 'fifo' | 'lifo' | 'proportional';
}

export interface NlQueryResult {
  parsed_intent: NlIntent;
  paths: PathResult[];
  unresolved_terms: string[];     // entity names the parser couldn't resolve
}

type NlIntent =
  | { kind: 'forward_trace',  from: SubjectRef, until_kind?: 'exchange' | 'mixer' | 'fiat_offramp' }
  | { kind: 'backward_trace', to: SubjectRef, since_block?: number }
  | { kind: 'between',        from: SubjectRef, to: SubjectRef }
  | { kind: 'cluster_share',  cluster_ref: ClusterRef, threshold_pct: number };
```

Phase 1 parser is a small classifier (BYOK model preferred; falls back to a regex-based heuristic). The parser **returns the structured intent** to the UI, which shows it as a chip the user can correct ("I think you meant: forward trace from `eth:0x742d…` until exchange") before the Pathfinder dispatches. This is the design principle from v1.0 Frontend §F19: the system never silently runs a trace it wasn't asked for.

### 6.8 Concurrency

- One adjacency cache per case, accessed by many concurrent requests within the API process. Reads are lock-free (we never mutate a loaded graph; new edges trigger a full reload via the materializer pub/sub).
- `kShortest` is CPU-bound. To prevent one expensive query from blocking the event loop, each path enumeration call yields every 1 000 nodes expanded via `setImmediate()`. This keeps the API responsive.
- Hard concurrency cap: 4 concurrent `kShortest` queries per case (further requests queue with a 100 ms backoff). Prevents fan-out abuse.

### 6.9 Caching

- **Result cache (Redis):** `paths:{case_id}:{recipe_hash}` TTL 5 min. Two queries with identical inputs hit Redis.
- **No invalidation needed** for the recipe-hash key (different inputs = different key). The cache evicts on TTL.
- **Graph cache** is the in-process adjacency map; invalidation is by Redis pub/sub on materializer commit.

### 6.10 Observability

- Per-query: `{trace_id, case_id, algo, hop_count_max, branching_cap, paths_returned, duration_ms, cache_hit}`.
- Histogram: `pathfinder_duration_seconds{algo}`.
- Counter: `pathfinder_truncated_total{algo}` — should stay near zero.

---

## §7 — Tracer Agent

The hardest module. Builds on every preceding section. **Autonomous and human-guided hop expansion** that turns a starting address (or set) into the multi-hop subgraph the investigator needs.

### 7.1 Operating modes

| Mode             | Trigger                                    | Stop condition                                       | Phase 1?           |
|------------------|--------------------------------------------|------------------------------------------------------|--------------------|
| **single_hop**   | User clicks "expand from this node"        | One hop completed                                    | yes                |
| **forward_n**    | User picks "trace forward 10 hops"         | `n` hops or natural stop (exchange, fiat off-ramp)   | yes                |
| **backward_n**   | User picks "trace backward 5 hops"         | `n` hops or natural stop (coinbase, exchange in)     | yes                |
| **autonomous**   | User starts "auto-trace" on a case         | Budget exhausted OR all frontiers terminated         | yes                |
| **boundary_walk**| User picks "find all off-ramps"            | All paths reach a terminal entity                    | Phase 1.5          |
| **between**      | User selects start + end                   | Path exists or budget exhausted                      | Phase 1.5          |

### 7.2 Module shape

`packages/tracer-agent/` — runs **inside the worker**. Orchestrates calls to:

- Capability Router → chain-data provider (fetching hop neighbors)
- Math Service (value / fee / methodology)
- Belief State (emit BeliefAtoms for every discovered edge)
- Critic Agent stub (Phase 1: stubbed; Phase 2: real)
- Attribution Agent stub (Phase 1: existing belief-atom lookup only)

### 7.3 The trace job

```ts
export interface TraceJob {
  job_id: Uuid;
  case_id: CaseId;
  ctx: AgencyContext;
  idempotency_key: string;

  mode: TraceMode;
  origin: SubjectRef[];          // 1 for single-source modes, ≥1 for autonomous
  direction: 'forward' | 'backward' | 'both';

  // Caps
  max_hops_per_path: number;     // default 12
  max_total_hops: number;        // default 200
  branching_cap: number;         // default 30 (per frontier expansion)
  budget_usd: number;            // BYOK provider spend cap; default $5

  // Methodology
  methodology: 'fifo' | 'lifo' | 'proportional';
  taint_threshold: number;       // default 0.01 — below this, stop tracing the lot

  // Stop conditions
  terminate_at_kinds: TerminationKind[];   // ['exchange','mixer','fiat_offramp','coinbase']
  terminate_at_subjects?: SubjectRef[];    // user-supplied list

  // Progress
  emit_progress_every_n_hops: number;      // default 1 — emit progress on every hop
}

export type TraceMode =
  'single_hop' | 'forward_n' | 'backward_n' | 'autonomous' | 'boundary_walk' | 'between';
```

### 7.4 The hop pipeline (per hop)

```
expandHop(frontier_node, direction, ctx, budget_remaining)
  ├── 1. budget check: budget_remaining > 0?  No → terminate this branch.
  ├── 2. cache lookup: cached neighbors for (node, direction, block_window)?
  │     yes → use cached; no → continue.
  ├── 3. Capability Router: select chain-data provider with capability=neighbors
  ├── 4. provider RPC: fetch incoming/outgoing edges within block window
  │     budget_remaining -= rpc_cost
  ├── 5. for each edge:
  │     ├── a. determine if it crosses a boundary (bridge, swap pool, mixer)
  │     ├── b. call Math.ApplyMethodologyToHop with current path's lots
  │     ├── c. if taint_contributed_minor / total_value_minor < taint_threshold → drop
  │     ├── d. emit BeliefAtoms (structural: tx_exists, address_received/sent;
  │     │     analytic: has_taint_share, has_obfuscation_marker if applicable)
  │     └── e. enqueue counterpart node onto the frontier with carried lots
  ├── 6. critic stub: any flagged sentences in the hop's evidence? Phase 1: no-op.
  └── 7. return new frontier nodes
```

### 7.5 The frontier

```ts
interface Frontier {
  nodes: PriorityQueue<FrontierEntry>;
  visited: Set<SubjectRef>;
  total_hops: number;
  budget_remaining_usd: number;
}

interface FrontierEntry {
  node: SubjectRef;
  carried_lots: Lot[];          // lots of value being traced through this branch
  hop_index: number;            // how deep this branch is from origin
  parent_atom_id: AtomId;       // for chaining
  priority_score: number;       // lower = expand sooner
}
```

Priority score:

```ts
function frontierPriority(e: FrontierEntry): number {
  return (
      e.hop_index * 1.0
    - log10(totalTaintMinor(e.carried_lots)) * 0.5    // expand high-value branches first
  );
}
```

The trace is a best-first traversal — high-value branches with low hop count expand first. The investigator sees the most likely "where did the money go" path emerge in the first few seconds, even when the full traversal will take longer.

### 7.6 Budget tracking

Every chain-data RPC has a provider-specific cost. The Capability Router emits cost-per-call metadata:

```ts
interface ProviderCostMeta {
  capability: string;
  estimated_usd: number;
  measured_usd?: number;          // filled after-call when the provider returns billing
}
```

The Tracer maintains a running `budget_remaining_usd` and aborts (terminates the branch, then emits a final progress event with `reason: 'budget_exhausted'`) when it hits zero. The investigator sees how much budget was used in the trace summary and can re-launch with a higher cap.

### 7.7 Termination

A branch terminates when **any** of:

- `hop_index >= max_hops_per_path`
- Visited cycle detected
- Carried taint drops below `taint_threshold`
- Counterpart node is in `terminate_at_subjects` (user-supplied target)
- Counterpart node's attribution is in `terminate_at_kinds` (e.g. an exchange deposit, which the investigator typically doesn't want to trace further into — they'll subpoena the exchange instead)

A trace job terminates when:

- All branches terminated (success)
- `total_hops >= max_total_hops` (cap)
- `budget_remaining_usd <= 0` (budget exhausted)
- 30-minute wall-clock cap (sanity guard)
- User explicitly cancels (UI button → `trace:cancel` job)

### 7.8 Progress events

Streamed via Redis pub/sub on `case:{id}:trace:{job_id}`:

```ts
export type TraceProgressEvent =
  | { kind: 'started', total_origins: number }
  | { kind: 'hop_completed', hop_index: number, new_atoms: AtomId[], new_edges: number, budget_remaining_usd: number }
  | { kind: 'branch_terminated', node: SubjectRef, reason: TerminationReason }
  | { kind: 'frontier_progress', frontier_size: number, total_hops_so_far: number }
  | { kind: 'completed', summary: TraceSummary }
  | { kind: 'failed', error: ApiError };
```

Web subscribes via SSE. The canvas renders new nodes/edges as `hop_completed` arrives — the same pub/sub channel feeds both the trace progress panel and the canvas live updates (via the materializer's edge writes).

### 7.9 Concurrency

- **Within a job:** the worker can expand up to **8 frontier nodes in parallel** (configurable). Math calls and Belief State emits are async, so we don't wait for one hop before starting the next. Cap is per-job to prevent one trace from saturating provider rate limits.
- **Across jobs:** BullMQ concurrency is set to **4 trace jobs per worker machine**. With 2 worker machines that's 8 traces in flight org-wide.
- **Per-case lock:** at most one autonomous trace per case at a time. Single-hop and forward_n are unlocked (the user explicitly initiated them; multiple are fine).
- **Provider rate limiting:** the Capability Router enforces per-provider, per-API-key rate limits (token bucket). When a bucket is empty, the Tracer **pauses the frontier**, waits, and resumes — it does not fail.

### 7.10 Idempotency + cancellation

- Idempotency key = `BLAKE3(case_id || origin || mode || methodology || max_hops || budget)`. Re-issuing the same trace within 24 h returns the existing job's result (or in-progress handle).
- Cancellation: `trace:cancel` job with the same `job_id`. The running worker checks a `cancelled` flag every hop and terminates gracefully. Already-emitted BeliefAtoms remain (they are facts; the cancel doesn't unprove them).

### 7.11 Reproducibility

The trace job's `idempotency_key`, plus the provider response hashes for every RPC made, are stored in:

```sql
CREATE TABLE trace_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  case_id            uuid NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  initiated_by_id    uuid NOT NULL,
  mode               text NOT NULL,
  origin             text[] NOT NULL,
  methodology        text NOT NULL,
  params             jsonb NOT NULL,
  idempotency_key    text NOT NULL,
  status             text NOT NULL DEFAULT 'queued',
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  total_hops         int NOT NULL DEFAULT 0,
  total_atoms_emitted int NOT NULL DEFAULT 0,
  total_budget_spent_usd numeric(12,4) NOT NULL DEFAULT 0,
  provider_response_hashes jsonb NOT NULL DEFAULT '[]',
  termination_reason text,
  UNIQUE (case_id, idempotency_key)
);
CREATE INDEX trace_jobs_case_idx ON trace_jobs (case_id, started_at DESC);
```

A trace is **deterministic given the same provider responses** — for the Reproducibility Pack, the verifier replays the trace by injecting the cached provider responses (stored as part of the pack) and re-emitting atoms. Recipe hashes for every Math call must match.

### 7.12 Observability

- Tracing spans (OpenTelemetry): one root span per trace job, child span per hop.
- Per-hop metrics: `tracer_hop_duration_seconds`, `tracer_provider_rtt_seconds`, `tracer_budget_consumed_usd_total`.
- Per-job metrics: `tracer_jobs_completed_total{mode, termination_reason}`, `tracer_atoms_emitted_total`.
- Slow trace alert: any job exceeding 10 minutes pages the on-call (typically the dev — me).

---

## §8 — Cross-cutting concerns

### 8.1 Concurrency strategy summary

| Layer                       | Concurrency model                            | Cap                                              |
|----------------------------|----------------------------------------------|--------------------------------------------------|
| API (Fastify)               | Single Node process, async-first             | 200 concurrent requests / machine (default)      |
| Worker (BullMQ)             | One process per Fly machine; per-queue limits| `inspector:4 · trace:4 · materializer:1 · misc:8`|
| Math Service                | uvicorn 4 workers per machine                | 100 RPCs/sec per machine (CPU-bound headroom)    |
| Belief State (in-process)   | Lock-free reads; row-level locks on write    | Bound by Postgres connection pool                |
| Postgres                    | PgBouncer (Supabase) — transaction-mode pool | 100 conns/API · 25 conns/worker                  |
| Redis (Upstash)             | Single primary; we use it for pub/sub + cache| 1 000 cmd/sec on the free tier (paid in prod)    |
| Pathfinder                  | In-API; CPU-yield every 1 000 nodes          | 4 concurrent kShortest per case                  |
| Tracer Agent                | 8 frontier expansions per job in parallel    | 4 traces per worker machine                      |

### 8.2 Caching summary

| Cache                            | Layer        | Key                                       | TTL     | Invalidation                          |
|----------------------------------|--------------|-------------------------------------------|---------|---------------------------------------|
| Belief atom L1                   | API in-proc  | `atom_id`                                 | request | end of request                        |
| Belief atom L2                   | Redis        | `bs:atom:{id}` / `bs:subject:{case}:{k}:{r}` | 60 s | pattern delete on write               |
| Math results                     | Math in-proc + Redis | `math:{recipe_hash}`              | 60 s    | no invalidation needed                |
| Pathfinder graph                 | API in-proc  | `case_id`                                 | 5 min   | pub/sub on materializer commit        |
| Pathfinder results               | Redis        | `paths:{case_id}:{recipe_hash}`           | 5 min   | TTL only                              |
| Inspector full response          | Redis        | `inspector:{tx_ref}:{agency}:{methodology}` | 1 h   | belief-atom change on `tx_ref`        |
| Tracer hop neighbors             | Redis        | `tracer:neighbors:{chain}:{addr}:{dir}:{block_window}` | 5 min | TTL only                |
| Provider raw responses           | Redis        | `provider:{provider}:{request_hash}`       | 24 h    | TTL only; replayable from pack        |

### 8.3 Observability stack

- **Logs:** structured JSON to stdout; shipped by Fly's log drain to Logtail (or Datadog in prod). Every log line has `trace_id` and `actor_id` (hashed where PII concerns apply).
- **Metrics:** Prometheus scrape endpoint on each Fly app (`/internal/metrics`); aggregated to a single ChainSight Prometheus instance.
- **Traces:** OpenTelemetry; one root span per HTTP request, child spans per RPC. Sampled at 100 % in Phase 1; subsampled later.
- **Audit:** Belief State events table is the system's primary audit log. Supervisor actions go to `supervisor_audit_events` (v1.1 §3.3). Provider RPC summaries (no payloads, just timing + cost) go to `provider_call_audit`.

### 8.4 Failure modes & circuit breakers

| Failure                                | Detection                              | Response                                                       |
|---------------------------------------|----------------------------------------|----------------------------------------------------------------|
| Math Service down                      | gRPC connection refused or 3 timeouts  | API returns `provider_unavailable` to caller; UI shows banner  |
| Provider rate-limited                  | 429 from provider                      | Capability Router pauses bucket; trace pauses frontier         |
| Provider returning bad data            | Validation fails on chain-data shape   | Drop the response, emit BeliefAtom with predicate `provider_error`, surface to UI |
| Belief State DB write contention       | Lock-wait timeout >2 s                 | Retry once with jitter; then fail with `internal`              |
| LLM provider error mid-stream          | Stream truncation                      | Emit `inspector:section_failed` event; user can retry §7 only  |
| Redis pub/sub disconnect               | Lost subscription                      | API auto-reconnects; first event after reconnect is `snapshot_marker` so the Web backfills |
| Worker OOM                             | Fly health check fails                 | Fly restarts the machine; jobs in-flight are retried by BullMQ |

No service depends on any other being 100 % up. The system degrades gracefully: Math down → no value math, but the canvas still loads atoms. Provider down → no new edges, but existing edges are still browseable.

### 8.5 Capacity targets (Phase 1 acceptance)

For a typical pilot agency (5 active investigators, 25 active cases, median case 200 nodes):

| Metric                                            | Target           |
|---------------------------------------------------|------------------|
| API P50 / P99 latency (cache hit)                 | 50 ms / 200 ms   |
| API P50 / P99 latency (cold)                      | 200 ms / 1 s     |
| Inspector cold P50                                | 3 s              |
| Inspector cold P99                                | 8 s              |
| Trace 10-hop P50                                  | 18 s             |
| Trace 10-hop P99                                  | 60 s             |
| Pathfinder kShortest P50 (5 k-node case)          | 500 ms           |
| Pathfinder kShortest P99                          | 5 s              |
| Math RPC P99                                      | 100 ms           |
| Belief State emit P99                             | 40 ms            |
| End-to-end trace job (autonomous, 50 hops)        | <5 min           |
| End-to-end Reproducibility Pack build (50-hop trace) | <2 min        |
| Concurrent trace jobs org-wide                    | 8                |
| Concurrent inspector runs org-wide                | 16               |

### 8.6 The Phase 1 acceptance test

The single end-to-end test the system must pass to call Phase 1 done:

1. Investigator pastes an Ethereum tx hash into `/cases/{new}` intake.
2. Inspector pops, streams all 8 sections within 8 s, every sentence in §7 cites an atom.
3. Investigator clicks "Trace forward 10 hops" — Tracer runs autonomously, canvas populates live as edges arrive.
4. PSR mode activates; investigator shift-clicks a path through 5 hops; Path & Report Draft drawer populates.
5. Investigator clicks "Finalize" → Reproducibility Pack is built, hash chain validated.
6. Verifier replays the pack offline (CI runs this in a separate container) → produces byte-identical output, identical recipe hashes.
7. Court Mode renders the path in presenter view, accounting methodology panel locks to the case's chosen methodology.
8. Total elapsed time: investigator-perceived <90 s for the happy path.

Steps 1–4 and 7 already work in the Phase-0 mockups with stubbed data. Steps 5–6 are the hard new work and are the bar Phase 1 must clear.

---

## §9 — What we are NOT building (anti-features)

Reaffirming F41 with module-specific implications:

- **No silent telemetry from the Math, Tracer, or Pathfinder modules.** All RPCs are logged but never uploaded to ChainSight Inc.; logs ship to the agency's own log sink.
- **No predictive scoring of human behavior.** Confidence math scores *evidence quality*, not *suspect likelihood*.
- **No demographic correlation anywhere.** The schema literally has no field for demographic attributes. The data engineer is instructed (in `docs/chainsight_v1_0_data_engineering.md`) to refuse any feature request that requires one.
- **No central directory of who is tracing what.** CADNP (Supervisor Dashboard Addendum §6) is the only cross-agency surface, and it is bilateral, opt-in, audit-logged, and never reveals case content.
- **No key escrow.** BYOK is BYOK. The Capability Router accepts a token, uses it for one request, and does not persist it in any form retrievable by ChainSight personnel. The pilot test for this: a ChainSight engineer cannot, even with root on the production machines, recover a customer's Etherscan key.
- **No LLM-emitted facts.** §7 narratives can summarize but every factual sentence must cite a BeliefAtom. The Citation Verifier is a hard guard, not a polite suggestion.

---

## §10 — Open questions

1. **Cross-chain methodology** — does FIFO across a bridge hop carry the lots forward, or restart the lot accounting on the destination chain? Current design: carry forward; needs accountant sign-off before Phase 1 ships.
2. **Re-org handling** — for chains with frequent reorgs (most non-EVM), what's the policy when a previously-traced edge gets reorged out? Current design: the materializer detects (via provider notification) and emits `atom_retracted` with reason `chain_reorg`; the canvas re-renders. Needs a real test on Solana before declaring solved.
3. **Pathfinder graph DB migration** — at what case-cardinality do we move from Postgres + in-process map to Memgraph? Tentative threshold: median case >2 000 nodes OR p99 >50 000 nodes. Revisit at month-6.
4. **Tracer parallelism vs. provider rate limits** — 8 parallel expansions may exhaust a free Etherscan key in 1 minute. Need pilot-customer data on real BYOK tier limits before locking the default.
5. **Inspector §7 prompt size** — at very large cases, the BeliefAtom list passed into the LLM may exceed context. Current plan: rank atoms by relevance to the tx and pass top-50; the rest are linkable but not included. Needs a quality eval before Phase 1 ships.
6. **Supervisor write atoms** — supervisor deconfliction decisions (§5 of the v1.1 Supervisor Dashboard Addendum) are the only supervisor-written atoms. Should they have a separate `actor_kind` ('supervisor' vs 'investigator')? Current design: yes — the predicate prefix `supervisor_` is enough, but if downstream analytics need the distinction more cleanly, we add the column. Defer until we have analytics.

---

## §11 — Cross-references

- **v1.0 Engineering** — Part 3 (stack) · Part 6 (data model) · Part 9 (daily principles)
- **v1.0 Backend Architecture** — §0 (Fly topology) · §1.3–§1.6 (service decomposition) · §2 (API contracts) · §3 (message schemas) · §4 (state management)
- **v1.0 Data Engineering** — schema conventions · index strategy · materialization patterns
- **v1.0 AI/ML Engineering** — §2.3 (Tracer Agent spec, base) · §2.x (other agent specs) · §3 (cost guardrails) · §4 (model selection)
- **v1.0 Frontend Architecture** — §F19 (PSR) · §F30 (BYOK marketplace) · §1 (App Router)
- **v1.0 Security & Sovereignty** — BYOK pepper rotation · audit-log integrity · mTLS for gRPC in prod
- **v1.0 Compliance Legal** — Reproducibility Pack admissibility framing · G5 immutability contract
- **v1.0 DevOps Deployment** — Fly app inventory · GitHub Actions deploy.yml · log/metric shipping
- **v1.1 Supervisor Dashboard Addendum** — §6 (CADNP — relies on Belief State and the supervisor_deconfliction_decision predicate)
- **v0.3 G4 / G5** — Freeze Request workflow · Reproducibility Pack G5 immutability
- **v0.5_2 F19** — PSR selection modes (the four Pathfinder dispatch targets)
- **v0.6 F25** — Personal Attribution Library (consumed by Inspector §2 + Tracer hop attribution lookup)
- **v0.8 F27 / F28 / F29** — Supervisor Mode · Case Transfer · Chain of Custody

---

## §12 — Build checklist for Phase 1 week 1

The literal first day's work, in order:

1. Create `packages/belief-state/` with the interface in §3.1, mocked implementation that just throws "not implemented." Wire it into the API via DI.
2. Add `belief_atoms` + `belief_events` + `case_event_seq` migrations to `apps/api/db/migrations/`. Apply against Supabase dev.
3. Implement `emit()` end-to-end — validation, authz, Math stub, payload hash, txn, event publish.
4. Write the smoke test: emit one atom, query it back, confirm event appears.
5. Add RLS policies; add a test that confirms cross-tenant read returns 0 rows.
6. Implement `getAtom`, `queryAtoms`, `getAtomsBySubject` with the L1/L2 cache. Add tests for cache invalidation on write.
7. Wire `BeliefStateService` to Redis pub/sub publisher.
8. Add the `subscribe(caseId)` SSE endpoint to the API. Implement the snapshot-marker + backfill protocol.
9. Convert `/inspector-demo`'s "save citation" button (currently a UI stub) to a real `emit` call → confirm the new atom appears in the live event stream.

Once that loop is green, week 2 starts on Math Service. The rest of the spec assumes these foundations.

---

*End of v1.1 Technical Core Engineering Specification.*
