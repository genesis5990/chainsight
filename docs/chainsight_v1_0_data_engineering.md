# ChainSight v1.0 — Data Engineering Design

> **Audience:** Solo developer + AI agents building ChainSight. This document is the canonical data engineering reference, one of eight discipline outputs feeding the v1.0 integrated index. Read the [v1.0 engineering document](chainsight_v1_0_engineering.md) first.
>
> **Status:** Deep-pass design. DDL is write-ready for Phase 0. Sections marked _[Best-guess]_ represent choices stable enough to build on but worth revisiting after the first pilot.
>
> **Locked decisions cited by ID:** G10 (transaction-centric graph), F23 (cache layer), F24 (UTXO clustering), F25 (personal attribution), F29 (chain of custody), B1 (Belief State), B3 (Reproducibility Pack), B8 (encryption), v0.3 BYOK, v0.5 F2 (document ingest with swappable storage).

---

## Stack Reality (Confirmed by Founder)

| Layer              | SaaS Blind v1 (Phase 0–1)                   | On-Prem Sovereign                    | Migrate-to target (Phase 2)  |
| ------------------ | ------------------------------------------- | ------------------------------------ | ---------------------------- |
| **Postgres**       | Supabase managed Postgres 16                | Self-hosted Postgres 16              | AWS RDS PostgreSQL 16        |
| **Auth**           | Supabase Auth (JWT, `auth.uid()`)           | Ory Kratos or custom                 | AWS Cognito or self-managed  |
| **pgvector**       | Supabase Postgres (built-in)                | pgvector extension                   | AWS RDS (pgvector supported) |
| **Object storage** | Supabase Storage                            | MinIO / Ceph / NFS                   | AWS S3                       |
| **Realtime**       | Supabase Realtime (notifications, presence) | Custom WebSocket / NATS              | AWS AppSync or custom        |
| **Graph store**    | Memgraph on Fly.io volumes                  | Memgraph on customer hardware        | Memgraph on AWS EC2          |
| **Cache**          | Upstash Redis or Fly.io Redis               | Self-hosted Redis                    | AWS ElastiCache              |
| **Cold storage**   | Supabase Storage (Parquet)                  | MinIO (Parquet)                      | AWS S3 (Parquet)             |
| **App hosting**    | Fly.io (API, workers, math service)         | Docker / K8s / Helm                  | AWS EKS                      |
| **CI/CD**          | GitHub Actions                              | GitHub Actions (self-hosted runners) | GitHub Actions               |

**Migration commitment:** SaaS Blind v1 runs on Supabase through Phase 1. During Phase 2, when SOC 2 Type 1 prep begins, the operational store migrates to AWS RDS + S3 + EKS. The schema and access patterns are designed to be portable from day one — no Supabase-isms baked into application logic that would block migration.

**The rule:** Supabase features are used at the **infrastructure layer** (connection pooling, RLS enforcement, Auth JWT, Storage upload API). Application code uses standard Postgres SQL, S3-compatible APIs, and standard Redis commands — all of which port directly to AWS.

---

## Table of Contents

1. Chain Data Ingestion Architecture
2. Cold Storage Schema (Parquet on S3-Compatible)
3. Hot Graph Schema (Memgraph)
4. Postgres Schema — Canonical Operational Store (Full DDL)
5. Supabase RLS Policy Patterns
6. Belief State Event Store
7. The Cache Layer (F23) — Full Detail
8. Reproducibility Pack Format
9. Document Storage (Supabase Storage + Swappable Backends)
10. UTXO Clustering Data Model (F24)
11. Vector Store (pgvector in Supabase)
12. Supabase Realtime Integration
13. Data Migrations and Schema Evolution
14. Backup and Disaster Recovery
15. Performance Benchmarks and Capacity Planning
16. Phase 0 Implementation Plan (Weeks 1–8)
17. Open Questions

---

## Section 1 — Chain Data Ingestion Architecture

### 1.1 The problem space

Blockchain data enters the platform through two fundamentally different paths: **pull** (investigator-triggered, capability-router mediated) and **stream** (provider-pushed, live event). The data engineering layer must handle both without coupling business logic to any specific provider.

The capability router (locked in v0.3 BYOK) means no code ever calls Etherscan directly. The data layer's job is to receive what the router returns, normalize it, persist it in the right tier, and make it queryable. This section covers everything from the provider wire to the moment normalized data is readable by the graph builder.

### 1.2 Provider taxonomy for chain data

Chain data providers fall into three categories with distinct ingest patterns:

| Category                        | Examples                                            | Ingest pattern                                                | Latency    |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ---------- |
| **Indexed REST APIs**           | Etherscan, Blockchair, Solscan, Tronscan            | Pull on demand; pagination for history                        | 100ms–2s   |
| **Multi-chain data warehouses** | Allium, Dune, Goldsky, Covalent                     | SQL/REST pull; batch friendly; Parquet export                 | 1s–30s     |
| **Archive RPC nodes**           | Alchemy, Infura, QuickNode, self-hosted Erigon/Reth | eth_getTransactionByHash, debug_traceTransaction, eth_getLogs | 50ms–500ms |
| **Streaming providers**         | Allium Kafka, QuickNode Streams, Blocknative        | Push; Kafka consumer pattern                                  | sub-second |

Phase 0 uses only the first three (pull-based). Streaming is deferred to Phase 3 (Watcher Agent).

### 1.3 Capability router interface (data layer side)

The capability router (defined in `/packages/capability-router`) returns a typed `ProviderResponse` object. The data layer consumes this interface — it never knows which provider produced the data.

```typescript
// packages/shared-types/src/provider.ts

interface ProviderResponse<T> {
  capability: string; // "get_tx_by_hash", "get_address_history", etc.
  provider_install_id: string; // UUID of the AgencyProviderInstall
  payload: T; // typed by capability
  fetched_at: Date;
  response_time_ms: number;
  raw_headers: Record<string, string>; // for cache-control, rate-limit, etc.
  from_cache: boolean;
  cache_key: string | null;
}

// The capability normalizer contract — every provider connector implements this
interface CapabilityNormalizer<RawT, NormalizedT> {
  capability: string;
  normalize(raw: RawT, chain: ChainId): NormalizedT;
  validate(normalized: NormalizedT): ValidationResult;
}
```

Every provider connector implements `CapabilityNormalizer` for each capability it satisfies. The output of `normalize()` is a canonical representation that the data layer writes to storage.

### 1.4 Per-chain ingest workers

Chain data ingestion runs in BullMQ workers on Fly.io (`/apps/worker`). Each chain has its own worker queue to allow independent scaling and failure isolation.

```
Queue: chain-ingest-ethereum    -- Ethereum mainnet + EVM L2s using eth_ namespace
Queue: chain-ingest-bitcoin     -- Bitcoin (Phase 1)
Queue: chain-ingest-solana      -- Solana (Phase 2)
Queue: chain-ingest-tron        -- Tron (Phase 2)
Queue: chain-ingest-utxo-other  -- BCH, LTC, Doge (Phase 3)
```

Each job is typed by capability:

```typescript
interface IngestJob {
  job_type: 'pull_tx' | 'pull_address_history' | 'pull_block' | 'pull_logs';
  chain: ChainId;
  case_id: string; // null for global_chain_data scope pulls
  agency_id: string;
  args: Record<string, unknown>;
  priority: number; // 1 (high, investigator-triggered) to 10 (low, background)
  idempotency_key: string; // prevents duplicate ingest on retry
}
```

Worker execution flow:

```
1. Dequeue job
2. Check cache (Redis) → cache hit: return cached data, log BeliefAtom provenance, done
3. Cache miss: call capability_router.resolve(capability, args)
4. Router calls provider, returns ProviderResponse<RawT>
5. Normalizer.normalize(raw, chain) → CanonicalTx | CanonicalAddress | etc.
6. Normalizer.validate(normalized) → ValidationResult
7a. If validation fails: log error, emit to dead-letter queue, do NOT persist partial data
7b. If validation passes:
    - Write to Supabase Postgres (operational store) if case-scoped data
    - Write to cold store queue if global chain data (Supabase Storage Parquet bucket)
    - Write to cache (Redis) with appropriate TTL
    - Enqueue graph builder job (write to Memgraph on Fly.io)
    - Emit BeliefAtom provenance event
8. Acknowledge job
```

Failures at step 7a go to `chain-ingest-dlq-{chain}` with full context for manual review.

### 1.5 Canonical data models (post-normalization)

These are the DTOs that flow between ingest and storage — not the Postgres DDL (Section 4), but the typed intermediates.

```typescript
// Unified transaction representation (handles both UTXO and account model)
interface CanonicalTransaction {
  chain: ChainId;
  tx_hash: string; // hex, lowercase
  block_height: number;
  block_hash: string;
  timestamp: Date; // from block header, UTC
  status: 'success' | 'failed' | 'pending' | 'reorged_out';
  fee_native: bigint; // in chain's smallest unit (satoshis, wei, lamports)
  fee_fiat_usd: string; // Decimal string, computed at block time

  // Account model fields (EVM, Solana, Tron)
  from_address?: string;
  to_address?: string;
  value_native?: bigint;
  value_fiat_usd?: string;
  input_data?: string; // hex
  internal_calls?: CanonicalInternalCall[];
  log_events?: CanonicalLogEvent[];

  // UTXO fields (Bitcoin family)
  inputs?: CanonicalUTXOInput[];
  outputs?: CanonicalUTXOOutput[];
  is_coinbase?: boolean;

  // Cross-chain context
  l2_batch_ref?: string; // for L2 txs, the L1 batch tx hash
  rollup_sequencer?: string; // address of the sequencer that ordered this tx

  // Metadata
  raw_provider_id: string; // which provider supplied this
  fetched_at: Date;
  normalization_version: string; // semver of the normalizer used
}

interface CanonicalUTXOInput {
  txid: string;
  vout: number;
  address: string;
  value_native: bigint;
  sequence: number;
  witness: string[] | null;
  script_type: 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'p2pk' | 'unknown';
}

interface CanonicalUTXOOutput {
  vout: number;
  address: string | null; // null for OP_RETURN
  value_native: bigint;
  script_type: string;
  is_op_return: boolean;
  op_return_data: string | null;
  spent_by_txid: string | null; // null if unspent
  spent_at_height: number | null;
}

interface CanonicalAddress {
  chain: ChainId;
  address: string;
  normalized_address: string; // checksum for EVM, bech32 for BTC
  address_type: 'eoa' | 'contract' | 'multisig' | 'utxo' | 'program';
  first_seen_block: number | null;
  last_seen_block: number | null;
  tx_count: number;
  balance_native: bigint;
  balance_fiat_usd: string;
  fetched_at: Date;
}
```

### 1.6 Chain reorg handling

Reorgs are the primary data-integrity risk in chain ingestion. The strategy:

**Detection:** The ingest worker tracks the last N block hashes (N = 20 for Ethereum, N = 6 for Bitcoin) for each chain in Redis. On every new block ingestion, it checks whether the parent hash matches the stored tip. A mismatch signals a reorg.

```typescript
// Redis key pattern for tip tracking
// chain_tip:{chain_id} → { block_height, block_hash, parent_hash, first_seen_at }
// chain_tip_history:{chain_id} → sorted set of (block_hash → block_height), keeping last 20
```

**Response:** When a reorg is detected:

1. Identify the fork point (walk back until hashes agree).
2. Query the canonical chain for the blocks in the reorg window.
3. For each transaction that was in the reorged blocks:
   - Set `status = 'reorged_out'` in Postgres `transaction_nodes` table.
   - Add a reorg event to the `chain_of_custody_records` for any case that referenced that transaction.
   - Invalidate all cache entries scoped to those transactions (Redis: delete by key pattern, Postgres: update `cache_entries.expires_at = NOW()`).
   - Emit a `BeliefAtom` with `predicate = 'tx_reorged_out'` and tier T0.
4. Re-ingest the canonical replacement blocks.
5. Log the reorg event to the immutable audit log.

**Finality model by chain:**

| Chain                      | Finality model                       | Safe confirmation depth               | Reorg risk                  |
| -------------------------- | ------------------------------------ | ------------------------------------- | --------------------------- |
| Ethereum (PoS)             | Deterministic at 2 epochs (~12 min)  | 32 blocks for economic finality       | Very low post-merge         |
| Bitcoin                    | Probabilistic                        | 6 blocks (standard), 100 for coinbase | Low but non-zero            |
| Base / Arbitrum / Optimism | Deterministic on L1 batch posting    | 1 block on L2, ~15 min on L1          | Near-zero for sequenced txs |
| Solana                     | Deterministic at ~32 slots (~13 sec) | 32 slots                              | Low                         |
| Tron                       | DPOS finality                        | 19 blocks                             | Low                         |

_[Best-guess]_ The 20-block history window is generous for Ethereum but tight for a deep Bitcoin reorg. Revisit after Bitcoin integration.

### 1.7 Streaming ingest (Phase 3)

Deferred. The architecture reserves `chain-ingest-stream-{chain}` queues for Kafka consumers, but they are not wired in Phase 0 or Phase 1. When wired, the streaming normalizers will implement the same `CapabilityNormalizer` interface, and the persisted output will be identical to pull-based ingest.

When Supabase Realtime is relevant at this layer: the ingest workers will publish new transaction/address events to a Supabase Realtime channel (`chain:ethereum:new_tx`) that the frontend canvas subscribes to for live graph updates. This replaces a separate WebSocket server.

### 1.8 Rate limiting and backpressure

BullMQ rate limiting is configured per queue, not per provider. The capability router holds per-provider rate-limit state in Redis (Upstash or Fly.io Redis):

```
provider_ratelimit:{provider_install_id} → {
  requests_this_minute: number,
  requests_this_day: number,
  reset_at_minute: timestamp,
  reset_at_day: timestamp,
  hard_cap_minute: number,
  hard_cap_day: number
}
```

When the router detects that a provider is near its rate limit, it falls back to the next install in the priority chain. If all installs for a capability are exhausted, the job returns to the queue with a delay calculated from the nearest reset time.

---

## Section 2 — Cold Storage Schema (Parquet on S3-Compatible)

### 2.1 Purpose and scope

Cold storage holds **global chain data** — confirmed transaction records, block headers, log events, UTXO sets — that are:

- Immutable once finalized (modulo reorgs, handled in Section 1.6)
- Too large for Postgres long-term
- Needed for bulk analytical queries (wallet history, tracing fan-out, batch attribution)
- Required as frozen snapshots in Reproducibility Packs

**SaaS Blind v1 (Supabase Storage):** Cold Parquet files land in a dedicated Supabase Storage bucket (`chain-data`). Supabase Storage is S3-compatible — the application uses the `@supabase/storage-js` client or the AWS SDK with the Supabase Storage endpoint.

**On-Prem:** MinIO with identical bucket names and path structure.

**Phase 2 migration:** AWS S3 with same structure. The cold store bucket path convention is identical across all three backends. Migration is a copy job + config change.

Cold storage is **not** for case-specific data (that lives in Postgres), personal attributions, or documents (Section 9).

### 2.2 Storage bucket structure

```
bucket: chain-data          (Supabase Storage SaaS / MinIO On-Prem / S3 Phase 2)
  raw/                      provider raw responses (JSON, gzipped), keyed by content hash
  canonical/                normalized Parquet, partitioned by chain/date
  reorg-archive/            superseded blocks, kept for audit

bucket: repro-packs
  {agency_id}/{case_id}/{pack_id}/

bucket: audit-log           (Object Lock / immutable write policy on S3/MinIO)
  {agency_id}/YYYY/MM/DD/

bucket: backups
  postgres/{YYYY-MM-DD}/
  redis/{YYYY-MM-DD}/
```

Note: Case documents live in the `documents` bucket (Section 9), not here. All document buckets use per-case DEK encryption before upload.

### 2.3 Parquet partitioning strategy

```
canonical/
  chain=ethereum/
    date=2024-01-01/
      transactions-part-0000.parquet
      transactions-part-0001.parquet
  chain=bitcoin/
    date=2024-01-01/
      transactions-part-0000.parquet
      utxos-part-0000.parquet
  chain=base/
  chain=arbitrum/
  chain=optimism/
  chain=polygon/
  chain=solana/
  chain=tron/
```

Target Parquet file size: **128–512 MB**. A high-activity chain like Ethereum may produce 2–5 files per day partition; quieter chains produce 1 file per week, written when the buffer exceeds 128 MB or after 7 days.

**Sub-datasets per chain:**

```
canonical/chain={chain}/date={date}/
  transactions-*.parquet
  blocks-*.parquet
  log_events-*.parquet       (EVM chains only)
  utxo_outputs-*.parquet     (UTXO chains only)
  utxo_inputs-*.parquet      (UTXO chains only)
  token_transfers-*.parquet
  internal_calls-*.parquet
```

### 2.4 Per-chain canonical schemas

**Transactions table (all chains)**

```parquet
schema transactions {
  required binary chain (STRING);
  required binary tx_hash (STRING);
  required int64 block_height;
  required binary block_hash (STRING);
  required int64 block_timestamp (TIMESTAMP_MILLIS);
  required binary status (STRING);           -- "success" | "failed" | "reorged_out"

  -- fee (all chains)
  required binary fee_native (STRING);       -- bigint as decimal string (avoids int64 overflow)
  optional binary fee_fiat_usd (STRING);

  -- account model (EVM, Solana, Tron)
  optional binary from_address (STRING);
  optional binary to_address (STRING);
  optional binary value_native (STRING);
  optional binary value_fiat_usd (STRING);
  optional int32 tx_index;
  optional int64 gas_used;
  optional int64 gas_price_wei;
  optional int64 max_fee_per_gas;
  optional int64 max_priority_fee;
  optional binary input_data_hash (STRING);  -- sha256 of input data (full data in raw/)
  optional boolean is_contract_creation;

  -- UTXO model
  optional int32 input_count;
  optional int32 output_count;
  optional binary total_input_native (STRING);
  optional binary total_output_native (STRING);
  optional boolean is_coinbase;
  optional boolean is_coinjoin_candidate;
  optional int32 locktime;
  optional int32 version;
  optional boolean is_segwit;
  optional boolean is_taproot;

  -- L2 context
  optional binary l2_batch_ref (STRING);
  optional binary sequencer_address (STRING);
  optional boolean is_forced_inclusion;

  -- metadata
  required binary provider_install_id (STRING);
  required binary normalization_version (STRING);
  required int64 fetched_at (TIMESTAMP_MILLIS);
}
```

**UTXO outputs table (Bitcoin family)**

```parquet
schema utxo_outputs {
  required binary chain (STRING);
  required binary txid (STRING);
  required int32 vout;
  optional binary address (STRING);
  required binary value_native (STRING);
  required binary script_type (STRING);
  required boolean is_op_return;
  optional binary op_return_data (STRING);
  required int64 block_height;
  required int64 block_timestamp (TIMESTAMP_MILLIS);

  -- spend tracking
  optional binary spent_by_txid (STRING);
  optional int64 spent_at_height;
  optional int64 spent_at_timestamp (TIMESTAMP_MILLIS);
  required boolean is_spent;

  required binary provider_install_id (STRING);
  required int64 fetched_at (TIMESTAMP_MILLIS);
}
```

**EVM log events table**

```parquet
schema log_events {
  required binary chain (STRING);
  required binary tx_hash (STRING);
  required int32 log_index;
  required binary contract_address (STRING);
  required binary topic_0 (STRING);
  optional binary topic_1 (STRING);
  optional binary topic_2 (STRING);
  optional binary topic_3 (STRING);
  optional binary data (STRING);
  required int64 block_height;
  required int64 block_timestamp (TIMESTAMP_MILLIS);

  optional binary event_name (STRING);
  optional binary decoded_params_json (STRING);

  required binary provider_install_id (STRING);
  required int64 fetched_at (TIMESTAMP_MILLIS);
}
```

### 2.5 Compression

**Zstandard (zstd) level 3** on all Parquet datasets. Better ratio than Snappy for text-heavy chain data, faster decompression than gzip, natively supported by DuckDB, Spark, and PyArrow. _[Best-guess]_ Bitcoin UTXO outputs may compress better with Brotli — benchmark before finalizing the Bitcoin pipeline.

### 2.6 Read patterns and query access

Cold storage is queried via **DuckDB** for ad-hoc analytical queries and Reproducibility Pack extraction. DuckDB can query Parquet directly from Supabase Storage (which exposes an S3-compatible presigned URL endpoint):

```python
# apps/math/src/cold_store.py
import duckdb, os

def query_wallet_history(addresses: list[str], chain: str, start_ts: int, end_ts: int):
    # Supabase Storage S3-compatible endpoint
    endpoint = os.environ['SUPABASE_STORAGE_S3_ENDPOINT']
    access_key = os.environ['SUPABASE_S3_ACCESS_KEY']
    secret_key = os.environ['SUPABASE_S3_SECRET_KEY']

    con = duckdb.connect()
    con.execute(f"""
        INSTALL httpfs; LOAD httpfs;
        SET s3_endpoint='{endpoint}';
        SET s3_access_key_id='{access_key}';
        SET s3_secret_access_key='{secret_key}';
        SET s3_url_style='path';
    """)

    return con.execute(f"""
        SELECT t.*, o.address as output_address, o.value_native
        FROM 's3://chain-data/canonical/chain={chain}/date=*/transactions-*.parquet' t
        JOIN 's3://chain-data/canonical/chain={chain}/date=*/utxo_outputs-*.parquet' o
            ON t.tx_hash = o.txid
        WHERE o.address IN ({','.join(['?' for _ in addresses])})
          AND t.block_timestamp BETWEEN ? AND ?
        ORDER BY t.block_timestamp
    """, addresses + [start_ts, end_ts]).fetchall()
```

On-Prem: replace `s3_endpoint` with the MinIO endpoint. On AWS (Phase 2): remove `s3_endpoint` / `s3_url_style` overrides — DuckDB uses native S3.

### 2.7 Lifecycle policies

```
Supabase Storage (SaaS Blind v1):
  No native lifecycle transitions — Supabase Storage does not support S3-style lifecycle rules.
  Mitigation: a weekly maintenance Fly.io worker ("cold-store-maintenance") implements:
    - Move files > 90 days old to a "cold/" prefix (reduced-access storage class not available
      in Supabase Storage, but the prefix signals intent for Phase 2 S3 transition)
    - Hard-delete files > 365 days old unless tagged with a repro_pack_ref

MinIO (On-Prem):
  MinIO lifecycle rules configured via mc admin lifecycle:
    - Transition to reduced-redundancy storage class at 90 days (if MinIO Tiering enabled)
    - Expire at 365 days (unless tagged)

AWS S3 (Phase 2):
  Standard S3 lifecycle rules:
    - Standard → Standard-IA at 30 days
    - Standard-IA → Glacier Instant Retrieval at 90 days
    - Glacier IR → Glacier Deep Archive at 365 days
    - Exception: objects with tag repro_pack_ref never transition

Files referenced by active Reproducibility Packs are tagged by the pack builder with
repro_pack_ref={pack_id} to prevent lifecycle deletion. Court-grade cases receive a
7-year retention tag.
```

---

## Section 3 — Hot Graph Schema (Memgraph)

### 3.1 Why Memgraph on Fly.io

Memgraph is an in-memory graph database with disk persistence, ACID transactions, and Cypher query support. It runs as a persistent Fly.io machine with an attached volume for WAL and snapshots. It is **not** part of Supabase — it runs on Fly.io independently and is queried by the Fly.io API workers over a private network.

The Memgraph schema is **not** the operational store — Supabase Postgres is canonical. Memgraph is the **query-optimized view** of the case graph, built by the graph builder worker from Postgres data. If Memgraph is lost, it can be fully rebuilt from Postgres. This is the key architectural invariant.

### 3.2 Node types

**AddressNode**

```cypher
(:AddressNode {
  id: String,                    // UUID, same as Postgres address_nodes.id
  chain: String,                 // "ethereum", "bitcoin", etc.
  address: String,
  normalized_address: String,
  address_type: String,          // "eoa", "contract", "multisig", "utxo"
  case_id: String,               // Memgraph is scoped per case
  agency_id: String,

  // attribution (denormalized from Postgres for query speed)
  attribution_label: String,
  attribution_entity: String,
  attribution_tier: String,
  attribution_confidence: Float,
  risk_tier: String,             // "high", "medium", "low", "unknown", "sanctioned"

  // activity
  first_seen_block: Integer,
  last_seen_block: Integer,
  tx_count: Integer,

  // clustering
  cluster_id: String,

  // flags
  is_sanctioned: Boolean,
  is_mixer: Boolean,
  is_exchange: Boolean,
  is_coinjoin_participant: Boolean,

  updated_at: Integer            // epoch milliseconds
})
```

**TransactionNode**

```cypher
(:TransactionNode {
  id: String,                    // UUID, same as Postgres transaction_nodes.id
  chain: String,
  tx_hash: String,
  block_height: Integer,
  block_timestamp: Integer,      // epoch milliseconds
  status: String,
  fee_native: String,            // decimal string
  value_native: String,
  value_fiat_usd: String,
  case_id: String,
  agency_id: String,

  tx_type: String,               // "simple_transfer", "erc20_transfer", "swap", "bridge_deposit",
                                 // "bridge_withdrawal", "contract_deploy", "coinjoin", etc.

  is_mixer_interaction: Boolean,
  is_peel_chain_candidate: Boolean,
  has_obfuscation_finding: Boolean,

  l2_batch_ref: String,
  updated_at: Integer
})
```

**ClusterNode** (F24)

```cypher
(:ClusterNode {
  id: String,
  chain: String,
  name: String,
  member_count: Integer,
  cih_confidence: Float,
  case_id: String,
  agency_id: String,
  attribution_label: String,
  updated_at: Integer
})
```

### 3.3 Edge types

All edges connect AddressNode ↔ TransactionNode (G10 lock):

```cypher
// Input edge: address was a sender/input to this transaction
(:AddressNode)-[:INPUT_TO {
  edge_id: String,
  value_native: String,
  value_fiat_usd: String,
  token_contract: String,
  token_symbol: String,
  position_in_tx: Integer,
  utxo_ref: String,             // "txid:vout" for UTXO
  transfer_id: String           // log event id for ERC-20
}]->(:TransactionNode)

// Output edge: transaction sent funds to this address
(:TransactionNode)-[:OUTPUT_TO {
  edge_id: String,
  value_native: String,
  value_fiat_usd: String,
  token_contract: String,
  token_symbol: String,
  position_in_tx: Integer,
  utxo_ref: String,
  transfer_id: String,
  is_change_output: Boolean,
  change_confidence: Float
}]->(:AddressNode)

// Cross-chain bridge hop (Tx→Tx, the only Tx-to-Tx edge type allowed)
(:TransactionNode)-[:BRIDGE_TO {
  edge_id: String,
  bridge_protocol: String,
  source_chain: String,
  dest_chain: String,
  message_id: String,
  correlation_method: String,
  correlation_confidence: Float,
  bridge_fee_native: String
}]->(:TransactionNode)

// Cluster membership
(:AddressNode)-[:MEMBER_OF {
  joined_via: String,
  joined_at_expansion_round: Integer,
  confidence: Float
}]->(:ClusterNode)
```

### 3.4 Indexing strategy

```cypher
-- Applied at Memgraph startup via initialization script
CREATE INDEX ON :AddressNode(id);
CREATE INDEX ON :AddressNode(chain, normalized_address);
CREATE INDEX ON :AddressNode(case_id);
CREATE INDEX ON :AddressNode(agency_id);
CREATE INDEX ON :AddressNode(risk_tier);

CREATE INDEX ON :TransactionNode(id);
CREATE INDEX ON :TransactionNode(chain, tx_hash);
CREATE INDEX ON :TransactionNode(case_id);
CREATE INDEX ON :TransactionNode(block_timestamp);
CREATE INDEX ON :TransactionNode(tx_type);

CREATE INDEX ON :ClusterNode(id);
CREATE INDEX ON :ClusterNode(case_id);
```

**Key query patterns:**

1. **Tx-by-hash lookup:**

```cypher
MATCH (t:TransactionNode {chain: $chain, tx_hash: $hash})
RETURN t;
```

2. **k-hop neighborhood expansion (3 address-hops = depth 6 in Cypher):**

```cypher
MATCH path = (seed:AddressNode {id: $seed_id})-[*1..6]-(n)
WHERE ALL(node IN nodes(path) WHERE node.case_id = $case_id)
RETURN path
LIMIT 5000;
```

3. **Constrained k-shortest-paths:**

```cypher
MATCH (source:AddressNode {chain: $chain, normalized_address: $src, case_id: $case_id}),
      (dest:AddressNode   {chain: $chain, normalized_address: $dst, case_id: $case_id})
CALL algo.kShortestPaths(source, dest, $k, 'block_timestamp', {
  filterRelationships: [
    {type: 'INPUT_TO',  minValue: {value_native: $min_value}},
    {type: 'OUTPUT_TO', minValue: {value_native: $min_value}}
  ]
}) YIELD path, weight
RETURN path, weight ORDER BY weight LIMIT $k;
```

4. **Time-range graph slice (Court Mode View A):**

```cypher
MATCH (t:TransactionNode {case_id: $case_id})
WHERE t.block_timestamp >= $start AND t.block_timestamp <= $end
WITH t
MATCH (a:AddressNode)-[r]->(t) RETURN a, r, t
UNION
MATCH (t)-[r]->(a:AddressNode) RETURN a, r, t;
```

### 3.5 Memory sizing

```
Phase 0 (Fly.io, 100 active cases):
  Average graph: 5,000 nodes + 20,000 edges = ~80 MB/case
  100 cases: ~8 GB graph data
  Memgraph overhead: ~2 GB
  Recommended Fly.io machine: performance-4x (8 vCPU, 16 GB RAM)
  Volume for WAL + snapshots: 20 GB persistent volume

Phase 2 (500 active cases, AWS):
  ~40 GB graph data — split into 2 Memgraph instances partitioned by agency_id
```

Cases inactive > 30 days are evicted from Memgraph's working set. They remain in Postgres and can be rebuilt on demand in < 60 seconds for typical Phase 0 graph sizes.

### 3.6 Backup and restore

```yaml
# memgraph.conf
data-directory: /var/lib/memgraph
storage-snapshot-interval-sec: 3600
storage-wal-enabled: true
storage-wal-file-size-kib: 65536
storage-snapshot-retention-count: 3
```

A sidecar process streams snapshots to Supabase Storage (`backups/memgraph/`) immediately after each snapshot completes. On AWS (Phase 2): stream to S3 directly.

**Restore priority:** Restore from latest S3/Supabase snapshot (< 1 hour old) first. If snapshot unavailable, rebuild from Supabase Postgres using the graph builder worker. Postgres is canonical — Memgraph loss is always recoverable.

---

## Section 4 — Postgres Schema: Canonical Operational Store

### 4.1 Schema conventions

**Supabase Postgres specifics:**

- The `auth.users` table is managed by Supabase Auth. The `public.users` table (below) stores application-level user metadata and links to `auth.users.id`.
- RLS (Row-Level Security) is enabled on **every table** that holds case or agency data. The RLS policies are the primary multi-tenant isolation boundary — not just an optional hardening layer. See Section 5 for the full policy set.
- `auth.uid()` returns the UUID of the currently authenticated Supabase Auth user. This is the join key between Supabase Auth and `public.users`.
- Supabase's connection pooler (PgBouncer in transaction mode) is used. This means `SET LOCAL` and advisory locks are not safe — all locking is done via `SELECT ... FOR UPDATE` or application-layer serialization.
- All tables live in the `public` schema unless otherwise noted.

**General conventions:**

- UUID primary keys, generated by the application layer (not `gen_random_uuid()`) where determinism matters.
- `created_at` and `updated_at` on every table, `timestamptz` (UTC).
- Row-level encryption at the **application layer** using libsodium (NaCl secretbox) for sensitive fields. Encrypted columns store `bytea` prefixed `\x01` (version byte). Postgres never holds plaintext for sensitive fields. Non-sensitive fields (IDs, hashes, enums, timestamps) are stored unencrypted so RLS predicates and indexes work.
- All foreign keys are explicit constraints. Cross-tenant isolation is enforced by RLS on every table.
- Extensions required: `pgcrypto`, `pgvector`, `uuid-ossp`, `pg_stat_statements` (for Supabase dashboard query analysis).

### 4.2 Tenancy tables

```sql
-- ============================================================
-- TENANCY
-- ============================================================

CREATE TABLE agencies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  kms_key_ref         TEXT NOT NULL,
  kms_provider        TEXT NOT NULL DEFAULT 'aws_kms',
  settings_encrypted  BYTEA,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No RLS on agencies table — agency lookup is done by the service role only.
-- Application-layer users never query agencies directly.

-- ──────────────────────────────────────────────────────────────

CREATE TABLE users (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id           UUID NOT NULL REFERENCES agencies(id),
  role                TEXT NOT NULL CHECK (role IN (
                        'investigator', 'supervisor', 'admin',
                        'observer', 'expert_witness', 'prosecutor_view'
                      )),
  mfa_enrolled_at     TIMESTAMPTZ,
  mfa_method          TEXT CHECK (mfa_method IN ('totp', 'webauthn', 'both')),
  status              TEXT NOT NULL DEFAULT 'active',
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: users can only see their own row; admins see their whole agency.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_read ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY users_agency_admin_read ON users
  FOR SELECT USING (
    agency_id = (SELECT agency_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY users_self_update ON users
  FOR UPDATE USING (id = auth.uid());

CREATE INDEX idx_users_agency ON users(agency_id);
CREATE INDEX idx_users_role ON users(agency_id, role);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE supervisory_roles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  scope               TEXT NOT NULL CHECK (scope IN ('team', 'squad', 'division', 'agency')),
  scope_ref           UUID,
  permissions         JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supervisory_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY supervisory_roles_own_agency ON supervisory_roles
  FOR SELECT USING (
    user_id IN (
      SELECT id FROM users
      WHERE agency_id = (SELECT agency_id FROM users WHERE id = auth.uid())
    )
  );

CREATE INDEX idx_supervisory_roles_user ON supervisory_roles(user_id);
```

### 4.3 Case tables

```sql
-- ============================================================
-- CASES
-- ============================================================

-- Helper function: get current user's agency_id (used in RLS policies)
CREATE OR REPLACE FUNCTION current_agency_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT agency_id FROM users WHERE id = auth.uid();
$$;

-- Helper function: check if current user has access to a case
CREATE OR REPLACE FUNCTION user_has_case_access(p_case_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_access
    WHERE case_id = p_case_id
      AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM cases
    WHERE id = p_case_id
      AND agency_id = current_agency_id()
      AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'supervisor')
  );
$$;

-- ──────────────────────────────────────────────────────────────

CREATE TABLE cases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id               UUID NOT NULL REFERENCES agencies(id),
  codename                TEXT NOT NULL,
  crime_typology_enc      BYTEA,
  legal_vehicle_enc       BYTEA,
  jurisdictions_enc       BYTEA,
  summary_md_enc          BYTEA,
  classification          TEXT NOT NULL DEFAULT 'unclassified'
                            CHECK (classification IN ('unclassified','LES','confidential','classified')),
  status                  TEXT NOT NULL DEFAULT 'intake'
                            CHECK (status IN ('intake','active','paused','prepared_for_court','closed','archived')),
  created_by              UUID NOT NULL REFERENCES users(id),
  lead_investigator_id    UUID REFERENCES users(id),
  incident_t0             TIMESTAMPTZ,
  lookback_window         INTERVAL,
  watch_window            INTERVAL,
  closed_at               TIMESTAMPTZ,
  archived_at             TIMESTAMPTZ,
  repro_pack_id           UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Agency-scoped: all users in the same agency see cases in their agency
-- (case-level access control is an additional layer via case_access)
CREATE POLICY cases_agency_read ON cases
  FOR SELECT USING (agency_id = current_agency_id());

CREATE POLICY cases_agency_insert ON cases
  FOR INSERT WITH CHECK (agency_id = current_agency_id());

CREATE POLICY cases_lead_update ON cases
  FOR UPDATE USING (
    agency_id = current_agency_id()
    AND (
      lead_investigator_id = auth.uid()
      OR (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'supervisor')
    )
  );

CREATE INDEX idx_cases_agency ON cases(agency_id);
CREATE INDEX idx_cases_status ON cases(agency_id, status);
CREATE INDEX idx_cases_created_by ON cases(created_by);

-- ──────────────────────────────────────────────────────────────

-- Explicit case access grants (for cases with restricted access)
CREATE TABLE case_access (
  case_id             UUID NOT NULL REFERENCES cases(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  granted_by          UUID NOT NULL REFERENCES users(id),
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_level        TEXT NOT NULL DEFAULT 'read_write'
                        CHECK (access_level IN ('read_only', 'read_write', 'lead')),
  PRIMARY KEY (case_id, user_id)
);

ALTER TABLE case_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_access_own_agency ON case_access
  FOR SELECT USING (
    case_id IN (SELECT id FROM cases WHERE agency_id = current_agency_id())
  );

-- ──────────────────────────────────────────────────────────────

-- Case DEK references (one per case)
CREATE TABLE case_dek_refs (
  case_id             UUID PRIMARY KEY REFERENCES cases(id),
  kms_key_ref         TEXT NOT NULL,
  algorithm           TEXT NOT NULL DEFAULT 'xchacha20poly1305',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service role only — never exposed via RLS to end users
ALTER TABLE case_dek_refs ENABLE ROW LEVEL SECURITY;
-- No SELECT policy created: only the service_role (backend API) can access this table

-- ──────────────────────────────────────────────────────────────

CREATE TABLE iocs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  value_enc           BYTEA NOT NULL,
  value_hash          TEXT NOT NULL,       -- sha256 of canonical value (unencrypted for deconfliction)
  chain               TEXT,
  ioc_type            TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'manual',
  added_by            UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE iocs ENABLE ROW LEVEL SECURITY;

CREATE POLICY iocs_case_access ON iocs
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_iocs_case ON iocs(case_id);
CREATE INDEX idx_iocs_value_hash ON iocs(value_hash);
CREATE INDEX idx_iocs_chain ON iocs(chain) WHERE chain IS NOT NULL;
```

### 4.4 Graph tables

```sql
-- ============================================================
-- GRAPH (transaction-centric, G10 lock)
-- ============================================================

CREATE TABLE address_nodes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES cases(id),
  agency_id               UUID NOT NULL,
  chain                   TEXT NOT NULL,
  address                 TEXT NOT NULL,
  normalized_address      TEXT NOT NULL,
  address_type            TEXT NOT NULL DEFAULT 'unknown',
  first_seen_block        BIGINT,
  last_seen_block         BIGINT,
  first_seen_at           TIMESTAMPTZ,
  last_seen_at            TIMESTAMPTZ,
  tx_count                INTEGER DEFAULT 0,

  attribution_label       TEXT,
  attribution_entity      TEXT,
  attribution_tier        TEXT,
  attribution_confidence  DECIMAL(5,4),
  risk_tier               TEXT DEFAULT 'unknown',

  cluster_id              UUID,

  is_sanctioned           BOOLEAN NOT NULL DEFAULT FALSE,
  is_mixer                BOOLEAN NOT NULL DEFAULT FALSE,
  is_exchange             BOOLEAN NOT NULL DEFAULT FALSE,

  graph_synced_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(case_id, chain, normalized_address)
);

ALTER TABLE address_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY address_nodes_case_access ON address_nodes
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_address_nodes_case ON address_nodes(case_id);
CREATE INDEX idx_address_nodes_chain_addr ON address_nodes(chain, normalized_address);
CREATE INDEX idx_address_nodes_cluster ON address_nodes(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX idx_address_nodes_risk ON address_nodes(case_id, risk_tier);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE transaction_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  chain               TEXT NOT NULL,
  tx_hash             TEXT NOT NULL,
  block_height        BIGINT NOT NULL,
  block_timestamp     TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL,
  fee_native          NUMERIC(36,0),
  fee_fiat_usd        DECIMAL(24,8),
  value_native        NUMERIC(36,0),
  value_fiat_usd      DECIMAL(24,8),
  tx_type             TEXT NOT NULL DEFAULT 'unknown',

  has_obfuscation_finding BOOLEAN NOT NULL DEFAULT FALSE,
  is_mixer_interaction    BOOLEAN NOT NULL DEFAULT FALSE,

  l2_batch_ref        TEXT,

  graph_synced_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(case_id, chain, tx_hash)
);

ALTER TABLE transaction_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY transaction_nodes_case_access ON transaction_nodes
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_tx_nodes_case ON transaction_nodes(case_id);
CREATE INDEX idx_tx_nodes_chain_hash ON transaction_nodes(chain, tx_hash);
CREATE INDEX idx_tx_nodes_timestamp ON transaction_nodes(case_id, block_timestamp);
CREATE INDEX idx_tx_nodes_type ON transaction_nodes(case_id, tx_type);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE graph_edges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  from_node_id        UUID NOT NULL,
  from_node_type      TEXT NOT NULL CHECK (from_node_type IN ('address', 'transaction')),
  to_node_id          UUID NOT NULL,
  to_node_type        TEXT NOT NULL CHECK (to_node_type IN ('address', 'transaction')),
  edge_type           TEXT NOT NULL CHECK (edge_type IN ('input_to', 'output_to', 'bridge_to')),
  value_native        NUMERIC(36,0),
  value_fiat_usd      DECIMAL(24,8),
  token_contract      TEXT,
  token_symbol        TEXT,
  position_in_tx      INTEGER,
  utxo_ref            TEXT,
  transfer_id         TEXT,
  is_change_output    BOOLEAN,
  change_confidence   DECIMAL(5,4),

  bridge_protocol     TEXT,
  source_chain        TEXT,
  dest_chain          TEXT,
  bridge_message_id   TEXT,
  correlation_method  TEXT,
  correlation_confidence DECIMAL(5,4),

  graph_synced_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT edge_type_consistency CHECK (
    (from_node_type = 'address'     AND to_node_type = 'transaction' AND edge_type = 'input_to')
    OR (from_node_type = 'transaction' AND to_node_type = 'address'  AND edge_type = 'output_to')
    OR (from_node_type = 'transaction' AND to_node_type = 'transaction' AND edge_type = 'bridge_to')
  )
);

ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY graph_edges_case_access ON graph_edges
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_graph_edges_case ON graph_edges(case_id);
CREATE INDEX idx_graph_edges_from ON graph_edges(from_node_id, from_node_type);
CREATE INDEX idx_graph_edges_to ON graph_edges(to_node_id, to_node_type);
```

### 4.5 Belief State tables

```sql
-- ============================================================
-- BELIEF STATE (event-sourced, append-only)
-- ============================================================

CREATE TABLE belief_atoms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  subject_type        TEXT NOT NULL,
  subject_ref         TEXT NOT NULL,
  predicate           TEXT NOT NULL,
  object_enc          BYTEA NOT NULL,
  object_hash         TEXT NOT NULL,       -- sha256 of canonical decrypted object
  confidence          DECIMAL(5,4) NOT NULL,
  tier                TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
  provenance_json     JSONB NOT NULL,
  derivation_json     JSONB,
  status              TEXT NOT NULL DEFAULT 'asserted'
                        CHECK (status IN ('asserted','challenged','retracted','court_grade','superseded')),
  signoff_id          UUID REFERENCES users(id),
  superseded_by       UUID REFERENCES belief_atoms(id),
  retracted_by        UUID REFERENCES belief_atoms(id),
  created_by          UUID REFERENCES users(id),
  created_by_agent    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- hash chain
  content_hash        TEXT NOT NULL,
  prior_event_hash    TEXT
);

ALTER TABLE belief_atoms ENABLE ROW LEVEL SECURITY;

-- Investigators see all atoms in cases they have access to
CREATE POLICY belief_atoms_case_read ON belief_atoms
  FOR SELECT USING (user_has_case_access(case_id));

-- Only the backend service role inserts atoms (agents run server-side)
-- No INSERT policy for authenticated users — inserts go through the API layer
-- which uses the service_role key, bypassing RLS for writes.
-- This keeps agent writes fast and atomic while reads are RLS-protected.

CREATE INDEX idx_belief_atoms_case ON belief_atoms(case_id);
CREATE INDEX idx_belief_atoms_subject ON belief_atoms(case_id, subject_type, subject_ref);
CREATE INDEX idx_belief_atoms_status ON belief_atoms(case_id, status);
CREATE INDEX idx_belief_atoms_predicate ON belief_atoms(case_id, predicate);
CREATE INDEX idx_belief_atoms_created ON belief_atoms(case_id, created_at);
```

### 4.6 Provider / BYOK tables

```sql
-- ============================================================
-- PROVIDER / BYOK
-- ============================================================

CREATE TABLE provider_definitions (
  id                  TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  category            TEXT NOT NULL,
  capabilities        JSONB NOT NULL,
  auth_method         TEXT NOT NULL,
  auth_schema         JSONB NOT NULL,
  rate_limits_json    JSONB,
  data_residency      TEXT[],
  compliance_certs    TEXT[],
  status              TEXT NOT NULL DEFAULT 'available',
  shipped_in_version  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public read for all authenticated users (catalog is not sensitive)
ALTER TABLE provider_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_defs_all_read ON provider_definitions FOR SELECT USING (auth.uid() IS NOT NULL);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE agency_provider_installs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id               UUID NOT NULL REFERENCES agencies(id),
  provider_id             TEXT NOT NULL REFERENCES provider_definitions(id),
  display_label           TEXT NOT NULL,
  credential_ref          TEXT NOT NULL,    -- KMS reference, never the raw credential
  enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_capabilities    JSONB,
  priority                INTEGER NOT NULL DEFAULT 100,
  budget_limits_json      JSONB,
  rate_limit_override     JSONB,
  scope                   TEXT NOT NULL DEFAULT 'agency_wide',
  scope_refs              UUID[],
  added_by                UUID NOT NULL REFERENCES users(id),
  added_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_health_check_at    TIMESTAMPTZ,
  last_health_status      TEXT,
  current_period_usage    JSONB,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agency_provider_installs ENABLE ROW LEVEL SECURITY;

-- Agency admins and investigators see their agency's installs
CREATE POLICY api_installs_agency_read ON agency_provider_installs
  FOR SELECT USING (agency_id = current_agency_id());

-- Only admins can insert/update installs
CREATE POLICY api_installs_admin_write ON agency_provider_installs
  FOR ALL USING (
    agency_id = current_agency_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE INDEX idx_api_installs_agency ON agency_provider_installs(agency_id);
CREATE INDEX idx_api_installs_active ON agency_provider_installs(agency_id, enabled);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE provider_resolutions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID REFERENCES cases(id),
  agency_id               UUID NOT NULL,
  capability              TEXT NOT NULL,
  args_hash               TEXT NOT NULL,
  resolved_install_id     UUID REFERENCES agency_provider_installs(id),
  fallback_chain          UUID[],
  resolution_reason       TEXT,
  resolved_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only, service_role writes only; investigators can read their case resolutions
ALTER TABLE provider_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_res_case_read ON provider_resolutions
  FOR SELECT USING (
    case_id IS NULL OR user_has_case_access(case_id)
  );

CREATE INDEX idx_provider_resolutions_case ON provider_resolutions(case_id);
CREATE INDEX idx_provider_resolutions_time ON provider_resolutions(resolved_at);
```

### 4.7 Cache entries table

```sql
-- ============================================================
-- CACHE (F23)
-- ============================================================

CREATE TABLE cache_entries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key               TEXT NOT NULL UNIQUE,
  capability              TEXT NOT NULL,
  args_canonical          TEXT NOT NULL,
  provider_install_id     UUID REFERENCES agency_provider_installs(id),
  response_payload        BYTEA NOT NULL,   -- zstd-compressed + encrypted
  response_metadata       JSONB NOT NULL,
  fetched_at              TIMESTAMPTZ NOT NULL,
  ttl_tier                TEXT NOT NULL CHECK (ttl_tier IN ('immutable','slow_drift','medium_drift','fast_drift')),
  expires_at              TIMESTAMPTZ,
  scope                   TEXT NOT NULL CHECK (scope IN ('global_chain_data','agency','case','private_attribution')),
  scope_ref               UUID,
  refresh_count           INTEGER NOT NULL DEFAULT 0,
  manual_refresh_history  JSONB NOT NULL DEFAULT '[]',
  byte_size               INTEGER NOT NULL,
  hit_count               INTEGER NOT NULL DEFAULT 0,
  last_hit_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cache_entries ENABLE ROW LEVEL SECURITY;

-- Global chain data: any authenticated user can read (immutable, not sensitive)
CREATE POLICY cache_global_read ON cache_entries
  FOR SELECT USING (scope = 'global_chain_data' AND auth.uid() IS NOT NULL);

-- Agency-scoped: users in the same agency
CREATE POLICY cache_agency_read ON cache_entries
  FOR SELECT USING (
    scope = 'agency' AND scope_ref = current_agency_id()
  );

-- Case-scoped: users with case access
CREATE POLICY cache_case_read ON cache_entries
  FOR SELECT USING (
    scope = 'case' AND user_has_case_access(scope_ref)
  );

-- Private attribution: only the owning user
CREATE POLICY cache_private_attr_read ON cache_entries
  FOR SELECT USING (
    scope = 'private_attribution' AND scope_ref = auth.uid()
  );

-- All writes are service_role (backend workers bypass RLS)

CREATE INDEX idx_cache_entries_key ON cache_entries(cache_key);
CREATE INDEX idx_cache_entries_capability ON cache_entries(capability, scope);
CREATE INDEX idx_cache_entries_scope_ref ON cache_entries(scope_ref);
CREATE INDEX idx_cache_entries_expires ON cache_entries(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_cache_entries_ttl ON cache_entries(ttl_tier);
```

### 4.8 Document and chain of custody tables

```sql
-- ============================================================
-- DOCUMENTS
-- ============================================================

CREATE TABLE case_documents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES cases(id),
  agency_id               UUID NOT NULL,
  filename_enc            BYTEA NOT NULL,
  filename_hash           TEXT NOT NULL,
  document_type           TEXT NOT NULL,
  source                  TEXT NOT NULL DEFAULT 'uploaded',
  classification          TEXT NOT NULL DEFAULT 'unclassified',
  uploaded_by             UUID NOT NULL REFERENCES users(id),
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  storage_backend_id      TEXT NOT NULL DEFAULT 'supabase_storage',
  storage_path_enc        BYTEA NOT NULL,   -- encrypted path within storage bucket
  content_hash            TEXT NOT NULL,
  encryption_ref          TEXT NOT NULL,    -- KMS key reference
  page_count              INTEGER,
  mime_type               TEXT NOT NULL,
  byte_size               BIGINT NOT NULL,
  ocr_status              TEXT NOT NULL DEFAULT 'not_required',
  extraction_status       TEXT NOT NULL DEFAULT 'pending',
  review_status           TEXT NOT NULL DEFAULT 'unreviewed',
  finalized_by            UUID REFERENCES users(id),
  finalized_at            TIMESTAMPTZ,
  legal_hold              BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_set_at       TIMESTAMPTZ,
  retention_days          INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_docs_case_access ON case_documents
  FOR SELECT USING (user_has_case_access(case_id));

-- Investigators can upload to cases they have access to
CREATE POLICY case_docs_upload ON case_documents
  FOR INSERT WITH CHECK (user_has_case_access(case_id));

CREATE INDEX idx_case_docs_case ON case_documents(case_id);
CREATE INDEX idx_case_docs_hash ON case_documents(content_hash);
CREATE INDEX idx_case_docs_hold ON case_documents(legal_hold) WHERE legal_hold = TRUE;

-- ──────────────────────────────────────────────────────────────

CREATE TABLE extracted_entities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID NOT NULL REFERENCES case_documents(id),
  case_id             UUID NOT NULL,
  raw_text_enc        BYTEA NOT NULL,
  normalized_value    TEXT NOT NULL,
  normalized_hash     TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  page_number         INTEGER,
  bounding_box        JSONB,
  confidence          DECIMAL(5,4),
  reviewed            BOOLEAN NOT NULL DEFAULT FALSE,
  reviewer_id         UUID REFERENCES users(id),
  linked_belief_atom  UUID REFERENCES belief_atoms(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE extracted_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY extracted_entities_case_access ON extracted_entities
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_extracted_entities_doc ON extracted_entities(document_id);
CREATE INDEX idx_extracted_entities_hash ON extracted_entities(normalized_hash);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE chain_of_custody_records (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES cases(id),
  agency_id               UUID NOT NULL,
  artifact_type           TEXT NOT NULL,
  artifact_id             UUID NOT NULL,
  artifact_content_hash   TEXT NOT NULL,
  current_custodian_id    UUID REFERENCES users(id),
  classification          TEXT NOT NULL DEFAULT 'unclassified',
  events                  JSONB NOT NULL DEFAULT '[]',
  prior_record_hash       TEXT,
  this_record_hash        TEXT NOT NULL,
  rfc3161_timestamp_ref   TEXT,
  chain_anchor_tx         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chain_of_custody_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY coc_records_case_access ON chain_of_custody_records
  FOR SELECT USING (user_has_case_access(case_id));

CREATE INDEX idx_coc_records_case ON chain_of_custody_records(case_id);
CREATE INDEX idx_coc_records_artifact ON chain_of_custody_records(artifact_type, artifact_id);
```

### 4.9 Tracing artifacts tables

```sql
-- ============================================================
-- TRACING ARTIFACTS
-- ============================================================

CREATE TABLE trace_paths (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES cases(id),
  agency_id               UUID NOT NULL,
  name                    TEXT NOT NULL,
  short_label             TEXT,
  display_color           TEXT,
  highlight_style         TEXT DEFAULT 'ring',
  is_primary              BOOLEAN NOT NULL DEFAULT FALSE,
  highlight_visible       BOOLEAN NOT NULL DEFAULT TRUE,
  ordered_steps_json      JSONB NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','under_review','finalized','retracted')),
  content_hash            TEXT NOT NULL,
  signoff_id              UUID REFERENCES users(id),
  supersedes              UUID REFERENCES trace_paths(id),
  created_by              UUID NOT NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trace_paths ENABLE ROW LEVEL SECURITY;
CREATE POLICY trace_paths_case_access ON trace_paths FOR ALL USING (user_has_case_access(case_id));
CREATE UNIQUE INDEX idx_trace_paths_primary ON trace_paths(case_id) WHERE is_primary = TRUE;

-- ──────────────────────────────────────────────────────────────

CREATE TABLE wallets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES cases(id),
  agency_id               UUID NOT NULL,
  name_enc                BYTEA NOT NULL,
  source                  TEXT NOT NULL,
  source_provenance_enc   BYTEA,
  classification          TEXT NOT NULL DEFAULT 'unclassified',
  analysis_config         JSONB NOT NULL,
  analysis_status         TEXT NOT NULL DEFAULT 'not_run',
  last_analyzed_at        TIMESTAMPTZ,
  analysis_summary        JSONB,
  created_by              UUID NOT NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallets_case_access ON wallets FOR ALL USING (user_has_case_access(case_id));

CREATE TABLE wallet_addresses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id               UUID NOT NULL REFERENCES wallets(id),
  case_id                 UUID NOT NULL,
  raw_address_enc         BYTEA NOT NULL,
  normalized_address      TEXT NOT NULL,
  chain                   TEXT NOT NULL,
  derivation_path         TEXT,
  label_from_source_enc   BYTEA,
  analysis_status         TEXT NOT NULL DEFAULT 'not_analyzed',
  per_address_summary     JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallet_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_addresses_case_access ON wallet_addresses
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_wallet_addresses_wallet ON wallet_addresses(wallet_id);
CREATE INDEX idx_wallet_addresses_normalized ON wallet_addresses(chain, normalized_address);
```

### 4.10 UTXO Clustering tables (F24)

```sql
-- ============================================================
-- UTXO CLUSTERING (F24)
-- ============================================================

CREATE TABLE utxo_clusters (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                     UUID NOT NULL REFERENCES cases(id),
  agency_id                   UUID NOT NULL,
  chain                       TEXT NOT NULL,
  name_enc                    BYTEA,
  display_color               TEXT,
  seed_address_id             UUID REFERENCES address_nodes(id),
  member_count                INTEGER NOT NULL DEFAULT 0,
  cih_expansion_rounds        INTEGER NOT NULL DEFAULT 0,
  cih_confidence              DECIMAL(5,4),
  coinjoin_txs_excluded       TEXT[],
  manually_excluded_addresses TEXT[],
  cluster_attribution_json    JSONB,
  attribution_provenance_json JSONB,
  rule_version                TEXT NOT NULL,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshable                 BOOLEAN NOT NULL DEFAULT TRUE,
  last_refreshed_at           TIMESTAMPTZ,
  status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','superseded','manually_pruned')),
  content_hash                TEXT NOT NULL,
  created_by                  UUID NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE utxo_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY utxo_clusters_case_access ON utxo_clusters
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_utxo_clusters_case ON utxo_clusters(case_id);
CREATE INDEX idx_utxo_clusters_chain ON utxo_clusters(chain, case_id);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE cluster_members (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id                  UUID NOT NULL REFERENCES utxo_clusters(id),
  case_id                     UUID NOT NULL,
  address_id                  UUID REFERENCES address_nodes(id),
  normalized_address          TEXT NOT NULL,
  chain                       TEXT NOT NULL,
  joined_via                  TEXT NOT NULL CHECK (joined_via IN ('cih','change_detection','manual_add','manually_excluded')),
  joined_at_expansion_round   INTEGER,
  confidence                  DECIMAL(5,4) NOT NULL,
  evidence_txs                TEXT[],
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cluster_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY cluster_members_case_access ON cluster_members
  FOR ALL USING (user_has_case_access(case_id));

CREATE INDEX idx_cluster_members_cluster ON cluster_members(cluster_id);
CREATE INDEX idx_cluster_members_address ON cluster_members(normalized_address, chain);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE change_detection_results (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id                      UUID NOT NULL REFERENCES utxo_clusters(id),
  tx_hash                         TEXT NOT NULL,
  chain                           TEXT NOT NULL,
  identified_change_output_index  INTEGER NOT NULL,
  confidence                      DECIMAL(5,4) NOT NULL,
  heuristics_applied              TEXT[] NOT NULL,
  alternative_interpretations     JSONB,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE change_detection_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY change_detection_case_access ON change_detection_results
  FOR SELECT USING (
    cluster_id IN (
      SELECT id FROM utxo_clusters WHERE user_has_case_access(case_id)
    )
  );
```

### 4.11 Personal attribution tables (F25)

```sql
-- ============================================================
-- PERSONAL ATTRIBUTION (F25)
-- ============================================================

CREATE TABLE personal_attributions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attributor_id           UUID NOT NULL REFERENCES users(id),
  agency_id               UUID NOT NULL,
  target_type             TEXT NOT NULL,
  target_ref              TEXT NOT NULL,
  target_chain            TEXT,
  label_enc               BYTEA NOT NULL,
  category                TEXT NOT NULL,
  custom_category_enc     BYTEA,
  description_enc         BYTEA,
  display_color           TEXT,
  display_icon            TEXT,
  confidence              DECIMAL(5,4) NOT NULL,
  basis                   TEXT NOT NULL,
  supporting_evidence     JSONB,
  use_count               INTEGER NOT NULL DEFAULT 0,
  last_seen_at            TIMESTAMPTZ,
  visibility              TEXT NOT NULL DEFAULT 'private'
                            CHECK (visibility IN ('private','shared_with_users','shared_with_team',
                                                  'shared_with_org','shared_externally')),
  shared_with             JSONB,
  shared_at               TIMESTAMPTZ,
  acceptor_log            JSONB NOT NULL DEFAULT '[]',
  primary_case_id         UUID REFERENCES cases(id),
  cases_referenced_in     UUID[],
  belief_atom_id          UUID REFERENCES belief_atoms(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE personal_attributions ENABLE ROW LEVEL SECURITY;

-- Private: only the attributor sees their own private attributions
CREATE POLICY personal_attr_own ON personal_attributions
  FOR ALL USING (attributor_id = auth.uid());

-- Shared with org: all users in the same agency see org-shared attributions
CREATE POLICY personal_attr_org_shared ON personal_attributions
  FOR SELECT USING (
    visibility = 'shared_with_org'
    AND agency_id = current_agency_id()
  );

-- Shared with specific users: the target user sees it
CREATE POLICY personal_attr_shared_users ON personal_attributions
  FOR SELECT USING (
    visibility IN ('shared_with_users', 'shared_with_team')
    AND (shared_with @> jsonb_build_array(auth.uid()::text)
         OR agency_id = current_agency_id())
  );

CREATE INDEX idx_personal_attr_attributor ON personal_attributions(attributor_id);
CREATE INDEX idx_personal_attr_target ON personal_attributions(target_ref, target_type);
CREATE INDEX idx_personal_attr_visibility ON personal_attributions(agency_id, visibility);
```

### 4.12 Reports, reproducibility, AI, and audit tables

```sql
-- ============================================================
-- REPORTS & REPRODUCIBILITY
-- ============================================================

CREATE TABLE reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  template            TEXT NOT NULL,
  draft_md_enc        BYTEA,
  draft_hash          TEXT,
  finalized_at        TIMESTAMPTZ,
  finalized_hash      TEXT,
  signoff_id          UUID REFERENCES users(id),
  repro_pack_id       UUID,
  methodology_used    TEXT,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_case_access ON reports FOR ALL USING (user_has_case_access(case_id));

-- ──────────────────────────────────────────────────────────────

CREATE TABLE reproducibility_packs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  content_hash        TEXT NOT NULL UNIQUE,
  manifest_json       JSONB NOT NULL,
  s3_ref              TEXT NOT NULL,        -- storage path within repro-packs bucket
  replay_script_ref   TEXT NOT NULL,
  belief_atoms_count  INTEGER NOT NULL,
  rule_versions_json  JSONB NOT NULL,
  provider_snapshot_refs JSONB NOT NULL,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chain_anchor_tx     TEXT,
  chain_anchor_chain  TEXT,
  chain_anchor_at     TIMESTAMPTZ
);

ALTER TABLE reproducibility_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY repro_packs_case_access ON reproducibility_packs
  FOR SELECT USING (user_has_case_access(case_id));

CREATE INDEX idx_repro_packs_case ON reproducibility_packs(case_id);
CREATE INDEX idx_repro_packs_hash ON reproducibility_packs(content_hash);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE model_cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id            TEXT NOT NULL,
  version             TEXT NOT NULL,
  prompt_template_hash TEXT NOT NULL,
  sampling_params     JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, version, prompt_template_hash)
);

ALTER TABLE model_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_cards_all_read ON model_cards FOR SELECT USING (auth.uid() IS NOT NULL);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE agent_calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  agency_id           UUID NOT NULL,
  agent_name          TEXT NOT NULL,
  model_card_id       UUID NOT NULL REFERENCES model_cards(id),
  inputs_hash         TEXT NOT NULL,
  outputs_hash        TEXT NOT NULL,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cost_usd            DECIMAL(12,6),
  duration_ms         INTEGER,
  success             BOOLEAN NOT NULL,
  error_message       TEXT,
  provider_install_id UUID,
  called_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_calls_supervisor_read ON agent_calls
  FOR SELECT USING (
    user_has_case_access(case_id)
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin','supervisor','investigator')
  );

CREATE INDEX idx_agent_calls_case ON agent_calls(case_id);
CREATE INDEX idx_agent_calls_time ON agent_calls(called_at);

-- ============================================================
-- AUDIT LOG (append-only, hash-chained)
-- ============================================================

CREATE TABLE audit_log_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           UUID NOT NULL,
  actor_id            UUID REFERENCES users(id),
  actor_type          TEXT NOT NULL DEFAULT 'user',
  actor_name          TEXT,
  action              TEXT NOT NULL,
  target_type         TEXT,
  target_ref          TEXT,
  details_json        JSONB,
  ip_address          TEXT,
  user_agent          TEXT,
  prior_hash          TEXT,
  this_hash           TEXT NOT NULL,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_log_entries ENABLE ROW LEVEL SECURITY;

-- Admins and supervisors can read audit log for their agency
CREATE POLICY audit_log_admin_read ON audit_log_entries
  FOR SELECT USING (
    agency_id = current_agency_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin','supervisor')
  );

-- No DELETE policy — append-only enforced at application layer + RLS
-- No UPDATE policy
CREATE INDEX idx_audit_log_agency ON audit_log_entries(agency_id, occurred_at);
CREATE INDEX idx_audit_log_actor ON audit_log_entries(actor_id, occurred_at);
CREATE INDEX idx_audit_log_action ON audit_log_entries(action, occurred_at);

-- ──────────────────────────────────────────────────────────────
-- Provider cost telemetry (lightweight event stream)
CREATE TABLE provider_cost_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           UUID NOT NULL,
  case_id             UUID REFERENCES cases(id),
  provider_install_id UUID REFERENCES agency_provider_installs(id),
  capability          TEXT NOT NULL,
  cost_usd            DECIMAL(12,6),
  cache_hit           BOOLEAN NOT NULL DEFAULT FALSE,
  response_time_ms    INTEGER,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE provider_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cost_events_admin_read ON provider_cost_events
  FOR SELECT USING (
    agency_id = current_agency_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin','supervisor')
  );

CREATE INDEX idx_cost_events_agency ON provider_cost_events(agency_id, occurred_at);
CREATE INDEX idx_cost_events_install ON provider_cost_events(provider_install_id, occurred_at);
```

### 4.13 Application-layer row-level encryption

Supabase RLS provides tenant isolation; libsodium provides field-level confidentiality. These are complementary:

- **RLS** ensures Alice's agency cannot query Bob's agency's rows at all.
- **libsodium encryption** ensures that even if a misconfigured RLS policy let a wrong agency see a row (defense-in-depth), the encrypted fields are unreadable without the case DEK.

```typescript
// packages/capability-router/src/encryption.ts
import sodium from 'libsodium-wrappers-sumo';
await sodium.ready;

const ENC_VERSION = 0x01; // xchacha20poly1305

export async function encryptField(
  plaintext: string | Uint8Array,
  caseId: string,
  kmsClient: KMSClient,
): Promise<Buffer> {
  const dek = await kmsClient.getDecryptedDEK(caseId); // 32 bytes, from Redis DEK cache
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

  const pt = typeof plaintext === 'string' ? sodium.from_string(plaintext) : plaintext;

  const ciphertext = sodium.crypto_secretbox_easy(pt, nonce, dek);

  // Pack: [version(1)] [nonce(24)] [ciphertext]
  const result = new Uint8Array(1 + nonce.length + ciphertext.length);
  result[0] = ENC_VERSION;
  result.set(nonce, 1);
  result.set(ciphertext, 1 + nonce.length);
  return Buffer.from(result);
}

export async function decryptField(
  encrypted: Buffer,
  caseId: string,
  kmsClient: KMSClient,
): Promise<Buffer> {
  if (encrypted[0] !== ENC_VERSION) {
    throw new Error(`Unknown encryption version: ${encrypted[0]}`);
  }
  const dek = await kmsClient.getDecryptedDEK(caseId);
  const nonceSize = sodium.crypto_secretbox_NONCEBYTES;
  const nonce = encrypted.slice(1, 1 + nonceSize);
  const ciphertext = encrypted.slice(1 + nonceSize);
  return Buffer.from(sodium.crypto_secretbox_open_easy(ciphertext, nonce, dek));
}
```

**DEK caching:** Decrypted DEKs are held in Redis for 5 minutes (TTL = 300s). Redis key: `dek:{case_id}:{kms_key_ref_hash}`. On case access revocation (user removed from `case_access`), the cached DEK is deleted immediately.

**KMS for Supabase Phase 0:** AWS KMS (accessible from Fly.io API workers via standard SDK). The Supabase Postgres instance never touches KMS — only the Fly.io API layer does. This is correct: the database holds opaque bytes; the application holds the decryption logic.

---

## Section 5 — Supabase RLS Policy Patterns

This section documents the complete RLS policy taxonomy for ChainSight's multi-tenant model. Every pattern here is applied or referenced in Section 4.

### 5.1 Authentication context

Supabase injects the authenticated user's JWT into every Postgres session. The key functions:

```sql
-- auth.uid() → UUID of the logged-in user (from Supabase Auth JWT)
-- auth.jwt() → full JWT claims as JSONB (for custom claims if needed)
-- auth.role() → 'authenticated' | 'anon' | 'service_role'
```

The backend API (Fly.io Fastify workers) uses **two connection modes**:

1. **Authenticated connection** (for reads, investigator-initiated writes): The API extracts the Supabase session token from the request header, passes it as the `Authorization: Bearer {token}` header to Supabase PostgREST, or uses `supabase.auth.setSession(token)` on the Supabase JS client. RLS policies fire normally, scoped to the authenticated user.

2. **Service role connection** (for background workers, agent writes, audit log writes): The API uses the `SUPABASE_SERVICE_ROLE_KEY` which sets `auth.role() = 'service_role'` and bypasses all RLS policies. Used only in server-side Fly.io workers — never exposed to the browser.

```typescript
// apps/api/src/supabase.ts

import { createClient } from '@supabase/supabase-js';

// For authenticated user operations (RLS applies)
export function getUserClient(userToken: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
}

// For server-side agent/worker operations (bypasses RLS)
export const serviceClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
```

**Critical rule:** The service role key **never** reaches the browser. It lives only in Fly.io environment variables for the API and worker services.

### 5.2 Agency isolation pattern

The core pattern: every table with agency-scoped data has a policy that checks `agency_id = current_agency_id()`.

```sql
-- current_agency_id() is a SECURITY DEFINER function that reads the user's agency_id
-- from the public.users table. It caches the result per transaction.
CREATE OR REPLACE FUNCTION current_agency_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT agency_id FROM public.users WHERE id = auth.uid();
$$;

-- Canonical agency isolation policy pattern:
CREATE POLICY {table}_agency_read ON {table}
  FOR SELECT USING (agency_id = current_agency_id());

CREATE POLICY {table}_agency_insert ON {table}
  FOR INSERT WITH CHECK (agency_id = current_agency_id());
```

`SECURITY DEFINER` on `current_agency_id()` means it executes with the function owner's privileges, not the caller's, preventing recursive RLS infinite loops on the `users` table.

### 5.3 Case-scoping pattern

Two levels of case scoping coexist:

**Level 1 — Agency-wide access:** By default, all investigators in an agency can see all cases in that agency. The `cases` table policy uses `agency_id = current_agency_id()`.

**Level 2 — Restricted case access:** For classified or sensitive cases, an entry in `case_access` explicitly grants access to specific users. The `user_has_case_access()` function checks both:

```sql
CREATE OR REPLACE FUNCTION user_has_case_access(p_case_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  -- Admins and supervisors see all cases in their agency
  SELECT CASE
    WHEN (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'supervisor') THEN
      (SELECT agency_id FROM cases WHERE id = p_case_id) = current_agency_id()
    -- All other roles: must be in case_access OR be lead investigator
    ELSE
      EXISTS (
        SELECT 1 FROM case_access
        WHERE case_id = p_case_id AND user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM cases
        WHERE id = p_case_id
          AND lead_investigator_id = auth.uid()
          AND agency_id = current_agency_id()
      )
  END;
$$;
```

Phase 0: `case_access` is not fully enforced — all investigators in an agency see all cases (simpler, faster to ship). The `case_access` table and `user_has_case_access()` function exist from day one so the Phase 1 restricted-case feature is just a config change, not a schema migration.

### 5.4 Supervisor scoping pattern

Supervisors need cross-case visibility within their span of control. The `supervisory_roles` table defines this:

```sql
-- Function: check if the current user supervises a given investigator
CREATE OR REPLACE FUNCTION user_supervises(p_target_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM supervisory_roles sr
    WHERE sr.user_id = auth.uid()
      AND (
        -- Agency-wide supervisor sees everyone
        (sr.scope = 'agency' AND (SELECT agency_id FROM users WHERE id = p_target_user_id) = current_agency_id())
        -- Team/squad supervisor sees specific scope_ref
        OR (sr.scope IN ('team','squad') AND sr.scope_ref = p_target_user_id)
      )
  );
$$;

-- Example: supervisor can see all cases created by investigators they supervise
CREATE POLICY cases_supervisor_read ON cases
  FOR SELECT USING (
    agency_id = current_agency_id()
    AND (
      (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'supervisor')
      OR lead_investigator_id = auth.uid()
      OR EXISTS (SELECT 1 FROM case_access WHERE case_id = cases.id AND user_id = auth.uid())
    )
  );
```

### 5.5 Append-only enforcement pattern

For tables that must be append-only (audit log, belief atoms as authored by agents):

```sql
-- Audit log: no UPDATE, no DELETE for any authenticated user
ALTER TABLE audit_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_no_update ON audit_log_entries
  AS RESTRICTIVE
  FOR UPDATE USING (FALSE);   -- blocks all updates

CREATE POLICY audit_log_no_delete ON audit_log_entries
  AS RESTRICTIVE
  FOR DELETE USING (FALSE);   -- blocks all deletes

-- Only service_role (background workers) can insert
-- Authenticated users get the read-only policy defined in Section 4.12
```

`AS RESTRICTIVE` means this policy is ANDed with all permissive policies — even if a permissive policy would allow a DELETE, this restrictive policy blocks it. This is the correct pattern for immutable tables.

### 5.6 Row-level encryption interaction with RLS

RLS policies operate on unencrypted columns (IDs, hashes, enums, timestamps). The encrypted `_enc` columns are opaque `BYTEA` to Postgres — RLS cannot filter on them. This is intentional:

- **Filtering and access control** → unencrypted columns + RLS policies.
- **Confidentiality** → encrypted columns + KMS.

The `value_hash` column on `iocs` (sha256 of the IOC value) allows deconfliction queries without decrypting the IOC:

```sql
-- Deconfliction: find if this IOC (by hash) appears in any case in this agency
SELECT c.id, c.codename
FROM iocs i
JOIN cases c ON c.id = i.case_id
WHERE i.value_hash = $value_hash
  AND c.agency_id = current_agency_id();
-- RLS on iocs ensures only the current agency's IOCs are visible
-- No decryption needed for deconfliction
```

### 5.7 Supabase Auth user creation flow

```typescript
// apps/api/src/routes/auth.ts

async function createUser(params: {
  email: string;
  password: string;
  agency_id: string;
  role: UserRole;
  invited_by: string; // user_id of the inviting admin
}) {
  // Step 1: Create Supabase Auth user (sets auth.uid())
  const { data: authUser, error } = await serviceClient.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
  });
  if (error) throw error;

  // Step 2: Create public.users row (links auth.uid() to agency)
  // Uses service role to bypass RLS for the initial insert
  await serviceClient.from('users').insert({
    id: authUser.user.id, // same UUID as auth.users.id
    agency_id: params.agency_id,
    role: params.role,
  });

  // Step 3: Create default case_access entries if needed
  // Step 4: Log to audit_log_entries
}
```

The `public.users.id` is always the same UUID as `auth.users.id`. This makes `auth.uid()` directly usable in RLS policies on `public.users`.

### 5.8 RLS and the migration to AWS RDS

When the operational store migrates from Supabase to AWS RDS (Phase 2):

- All RLS policies are preserved verbatim — AWS RDS Postgres supports RLS identically.
- The `auth.uid()` function needs a replacement. On AWS, the API layer injects the user ID via `SET LOCAL app.current_user_id = '{uuid}'` at the start of each transaction, and the helper functions are updated to use `current_setting('app.current_user_id')::uuid` instead of `auth.uid()`.

```sql
-- AWS RDS equivalent of auth.uid()
CREATE OR REPLACE FUNCTION auth_uid()
RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
$$;

-- Update all policies to use auth_uid() instead of auth.uid()
-- This is a mechanical find-and-replace in the migration scripts.
```

The application layer (Fly.io API) adds this before every authenticated query:

```typescript
// apps/api/src/db/aws-rds.ts (Phase 2 migration)
async function withUserContext<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
    return await fn(client);
  } finally {
    client.release();
  }
}
```

This makes the RLS policies fully portable between Supabase and AWS RDS.

---

## Section 6 — Belief State Event Store

### 6.1 Design principles

The Belief State (B1 lock) is an **append-only, event-sourced log**. The `belief_atoms` table in Supabase Postgres (Section 4.5) is the primary store. Key design decisions:

1. **No updates to existing rows.** A new event always creates a new row. Retraction and supersession are forward-pointing references, not edits. The `AS RESTRICTIVE` RLS policy on `belief_atoms` does not block service_role updates (service_role bypasses RLS), but the application layer explicitly enforces no-update via the `BeliefStateService` class.
2. **Hash chaining.** Each row's `content_hash` covers the row's full content, and `prior_event_hash` links to the previous row's `content_hash`. This creates an append-only chain detectable at any point.
3. **Snapshot strategy.** A materialized view (`belief_state_current`) captures the current non-retracted/non-superseded atom per `(case_id, subject_type, subject_ref, predicate)`. Refreshed after each batch of agent writes using Supabase's `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
4. **Supabase Realtime integration.** The `belief_atoms` table is added to the Supabase Realtime publication so the frontend receives live updates as agents emit new atoms during an active trace. See Section 12.

### 6.2 Content hash computation

```typescript
function computeBeliefAtomContentHash(atom: {
  case_id: string;
  subject_type: string;
  subject_ref: string;
  predicate: string;
  object_hash: string; // sha256 of the decrypted object JSON
  confidence: number;
  tier: string;
  created_by: string | null;
  created_by_agent: string | null;
  created_at: Date;
}): string {
  const canonical = JSON.stringify(
    {
      case_id: atom.case_id,
      subject_type: atom.subject_type,
      subject_ref: atom.subject_ref,
      predicate: atom.predicate,
      object_hash: atom.object_hash,
      confidence: atom.confidence.toFixed(4),
      tier: atom.tier,
      created_by: atom.created_by ?? atom.created_by_agent ?? 'system',
      created_at: atom.created_at.toISOString(),
    },
    null,
    0,
  ); // No whitespace, keys in insertion order (consistent)
  return sha256(canonical);
}
```

The `prior_event_hash` for the first row of a case is `sha256(case_id)` — a known sentinel. Walking the hash chain detects any gap or tampering.

### 6.3 Challenges and supersessions

A **challenge** is a BeliefAtom with `predicate = 'challenges'` pointing at another atom:

```typescript
await beliefStateService.emit({
  case_id,
  subject_type: 'belief_atom',
  subject_ref: challenged_atom_id,
  predicate: 'challenges',
  object: {
    challenge_reason: 'alternative_explanation_stronger',
    challenge_text: 'The Binance attribution is unsupported...',
    resolution_required_before_court_grade: true,
  },
  confidence: 0.85,
  tier: 'T2',
  created_by_agent: 'critic_agent',
});

// Mark challenged atom (service_role update, not available to authenticated users)
await serviceClient
  .from('belief_atoms')
  .update({ status: 'challenged' })
  .eq('id', challenged_atom_id);
```

**Supersession:**

```sql
-- Atomic supersession (service_role transaction)
BEGIN;
  INSERT INTO belief_atoms (id, case_id, ..., status, superseded_by, ...)
  VALUES ($new_id, $case_id, ..., 'asserted', NULL, ...);

  UPDATE belief_atoms
  SET superseded_by = $new_id, status = 'superseded'
  WHERE id = $old_id;
COMMIT;
```

### 6.4 Materialized view snapshot

```sql
CREATE MATERIALIZED VIEW belief_state_current AS
SELECT DISTINCT ON (case_id, subject_type, subject_ref, predicate)
  id, case_id, subject_type, subject_ref, predicate,
  object_hash, confidence, tier, status, created_at
FROM belief_atoms
WHERE status IN ('asserted', 'challenged', 'court_grade')
ORDER BY case_id, subject_type, subject_ref, predicate, created_at DESC;

CREATE UNIQUE INDEX ON belief_state_current(case_id, subject_type, subject_ref, predicate);
-- RLS does not apply to materialized views in Postgres.
-- This view is queried via the service role only (on the API server).
-- Frontend uses the belief_atoms table directly (RLS applies).
```

Refreshed by the graph builder worker using `REFRESH MATERIALIZED VIEW CONCURRENTLY belief_state_current` after each agent batch write. Concurrent refresh means reads are not blocked.

### 6.5 Court-grade promotion

```typescript
// apps/api/src/services/belief-state.ts

async function promoteToCourtGrade(atomId: string, signingUserId: string) {
  // Precondition checks (application layer — not relying on DB triggers)
  const atom = await serviceClient
    .from('belief_atoms')
    .select('confidence, tier, status, provenance_json')
    .eq('id', atomId)
    .single();

  if (atom.data.confidence < 0.85) throw new BeliefStateError('confidence_too_low');
  if (!['T0', 'T1', 'T2'].includes(atom.data.tier)) throw new BeliefStateError('tier_ineligible');
  if (atom.data.status !== 'asserted') throw new BeliefStateError('not_asserted');

  // Check no open challenges
  const challenges = await serviceClient
    .from('belief_atoms')
    .select('id')
    .eq('subject_type', 'belief_atom')
    .eq('subject_ref', atomId)
    .eq('predicate', 'challenges')
    .eq('status', 'asserted');

  if ((challenges.data?.length ?? 0) > 0) throw new BeliefStateError('open_challenges');

  // Promote
  await serviceClient
    .from('belief_atoms')
    .update({ status: 'court_grade', signoff_id: signingUserId })
    .eq('id', atomId);

  await auditLog.write({
    action: 'belief_atom.court_grade',
    target_ref: atomId,
    actor_id: signingUserId,
  });
}
```

---

## Section 7 — The Cache Layer (F23) in Full Detail

### 7.1 Architecture overview

Two physical layers:

- **Redis (hot cache):** Upstash Redis or Fly.io managed Redis. Sub-millisecond reads. Immutable chain data and hot attribution lookups.
- **Supabase Postgres `cache_entries` table (warm/persistent cache):** Full payload, audit trail, TTL enforcement, invalidation logic.

```
Request → [Redis check] → hit: return
                       → miss: [Postgres cache_entries check]
                                → hit: hydrate Redis, return
                                → miss: [provider API call]
                                         → write to Postgres cache_entries
                                         → write to Redis
                                         → return fresh data
```

### 7.2 Cache key construction

```typescript
function buildCacheKey(params: {
  capability: string;
  args: Record<string, unknown>;
  provider_install_id: string;
  scope: 'global_chain_data' | 'agency' | 'case' | 'private_attribution';
  scope_ref: string | null;
}): string {
  const canonical_args = canonicalJSON(params.args);
  const key_material = [
    params.capability,
    canonical_args,
    params.provider_install_id,
    params.scope,
    params.scope_ref ?? 'global',
  ].join('|');
  return `cache:${sha256(key_material)}`;
}
```

Global chain data is keyed without a scope_ref — shared across all agencies and cases. Agency-scoped attribution includes `agency_id` so different agencies with different provider mixes never cross-pollinate. Private attribution includes `user_id`.

### 7.3 TTL enforcement by tier

```typescript
const TTL_CONFIG = {
  immutable: { redis_ttl_sec: null, pg_expires: null },
  slow_drift: { redis_ttl_sec: 6 * 3600, pg_expires: '7 days' },
  medium_drift: { redis_ttl_sec: 2 * 3600, pg_expires: '24 hours' },
  fast_drift: { redis_ttl_sec: 5 * 60, pg_expires: '5 minutes' },
};
```

A background Fly.io worker (`cache-sweeper`) runs every 15 minutes:

```sql
DELETE FROM cache_entries
WHERE expires_at < NOW()
  AND scope != 'global_chain_data'   -- immutable data never expired
  AND id NOT IN (
    SELECT unnest(provider_snapshot_refs::uuid[])
    FROM reproducibility_packs        -- never expire data in an active repro pack
  );
```

### 7.4 Per-scope isolation

Cache reads enforce scope isolation via Supabase RLS (Section 4.7). The backend API uses the authenticated user's Supabase client for cache reads, so RLS automatically prevents cross-tenant cache access. The `private_attribution` scope is protected by `scope_ref = auth.uid()` — only the owning user can read their private attribution cache.

### 7.5 Manual refresh workflow

The refresh button triggers a `cache-refresh` BullMQ job (service role, bypasses RLS for the invalidation write):

```typescript
interface CacheRefreshJob {
  case_id: string;
  agency_id: string;
  requested_by: string;
  scope_selection: 'single_entity' | 'selected_entities' | 'viewport' | 'all_case';
  entity_ids?: string[];
  data_types: Array<
    | 'attribution_labels'
    | 'token_metadata'
    | 'address_balances'
    | 'tx_history'
    | 'obfuscation_detection'
  >;
  estimated_cost_usd: number;
}
```

The refresh worker:

1. Deletes (sets `expires_at = NOW()`) relevant `cache_entries` rows via service client.
2. Re-runs capability router calls (now cache misses → provider calls).
3. For responses where `delta_detected = true`, publishes a Supabase Realtime event to the `case:{case_id}:cache_refresh` channel so the frontend canvas highlights changed nodes.
4. Logs all invalidation events to `audit_log_entries`.

### 7.6 Automatic invalidation triggers

**Chain reorg** → `cache_entries` rows with matching tx_hash in `args_canonical` get `expires_at = NOW()`.

**Sanctions update** → Daily job calls `cacheInvalidationService.invalidateByAddress(sanctioned_addresses)` using service client.

**Provider webhook** → Webhook handler (Fastify route) invalidates the specific address's attribution cache entries.

**Admin flush** → Agency admin calls `DELETE FROM cache_entries WHERE scope IN ('agency','case') AND scope_ref IN (...)`. Service client bypasses RLS.

All invalidation events are logged with `reason` to `audit_log_entries`.

### 7.7 Cost telemetry

```sql
-- Monthly cost dashboard query (executed via service role, results shown to admins)
SELECT
  pi.display_label,
  SUM(pce.cost_usd) AS total_cost,
  SUM(pce.cost_usd) FILTER (WHERE pce.cache_hit = FALSE) AS provider_cost,
  COUNT(*) FILTER (WHERE pce.cache_hit = TRUE)::FLOAT / NULLIF(COUNT(*), 0) AS hit_rate,
  -- Estimated savings: (cache_hits × avg_cost_per_miss)
  COUNT(*) FILTER (WHERE pce.cache_hit = TRUE) *
    AVG(pce.cost_usd) FILTER (WHERE pce.cache_hit = FALSE) AS estimated_savings
FROM provider_cost_events pce
JOIN agency_provider_installs pi ON pi.id = pce.provider_install_id
WHERE pce.agency_id = $agency_id
  AND pce.occurred_at >= date_trunc('month', NOW())
GROUP BY pi.id, pi.display_label
ORDER BY total_cost DESC;
```

---

## Section 8 — Reproducibility Pack Format

### 8.1 Pack structure

A Reproducibility Pack is a content-addressed `.tar.gz` archive:

```
{pack_id}/
  manifest.json
  replay.sh
  replay-requirements.txt

  chain-data/
    {chain}/
      transactions.parquet
      utxo_outputs.parquet     (UTXO chains only)
      log_events.parquet       (EVM chains only)

  provider-snapshots/
    {cache_key_hex}/
      metadata.json
      response.json.zst

  belief-state/
    atoms.jsonl                (append-only atom log, decrypted for replay)
    snapshots/

  rule-versions/
    clustering-rules-{version}.json
    bridge-decoders-{version}.json
    obfuscation-detectors-{version}.json

  model-cards/
    {model_card_id}.json
    prompt-templates/

  case-data/
    trace_paths.json
    methodology.json

  hashes.json
  pack_hash.txt
```

### 8.2 Manifest schema

```json
{
  "pack_id": "uuid",
  "case_id": "uuid",
  "agency_id": "uuid",
  "chainsight_version": "1.0.3",
  "pack_format_version": "1",
  "created_at": "2026-06-16T18:07:00Z",
  "created_by": "user_id",
  "content_hash": "sha256:abc123...",
  "chain_anchor": {
    "chain": "ethereum",
    "tx_hash": "0x...",
    "anchored_at": "2026-06-16T18:10:00Z"
  },
  "case_summary": {
    "codename": "[REDACTED]",
    "chain_scope": ["ethereum", "bitcoin"],
    "methodology_used": "FIFO",
    "trace_depth_max": 8,
    "belief_atoms_total": 1247,
    "court_grade_atoms": 89
  },
  "chain_data_snapshot": {
    "chains_covered": ["ethereum", "bitcoin"],
    "block_range_by_chain": {
      "ethereum": { "first": 19000000, "last": 19500000 }
    },
    "tx_count": 4821,
    "parquet_files": [
      { "path": "chain-data/ethereum/transactions.parquet", "sha256": "...", "rows": 3200 }
    ]
  },
  "provider_snapshots": [
    {
      "cache_key": "sha256:...",
      "capability": "get_entity_attribution",
      "provider_id": "trm_labs",
      "fetched_at": "2026-06-10T14:22:00Z",
      "ttl_tier": "slow_drift",
      "response_hash": "sha256:..."
    }
  ],
  "rule_versions": {
    "clustering_rules": "2026.06.10",
    "bridge_decoders": "2026.05.30",
    "obfuscation_detectors": "2026.06.01"
  },
  "model_cards": [
    {
      "id": "uuid",
      "model_id": "claude-opus-4-6",
      "version": "20260601",
      "prompt_template_hash": "sha256:..."
    }
  ]
}
```

### 8.3 The `replay.sh` script

```bash
#!/usr/bin/env bash
# ChainSight Reproducibility Pack Replay Script
# Pack ID: {pack_id}
# Created: {created_at}
set -euo pipefail

PACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAINSIGHT_VERSION="{chainsight_version}"

echo "=== ChainSight Reproducibility Pack Replay ==="
echo "Pack: {pack_id} | Version: ${CHAINSIGHT_VERSION}"

# Step 1: Verify pack integrity
echo "Step 1/5: Verifying integrity..."
python3 "${PACK_DIR}/scripts/verify_hashes.py" "${PACK_DIR}/hashes.json"
EXPECTED="{content_hash}"
ACTUAL="sha256:$(sha256sum "${PACK_DIR}/pack_hash.txt" | cut -d' ' -f1)"
[ "${ACTUAL}" = "${EXPECTED}" ] || { echo "ERROR: Pack hash mismatch"; exit 1; }
echo "✓ ${ACTUAL}"

# Step 2: Start isolated replay container (no network access)
echo "Step 2/5: Starting replay container..."
docker pull "ghcr.io/chainsight/replay:${CHAINSIGHT_VERSION}"
CID=$(docker run -d \
  --network none \
  -v "${PACK_DIR}:/pack:ro" \
  -e REPLAY_MODE=true \
  -e PACK_PATH=/pack \
  "ghcr.io/chainsight/replay:${CHAINSIGHT_VERSION}")

# Steps 3-5: Load data, replay, compare
echo "Step 3/5: Loading frozen data..."
docker exec "${CID}" python3 /app/replay/load_pack.py

echo "Step 4/5: Replaying belief state..."
docker exec "${CID}" python3 /app/replay/replay_trace.py \
  --belief-log /pack/belief-state/atoms.jsonl \
  --rule-versions /pack/rule-versions/ \
  --model-cards /pack/model-cards/

echo "Step 5/5: Comparing to original..."
docker exec "${CID}" python3 /app/replay/compare_output.py --original-hash "{content_hash}"

docker stop "${CID}"
echo "=== Replay Complete. Results in /tmp/chainsight_replay_{pack_id}/ ==="
```

### 8.4 Pack content hashing

```python
# packages/reproducibility/src/pack_builder.py
import hashlib, json
from pathlib import Path

def build_pack(pack_dir: Path) -> str:
    hashes = {}
    for file_path in sorted(pack_dir.rglob('*')):
        if file_path.is_file() and file_path.name not in ('hashes.json', 'pack_hash.txt'):
            rel_path = str(file_path.relative_to(pack_dir))
            with open(file_path, 'rb') as f:
                hashes[rel_path] = hashlib.sha256(f.read()).hexdigest()

    hashes_path = pack_dir / 'hashes.json'
    hashes_path.write_text(json.dumps(hashes, sort_keys=True, indent=2))

    root_hash = hashlib.sha256(hashes_path.read_bytes()).hexdigest()
    (pack_dir / 'pack_hash.txt').write_text(f"sha256:{root_hash}\n")
    return f"sha256:{root_hash}"
```

The pack archive is stored in **Supabase Storage** (SaaS Blind) or **MinIO** (On-Prem) under the `repro-packs` bucket. The S3 path is `{agency_id}/{case_id}/{pack_id}.tar.gz`. The `reproducibility_packs.s3_ref` column holds this path.

---

## Section 9 — Document Storage (Supabase Storage + Swappable Backends)

### 9.1 SaaS Blind v1: Supabase Storage

For SaaS Blind Phase 0–1, all case documents are stored in **Supabase Storage**. Key properties:

- S3-compatible API (Supabase Storage uses the same `PutObject`/`GetObject` interface as S3).
- Built-in CDN for frontend document previews (with RLS-enforced presigned URLs).
- Supabase Storage Row-Level Security: bucket-level policies enforce that a user can only access files in their agency's path prefix.
- **Important:** Supabase Storage RLS does not replace application-layer encryption. Documents are encrypted before upload with the case DEK, so even if a Supabase Storage bucket were misconfigured, the files are opaque bytes.

### 9.2 Storage abstraction interface

The storage interface makes the backend code identical across Supabase Storage, MinIO, and AWS S3:

```typescript
// packages/document-storage/src/interface.ts

export interface StorageBackend {
  readonly backendId: string; // "supabase_storage" | "minio" | "aws_s3" | "azure_blob" | "gcs" | "nfs"

  upload(params: {
    bucket: string;
    path: string;
    data: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ path: string; size: number }>;

  download(params: { bucket: string; path: string }): Promise<Buffer>;

  getSignedUrl(params: { bucket: string; path: string; expiresInSeconds: number }): Promise<string>;

  delete(params: { bucket: string; path: string }): Promise<void>;

  list(params: {
    bucket: string;
    prefix: string;
  }): Promise<Array<{ path: string; size: number; lastModified: Date }>>;
}
```

**Supabase Storage implementation:**

```typescript
// packages/document-storage/src/backends/supabase.ts
import { createClient } from '@supabase/supabase-js';

export class SupabaseStorageBackend implements StorageBackend {
  readonly backendId = 'supabase_storage';
  private client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role for storage operations
  );

  async upload({ bucket, path, data, contentType }) {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, data, { contentType, upsert: false });
    if (error) throw new StorageError(error.message);
    return { path, size: data.length };
  }

  async download({ bucket, path }) {
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error) throw new StorageError(error.message);
    return Buffer.from(await data.arrayBuffer());
  }

  async getSignedUrl({ bucket, path, expiresInSeconds }) {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) throw new StorageError(error.message);
    return data.signedUrl;
  }

  async delete({ bucket, path }) {
    const { error } = await this.client.storage.from(bucket).remove([path]);
    if (error) throw new StorageError(error.message);
  }

  async list({ bucket, prefix }) {
    const { data, error } = await this.client.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw new StorageError(error.message);
    return data.map((f) => ({
      path: `${prefix}/${f.name}`,
      size: f.metadata?.size ?? 0,
      lastModified: new Date(f.updated_at ?? f.created_at),
    }));
  }
}
```

**MinIO (On-Prem) implementation** uses the AWS SDK with `forcePathStyle: true` and the MinIO endpoint. **AWS S3 (Phase 2)** uses the standard AWS SDK. The application layer calls `storageBackend.upload(...)` — it never instantiates the backend directly; it goes through the factory:

```typescript
// packages/document-storage/src/factory.ts

export function getStorageBackend(install: AgencyStorageInstall): StorageBackend {
  switch (install.backend_id) {
    case 'supabase_storage':
      return new SupabaseStorageBackend();
    case 'minio_on_prem':
      return new MinioStorageBackend(install.config);
    case 'aws_s3':
      return new S3StorageBackend(install.config);
    case 'azure_blob':
      return new AzureBlobStorageBackend(install.config);
    case 'gcs':
      return new GCSStorageBackend(install.config);
    case 'nfs_mount':
      return new NFSStorageBackend(install.config);
    default:
      throw new Error(`Unknown storage backend: ${install.backend_id}`);
  }
}
```

### 9.3 Document storage path structure

```
bucket: documents
  {agency_id}/{case_id}/{doc_id}/
    content          -- encrypted document content
    thumbnail.jpg    -- for PDFs: first page thumbnail (encrypted)

bucket: repro-packs
  {agency_id}/{case_id}/{pack_id}.tar.gz

bucket: chain-data
  canonical/chain={chain}/date={date}/*.parquet
  raw/...

bucket: audit-log
  {agency_id}/{YYYY}/{MM}/{DD}/{entry_id}.json.zst
```

### 9.4 Encryption at rest

Documents are encrypted **before** upload. The encryption key is the case DEK:

```typescript
async function uploadDocument(params: {
  document: Buffer;
  caseId: string;
  docId: string;
  agencyId: string;
  mimeType: string;
}): Promise<{ storagePath: string; contentHash: string }> {
  // 1. Compute content hash before encryption
  const contentHash = sha256(params.document);

  // 2. Encrypt with case DEK
  const encrypted = await encryptField(params.document, params.caseId, kmsClient);

  // 3. Upload encrypted bytes to Supabase Storage
  const storagePath = `${params.agencyId}/${params.caseId}/${params.docId}/content`;
  await storageBackend.upload({
    bucket: 'documents',
    path: storagePath,
    data: encrypted,
    contentType: 'application/octet-stream', // always octet-stream; original MIME in Postgres
    metadata: { enc_version: 'v1', case_id: params.caseId },
  });

  return { storagePath, contentHash };
}
```

The `case_documents.storage_path_enc` column stores the storage path encrypted with the case DEK. The `case_documents.content_hash` stores the sha256 of the unencrypted content. To read a document:

1. Retrieve DEK from KMS via `case_dek_refs.kms_key_ref`.
2. Decrypt `storage_path_enc` → get storage path.
3. Download from Supabase Storage.
4. Decrypt with case DEK.

### 9.5 Supabase Storage RLS (bucket policies)

Supabase Storage supports RLS on the `storage.objects` table:

```sql
-- Only allow authenticated users to access their agency's documents
CREATE POLICY docs_agency_access ON storage.objects
  FOR ALL USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (
      SELECT agency_id::text FROM public.users WHERE id = auth.uid()
    )
  );
```

This is defense-in-depth: even at the storage API layer, a user cannot access another agency's object paths. The libsodium encryption layer provides additional confidentiality beyond what storage RLS can guarantee.

### 9.6 Versioning, legal hold, and retention

Document versioning is tracked at the application layer via `case_document_versions` (same schema as Section 4.8 in the original design). Supabase Storage does not provide S3-style bucket versioning — the application manages versions.

Legal hold prevents deletion:

- `case_documents.legal_hold = TRUE` is checked before any delete operation.
- The `cache-sweeper` worker skips documents with `legal_hold = TRUE`.
- On Phase 2 migration to AWS S3, legal-hold documents are tagged and Object Lock is enabled on the S3 bucket.

### 9.7 Migration from Supabase Storage to AWS S3 (Phase 2)

The migration is a background copy job with zero downtime:

```python
# infra/scripts/migrate_storage_to_s3.py

async def migrate_documents(agency_id: str):
    # 1. Create S3 bucket with identical path structure
    # 2. For each document in Supabase Storage under {agency_id}/:
    #    a. Download encrypted bytes from Supabase Storage
    #    b. Upload to AWS S3 (same path, same encrypted bytes — no re-encryption needed)
    #    c. Verify S3 ETag matches Supabase Storage ETag
    #    d. Update case_documents.storage_backend_id = 'aws_s3'
    #    e. Update case_documents.storage_path_enc (path unchanged, backend changed)
    # 3. Flip the storage factory to use S3 for new uploads
    # 4. Delete from Supabase Storage after 30-day retention period
```

No re-encryption is needed. The encrypted bytes are identical; only the storage backend changes. The `storage_backend_id` column in `case_documents` controls which backend the factory returns.

---

## Section 10 — UTXO Clustering Data Model (F24)

### 10.1 Table overview

Full DDL in Section 4.10. This section covers the algorithmic flow, persistence lifecycle, and investigator override handling.

### 10.2 Clustering algorithm execution

The clustering algorithm runs as a BullMQ job in the `cluster-compute` queue on Fly.io workers (service role, bypasses RLS):

```
Input: seed_address_id, case_id, depth_cap (default: 6 rounds)

1. Fetch all transactions where seed address is an input (from Supabase cache_entries or cold storage)
2. Collect all co-input addresses → Round 1 members
3. For each new member, repeat → Round 2, ..., Round N
4. For each transaction in the cluster's tx set:
   a. Run change detection heuristic ensemble on each output
   b. Collect change-output addresses (confidence > 0.5) → change_detection members
5. Detect CoinJoin transactions; exclude from CIH propagation
6. Compute aggregate cluster confidence
7. Write UTXOCluster row (service client)
8. Write ClusterMember rows
9. Write ChangeDetectionResult rows
10. Write BeliefAtoms for each membership inference
11. Enqueue graph builder job → sync to Memgraph on Fly.io
12. Publish Supabase Realtime event → canvas shows cluster materializing live
```

### 10.3 Change detection heuristic ensemble

```typescript
// packages/capability-router/src/clustering/change-detection.ts

interface ChangeDetectionHeuristic {
  name: string;
  version: string;
  weight: number;
  evaluate(tx: CanonicalTransaction, output_index: number): number;
}

const HEURISTICS: ChangeDetectionHeuristic[] = [
  {
    name: 'optimal_change',
    version: '2026.04.01',
    weight: 0.3,
    evaluate(tx, idx) {
      if (tx.outputs?.length !== 2) return 0;
      return tx.outputs[idx].value_native < tx.outputs[1 - idx].value_native ? 0.6 : 0.3;
    },
  },
  {
    name: 'round_payment',
    version: '2026.04.01',
    weight: 0.2,
    evaluate(tx, idx) {
      const v = tx.outputs?.[idx].value_native ?? 0n;
      return v % 100000n === 0n ? 0.1 : 0.7;
    },
  },
  {
    name: 'one_time_use',
    version: '2026.04.01',
    weight: 0.25,
    // async: queries cold storage for address history
    evaluate(_tx, _idx) {
      return 0.5;
    },
  },
  {
    name: 'script_type_match',
    version: '2026.04.01',
    weight: 0.25,
    evaluate(tx, idx) {
      if (!tx.inputs?.length) return 0;
      return tx.inputs[0].script_type === tx.outputs?.[idx].script_type ? 0.75 : 0.3;
    },
  },
];
```

Rule versions are pinned in `utxo_clusters.rule_version` and in the Reproducibility Pack's `rule_versions/clustering-rules-{version}.json`.

### 10.4 CoinJoin detection

```typescript
function isCoinJoin(tx: CanonicalTransaction): boolean {
  if (!tx.outputs || tx.outputs.length < 3) return false;
  const value_counts = new Map<bigint, number>();
  for (const out of tx.outputs)
    value_counts.set(out.value_native, (value_counts.get(out.value_native) ?? 0) + 1);
  const max_count = Math.max(...value_counts.values());
  if (max_count >= 3) return true;
  if (new Set(tx.outputs.map((o) => o.value_native)).size === 1 && tx.outputs.length >= 2)
    return true;
  return false;
}
```

### 10.5 Investigator overrides

Overrides are stored as BeliefAtoms (tier T0, investigator-asserted) and reflected in `cluster_members`:

```typescript
await beliefStateService.emit({
  subject_type: 'cluster',
  subject_ref: cluster_id,
  predicate: 'cluster_override',
  object: {
    override_type: 'exclude_address',
    target_address: '1AbcExcluded...',
    reason: 'Subpoena confirms this address is a different entity',
    evidence_refs: ['doc_id_123'],
  },
  confidence: 1.0,
  tier: 'T0',
  created_by: user_id,
});

await serviceClient
  .from('cluster_members')
  .update({ joined_via: 'manually_excluded', confidence: 0 })
  .eq('cluster_id', cluster_id)
  .eq('normalized_address', excluded_address);
```

The canvas re-renders the cluster after the override, pulling updated `cluster_members` via Supabase Realtime subscription on the `cluster_members` table for the current case.

---

## Section 11 — Vector Store (pgvector in Supabase)

### 11.1 Embedding strategy

pgvector lives in the same Supabase Postgres instance as the operational store (no separate vector DB until volume forces it). This simplifies Phase 0 enormously: one managed database, one connection pool, one backup/restore procedure.

Default embedding provider: **Voyage AI** (BYOK). Self-hosted fallback: **BGE-M3** (1024-dim, runs on Fly.io CPU worker).

| Use case                      | Model                   | Dimensions | Notes                                    |
| ----------------------------- | ----------------------- | ---------- | ---------------------------------------- |
| Document chunks               | voyage-large-2-instruct | 1024       | Best retrieval for legal/technical text  |
| Belief atom text              | voyage-large-2-instruct | 1024       | Consistent model for all semantic search |
| Attribution labels            | voyage-code-2           | 1536       | Better for technical entity names        |
| Case summaries                | voyage-large-2-instruct | 1024       | Cross-case similarity                    |
| BGE-M3 (self-hosted fallback) | BGE-M3                  | 1024       | No API cost                              |

### 11.2 Vector table DDL

```sql
-- Enable pgvector (already included in Supabase Postgres)
CREATE EXTENSION IF NOT EXISTS vector;

-- ──────────────────────────────────────────────────────────────

CREATE TABLE document_embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID NOT NULL REFERENCES case_documents(id),
  case_id             UUID NOT NULL,
  agency_id           UUID NOT NULL,
  chunk_index         INTEGER NOT NULL,
  chunk_text_hash     TEXT NOT NULL,
  chunk_text_enc      BYTEA NOT NULL,       -- encrypted chunk text
  chunk_token_count   INTEGER NOT NULL,
  embedding           VECTOR(1024) NOT NULL,
  embedding_model     TEXT NOT NULL,
  embedding_version   TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_embeddings_case_access ON document_embeddings
  FOR SELECT USING (user_has_case_access(case_id));

CREATE INDEX idx_doc_embeddings_doc ON document_embeddings(document_id);
CREATE INDEX idx_doc_embeddings_hnsw ON document_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE belief_atom_embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belief_atom_id      UUID NOT NULL REFERENCES belief_atoms(id),
  case_id             UUID NOT NULL,
  agency_id           UUID NOT NULL,
  text_content_hash   TEXT NOT NULL,
  embedding           VECTOR(1024) NOT NULL,
  embedding_model     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE belief_atom_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY belief_embeddings_case_access ON belief_atom_embeddings
  FOR SELECT USING (user_has_case_access(case_id));

CREATE INDEX idx_belief_embeddings_hnsw ON belief_atom_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ──────────────────────────────────────────────────────────────

CREATE TABLE playbook_embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id         TEXT NOT NULL,
  playbook_version    TEXT NOT NULL,
  section_index       INTEGER NOT NULL,
  section_hash        TEXT NOT NULL,
  embedding           VECTOR(1024) NOT NULL,
  embedding_model     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No RLS — playbooks are platform-level, visible to all authenticated users
ALTER TABLE playbook_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY playbooks_all_read ON playbook_embeddings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE INDEX idx_playbook_embeddings_hnsw ON playbook_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 11.3 HNSW vs IVFFlat decision

**Using HNSW** at Phase 0–2 scale (< 5M vectors). HNSW provides better query latency than IVFFlat without requiring a training step (IVFFlat's k-means training on the full dataset is complex to maintain with incremental inserts). Switch to IVFFlat at > 50M vectors.

Supabase Postgres supports HNSW natively via pgvector 0.5+. Confirmed supported on Supabase managed Postgres.

### 11.4 RAG retrieval query

```sql
-- Top-5 most relevant document chunks for a query embedding (case-scoped)
SELECT
  de.id,
  de.chunk_text_enc,     -- API decrypts before sending to LLM
  de.chunk_index,
  cd.filename_enc,
  1 - (de.embedding <=> $1::vector) AS similarity
FROM document_embeddings de
JOIN case_documents cd ON cd.id = de.document_id
WHERE de.case_id = $2
  AND de.agency_id = $3
  AND de.embedding_model = $4
ORDER BY de.embedding <=> $1::vector
LIMIT 5;
```

RLS on `document_embeddings` ensures a user calling this via authenticated client only retrieves chunks from cases they have access to. The API uses the user's authenticated Supabase client for this query — not service role.

### 11.5 Sharding path (Phase 4+)

When the Supabase Postgres instance's pgvector HNSW index build time becomes a concern (> 50M rows, roughly Phase 4+), the migration path is:

1. Partition `document_embeddings` by `agency_id` using Postgres declarative partitioning.
2. Move large agencies' partitions to dedicated Postgres instances (AWS RDS by then).
3. The API routes vector queries to the correct shard based on `agency_id`.

This is a Phase 4 concern and does not affect Phase 0–2 schema.

---

## Section 12 — Supabase Realtime Integration

### 12.1 Purpose and scope

Supabase Realtime provides a WebSocket-based pub/sub layer backed by Postgres logical replication (the `wal_level = logical` change capture). It handles three distinct real-time use cases for ChainSight:

| Use case              | Channel pattern                | Data                                       | Latency target |
| --------------------- | ------------------------------ | ------------------------------------------ | -------------- |
| Live trace progress   | `case:{case_id}:trace`         | Agent progress events                      | < 500ms        |
| Deconfliction alerts  | `user:{user_id}:alerts`        | DeconflictionAlert rows                    | < 1s           |
| Cache refresh delta   | `case:{case_id}:cache_refresh` | Changed entity IDs                         | < 500ms        |
| Watcher notifications | `user:{user_id}:watchers`      | WatcherFiring events (Phase 3+)            | < 1s           |
| Belief atom updates   | `case:{case_id}:beliefs`       | New atom summaries (not encrypted content) | < 500ms        |

The CRDT canvas (Yjs, Phase 2+) uses its own WebSocket layer — not Supabase Realtime. Supabase Realtime is for **server-to-client notifications**, not collaborative document synchronization.

### 12.2 Setting up Realtime publications

```sql
-- Enable Realtime for specific tables
-- (Supabase dashboard or SQL editor)
ALTER PUBLICATION supabase_realtime ADD TABLE belief_atoms;
ALTER PUBLICATION supabase_realtime ADD TABLE chain_of_custody_records;
-- Note: cache_entries is NOT added — too high frequency, payload too large.
-- Cache refresh events are sent via a custom Realtime Broadcast channel instead.
```

**Why not add all tables:** Supabase Realtime replicates full row changes. For encrypted tables with large BYTEA fields (belief_atoms.object_enc), the replication payload is large. The frontend subscribes to `belief_atoms` changes and receives only unencrypted fields (IDs, predicate, status, confidence) — the `object_enc` column is excluded from the frontend subscription via column filtering.

### 12.3 Frontend subscription pattern

```typescript
// apps/web/src/lib/realtime.ts

export function subscribeToTrace(caseId: string, onUpdate: (event: TraceEvent) => void) {
  const channel = supabase
    .channel(`case:${caseId}:trace`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'belief_atoms',
        filter: `case_id=eq.${caseId}`,
      },
      (payload) => {
        // payload.new contains only non-encrypted columns (Supabase filters BYTEA)
        onUpdate({
          atomId: payload.new.id,
          predicate: payload.new.predicate,
          subjectRef: payload.new.subject_ref,
          confidence: payload.new.confidence,
          tier: payload.new.tier,
          status: payload.new.status,
        });
      },
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
```

Supabase Realtime respects RLS policies: a user subscribing to `case:{case_id}:beliefs` only receives events for cases they have access to. The RLS policy on `belief_atoms` (`user_has_case_access(case_id)`) applies at the Realtime subscription level.

### 12.4 Custom broadcast for cache refresh

Cache refresh delta events (which entity IDs changed) are sent via Supabase Realtime Broadcast (non-persisted, point-to-point broadcast) rather than database change capture:

```typescript
// apps/worker/src/jobs/cache-refresh.ts (after refresh completes)

await supabase.channel(`case:${caseId}:cache_refresh`).send({
  type: 'broadcast',
  event: 'cache_refreshed',
  payload: {
    changed_entity_ids: changed_ids, // entity IDs where delta_detected = true
    refreshed_at: new Date().toISOString(),
    data_types_refreshed: job.data_types,
  },
});
```

```typescript
// apps/web/src/lib/realtime.ts (frontend canvas)

supabase
  .channel(`case:${caseId}:cache_refresh`)
  .on('broadcast', { event: 'cache_refreshed' }, ({ payload }) => {
    canvasStore.pulseNodes(payload.changed_entity_ids); // 5-second highlight
  })
  .subscribe();
```

### 12.5 Presence (Phase 2+)

Supabase Realtime Presence tracks which investigators are currently viewing the same case canvas. Used in Phase 2 for the collaborative canvas awareness layer (showing cursor positions, selected nodes):

```typescript
// In the canvas component (Phase 2+)
const presenceChannel = supabase.channel(`case:${caseId}:presence`);

presenceChannel
  .on('presence', { event: 'sync' }, () => {
    const state = presenceChannel.presenceState();
    canvasStore.setActiveInvestigators(Object.values(state).flat());
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({
        user_id: currentUser.id,
        display_name: currentUser.displayName,
        current_view: 'canvas',
        selected_node_id: null,
      });
    }
  });
```

---

## Section 13 — Data Migrations and Schema Evolution

### 13.1 Migration tooling: Supabase CLI + Flyway

**SaaS Blind v1 (Supabase):** Use the **Supabase CLI** for schema migrations. The CLI manages migration files in `supabase/migrations/` and applies them to the Supabase managed Postgres instance via `supabase db push`. Schema files are version-controlled in GitHub.

```
supabase/
  migrations/
    20260616000001_initial_schema.sql
    20260616000002_graph_tables.sql
    20260616000003_belief_state.sql
    20260616000004_provider_tables.sql
    20260616000005_cache_entries.sql
    20260616000006_rls_policies.sql
    20260616000007_vector_tables.sql
    20260616000008_audit_log.sql
    20260616000009_realtime_publications.sql
  seed.sql           -- test data for local development
  config.toml        -- Supabase project config
```

**On-Prem / AWS RDS (Phase 2):** Use **Flyway** (Java-free `flyway-commandline` mode) with the same SQL files renamed to Flyway's `V{timestamp}__{description}.sql` convention. The SQL is identical — only the runner changes.

**Local development:** `supabase start` spins up a full local Supabase stack (Postgres, Auth, Storage, Realtime, Edge Functions) in Docker. Developers run `supabase db reset` to apply all migrations from scratch.

### 13.2 Migration safety rules

1. **Never drop a column** without a two-migration cycle (first: `ALTER COLUMN ... DROP NOT NULL` + add deprecation comment; second after one release: `DROP COLUMN`).
2. **Never rename a column** (add new column, backfill, drop old column in three releases).
3. **RLS policies are part of schema files** — they must be reviewed in every migration that adds a table or changes access patterns.
4. **All migrations must be reversible** — every `supabase/migrations/*.sql` file has a corresponding `supabase/migrations/*_rollback.sql` that reverses it.
5. **The `belief_atoms` and `audit_log_entries` tables are never retroactively modified** — append-only is enforced by the restrictive RLS policies.

### 13.3 Protecting Reproducibility Packs during migration

Reproducibility Packs reference the `chainsight_version` field in `manifest.json`. The replay container uses the Docker image tagged with that version, which embeds the schema version of the time the pack was created. Pack replay is always forward-compatible:

- New columns added to tables used in pack generation are ignored by older replay containers (they don't know about the new column).
- The `belief-state/atoms.jsonl` export schema uses a `schema_version` field and new fields are added with default values.
- The `reproducibility_packs.manifest_json` JSONB column is never migrated retroactively.

### 13.4 Supabase to AWS RDS migration (Phase 2)

The Phase 2 migration is a **live logical replication** migration using `pg_dump` + `pg_restore` plus a cutover window:

```bash
# Phase 2 migration procedure (condensed)

# Step 1: Create AWS RDS Postgres 16 instance
# Step 2: Schema migration — apply all Supabase migrations to RDS
flyway migrate -url="jdbc:postgresql://{rds-endpoint}/chainsight"

# Step 3: Data migration — pg_dump from Supabase, pg_restore to RDS
pg_dump --no-owner --no-acl \
  "postgresql://{supabase-db-url}/postgres" \
  > chainsight_dump.sql

pg_restore -d "postgresql://{rds-endpoint}/chainsight" chainsight_dump.sql

# Step 4: Logical replication for delta sync
# (Supabase supports logical replication slots; set up AWS DMS or pglogical for delta)

# Step 5: Swap application DATABASE_URL from Supabase to RDS
# Step 6: Update auth.uid() → auth_uid() via find-and-replace in all RLS policies
# Step 7: Update storage backend from supabase_storage → aws_s3 (Section 9.7)
# Step 8: Cut over DNS / API config; verify; tear down replication slot
```

The `auth.uid()` → `current_setting('app.current_user_id')::uuid` migration (Section 5.8) is applied as a schema migration file during Step 2. Zero-downtime for the final cutover is achieved by maintaining the logical replication delta sync until the cutover second.

### 13.5 Zero-downtime migrations on Supabase

For additive changes (new tables, new nullable columns), Supabase `db push` in a maintenance window (< 30 seconds for Phase 0 schema). For Phase 2 (multiple concurrent users):

1. Deploy new API code with dual-read support for old + new schema.
2. Push migration (additive only).
3. Backfill new columns in background (BullMQ job, 1000 rows/batch).
4. Deploy API code removing old schema path.
5. Drop deprecated columns in next migration cycle.

---

## Section 14 — Backup and Disaster Recovery

### 14.1 SaaS Blind RPO/RTO with Supabase

| Store                 | RPO                 | RTO                                                     | Backup method                                                                              |
| --------------------- | ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Supabase Postgres** | 5 minutes (WAL)     | 30 minutes                                              | Supabase built-in PITR (Point-in-Time Recovery); 7-day WAL window on Pro plan              |
| **Supabase Storage**  | 0 (replication)     | 1 hour                                                  | Supabase Storage replicates within region; no cross-region in v1 (Phase 2 adds AWS S3 CRR) |
| **Redis (Upstash)**   | 1 hour (AOF export) | 5 minutes                                               | Upstash daily backups; Redis is reconstructable from Postgres                              |
| **Memgraph (Fly.io)** | 1 hour (snapshots)  | 15 min (from snapshot) / 60 min (rebuild from Postgres) | Hourly snapshots to Supabase Storage                                                       |
| **Audit log**         | 0 (dual-write)      | 1 hour                                                  | Written to both Postgres and Supabase Storage `audit-log/` simultaneously                  |

### 14.2 Supabase PITR (Point-in-Time Recovery)

Supabase Pro plan includes PITR with a 7-day WAL retention window. To restore to a specific point:

1. In the Supabase dashboard → Settings → Database → Backups.
2. Select the target timestamp.
3. Supabase creates a new Postgres instance from the WAL replay.
4. Update `DATABASE_URL` in Fly.io environment to point to the restored instance.

For per-agency restore: because case data is encrypted with per-case DEKs, restoring the full Postgres instance to a point in time gives back all agencies' rows. Agencies whose CMK is compromised can request their encrypted rows be zeroed — but since the KMS holds the CMK, and ChainSight never holds it, this is the agency's own operation.

### 14.3 Redis reconstructability

Redis (cache + BullMQ queue) is reconstructable from Supabase Postgres:

- **Cache:** On Redis loss, the `cache_entries` Postgres table is the authoritative record. The application rehydrates Redis on first access (cache miss → Postgres lookup → Redis write).
- **BullMQ queues:** In-flight jobs that haven't been acknowledged are re-submitted on worker restart. BullMQ's `removeOnFail: false` ensures failed jobs stay in the dead-letter queue (in Postgres via `pg_boss` pattern if BullMQ loses them — _[Best-guess]_ evaluate BullMQ's Redis-persistence guarantees vs. `pg_boss` as a Postgres-native queue before Phase 1 goes to production).

### 14.4 Memgraph backup procedure

```bash
# Fly.io Memgraph machine — backup script (run hourly via Fly.io cron)

SNAPSHOT_PATH="/var/lib/memgraph/snapshots/$(date +%Y%m%d%H%M%S).snapshot"
# Trigger Memgraph snapshot via Bolt
echo "CREATE SNAPSHOT;" | mgclient --host localhost --port 7687

# Upload to Supabase Storage (using supabase CLI or aws-sdk with Supabase S3 endpoint)
aws s3 cp "${SNAPSHOT_PATH}" \
  "s3://backups/memgraph/$(basename ${SNAPSHOT_PATH})" \
  --endpoint-url "${SUPABASE_STORAGE_S3_ENDPOINT}"
```

On Phase 2 (AWS): replace Supabase Storage endpoint with native S3.

### 14.5 Audit log dual-write

The `audit_log_entries` table is written to Postgres AND simultaneously streamed to Supabase Storage (`audit-log/` bucket) in compressed JSONL format:

```typescript
async function writeAuditLog(entry: AuditLogEntry) {
  // Write 1: Postgres (searchable, hash-chained)
  await serviceClient.from('audit_log_entries').insert(entry);

  // Write 2: Supabase Storage (tamper-evident archive)
  const date = new Date(entry.occurred_at);
  const path = `${entry.agency_id}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${entry.id}.json.zst`;

  const compressed = zstd.compress(JSON.stringify(entry));
  await storageBackend.upload({
    bucket: 'audit-log',
    path,
    data: compressed,
    contentType: 'application/octet-stream',
  });
}
```

On Phase 2 (AWS S3): enable S3 Object Lock in Compliance mode on the `audit-log` bucket. This ensures the archive is genuinely tamper-proof (even the S3 bucket admin cannot delete locked objects).

### 14.6 Phase 2 cross-region considerations

On migration to AWS (Phase 2):

- **Postgres:** AWS RDS with Multi-AZ deployment (synchronous replication, automatic failover, RPO ≈ 0).
- **S3:** Cross-Region Replication (source: `us-east-1`, destination: `us-west-2`) for all case-data, repro-packs, and audit-log buckets.
- **Memgraph:** EC2 with EBS volumes; snapshots to S3 with CRR.
- **Redis:** ElastiCache with Multi-AZ replication.

Phase 0 stays single-region (Supabase: `us-east-1` primary). Cross-region is a Phase 2 commitment.

---

## Section 15 — Performance Benchmarks and Capacity Planning

### 15.1 Performance targets

| Operation                                                   | Target P50 | Target P99 | Assumptions                           |
| ----------------------------------------------------------- | ---------- | ---------- | ------------------------------------- |
| Tx-by-hash lookup (from Redis cache)                        | < 5 ms     | < 20 ms    | Redis hot                             |
| Tx-by-hash lookup (Postgres cache_entries)                  | < 20 ms    | < 80 ms    | Supabase Postgres, index hit          |
| Tx-by-hash lookup (cache miss, Etherscan)                   | < 500 ms   | < 2 s      | Etherscan + normalize + write         |
| K-hop neighborhood expansion, depth 3 (Memgraph)            | < 200 ms   | < 800 ms   | Case graph < 50k nodes                |
| K-hop neighborhood expansion, depth 6 (Memgraph)            | < 500 ms   | < 3 s      | Case graph < 100k nodes               |
| K-shortest-paths, k=3, depth 10 (Memgraph)                  | < 1 s      | < 5 s      |                                       |
| Full wallet history pull (50 addresses × 3 chains, cold)    | < 5 min    | < 15 min   | All cache misses; rate limits         |
| Full wallet history pull (50 addresses × 3 chains, warm)    | < 30 s     | < 2 min    | 90% cache hit rate                    |
| Document upload (10 MB PDF) + encryption + Supabase Storage | < 4 s      | < 12 s     | libsodium + Supabase upload           |
| Document extraction (10 MB PDF, Textract)                   | < 45 s     | < 3 min    | AWS Textract async (Phase 1+)         |
| Belief atom insert (single, service role)                   | < 10 ms    | < 50 ms    | Postgres write                        |
| Belief atom court-grade batch read (1000 atoms, RLS)        | < 150 ms   | < 600 ms   | RLS adds ~20–50ms overhead vs. no-RLS |
| Reproducibility pack build (1000 atoms, 50 docs)            | < 5 min    | < 20 min   | Supabase Storage reads + DuckDB       |
| Reproducibility pack replay (same)                          | < 10 min   | < 30 min   | Isolated Docker container             |
| Vector similarity search (top-5 of 100k chunks, HNSW)       | < 20 ms    | < 100 ms   | pgvector in Supabase Postgres         |
| Supabase Realtime delivery (belief atom update to canvas)   | < 200 ms   | < 800 ms   | WebSocket through Supabase edge       |

**RLS overhead note:** Supabase RLS adds 10–50ms overhead on complex policies that call SECURITY DEFINER functions. The `user_has_case_access()` function is the most expensive policy. To mitigate:

- Cache the function result within a transaction using a local variable: `current_setting('app.case_access_cache')`.
- For batch operations, the API layer pre-verifies access once and switches to the service role for the batch.
- _[Best-guess]_ If RLS overhead exceeds 50ms on belief atom reads, switch the frontend to service-role reads with application-layer access checks (losing the DB-level safety net but recovering performance).

### 15.2 Supabase plan considerations

**Supabase Pro plan** ($25/month, December 2025 pricing) provides:

- 8 GB database storage
- 100 GB egress/month
- PITR (7-day WAL)
- Unlimited API requests
- Connection pooling (PgBouncer)

Phase 0 fits comfortably within Pro. **Supabase Team plan** ($599/month) is needed when:

- Database storage exceeds 8 GB (roughly 200+ active cases with full graph data)
- Read replicas are needed for reporting
- More aggressive connection pooling is needed

_[Best-guess]_ Expect to upgrade to Team plan around 50–100 active customers. Budget this.

### 15.3 Capacity planning math

**Phase 0 (Supabase Pro, first 10 customers, ~50 active cases):**

```
Supabase Postgres:
  belief_atoms: 50 × 500 = 25,000 rows × ~1 KB = 25 MB
  graph tables: 50 × (5k nodes + 20k edges) = 1.25M rows × ~0.5 KB = 625 MB
  cache_entries: 100k entries × 5 KB avg = 500 MB
  vector tables: deferred to Phase 1; minimal in Phase 0
  Total: ~2 GB — well within Pro 8 GB limit

Supabase Storage (chain-data Parquet):
  Investigation-scoped pulls only: ~50 GB across active cases
  Supabase Storage is billed at $0.021/GB/month → ~$1.05/month

Supabase Storage (documents):
  50 cases × 100 MB avg = 5 GB → $0.10/month

Memgraph (Fly.io performance-4x machine):
  ~$150/month including 20 GB persistent volume
  Memory: 16 GB sufficient for 100 active cases

Redis (Upstash):
  ~2 GB data → ~$40/month on Upstash Pro

Fly.io API workers:
  3 × machines.shared-cpu-2x → ~$30/month

Total estimated Phase 0 infrastructure cost: ~$275/month
```

**Phase 1 (~50 customers, ~250 active cases):**

```
Supabase Pro → Team plan: $599/month
graph tables: ~6M rows → ~3 GB
vector tables (Phase 1): ~2M chunks × 1024-dim × 4B = ~8 GB (requires Team plan)
Total Postgres: ~12 GB

Memgraph: upgrade to performance-8x (~$250/month)
Redis (Upstash): ~10 GB → ~$120/month
Fly.io workers: 5 × machines.performance-2x → ~$100/month

Total estimated Phase 1 infrastructure cost: ~$1,100/month
```

### 15.4 Bottleneck analysis

**Most likely Phase 0 bottleneck:** Supabase Postgres connection pool exhaustion under concurrent agent writes. Mitigation: BullMQ workers use a single Postgres connection (service role, dedicated pool) per worker machine. The Supabase PgBouncer pool is configured with `pool_mode = transaction` (compatible with our no-SET-LOCAL pattern).

**Second bottleneck:** Supabase Realtime delivery under high belief atom volume (aggressive trace emitting 50+ atoms/second). Mitigation: batch atom inserts (INSERT ... VALUES (1), (2), ...) in the agent worker to reduce Realtime event count; Realtime channel subscriptions debounce at 100ms.

**Third bottleneck:** pgvector HNSW index maintenance under concurrent chunk insertions. Mitigation: embeddings are generated by background Fly.io workers after document extraction, not during the upload hot path. The HNSW index is built incrementally — pgvector 0.7+ handles this efficiently.

---

## Section 16 — Phase 0 Implementation Plan (Weeks 1–8)

### 16.1 Overview

```
Dependencies:
  Week 1-2 Supabase setup + schema → Week 3-4 capability router + Fly.io workers
  → Week 5-6 Memgraph + graph builder → Week 7-8 repro pack + chain of custody
```

### 16.2 Week 1–2: Supabase Foundations

**Data tasks:**

- [ ] Create Supabase project, connect GitHub repo, enable Supabase CLI
- [ ] Write `supabase/migrations/20260616000001_tenancy.sql`: agencies, auth integration, users, supervisory_roles
- [ ] Write `supabase/migrations/20260616000002_cases.sql`: cases, case_access, case_dek_refs, iocs
- [ ] Write `supabase/migrations/20260616000003_graph.sql`: address_nodes, transaction_nodes, graph_edges
- [ ] Write `supabase/migrations/20260616000004_belief_state.sql`: belief_atoms, belief_state_current materialized view
- [ ] Write `supabase/migrations/20260616000005_audit.sql`: audit_log_entries (with restrictive RLS)
- [ ] Write `supabase/migrations/20260616000006_rls_policies.sql`: all helper functions + policies
- [ ] Implement `current_agency_id()`, `user_has_case_access()` SQL functions
- [ ] Implement `encryptField` / `decryptField` in TypeScript (libsodium-wrappers-sumo)
- [ ] Wire AWS KMS mock (LocalStack) for local dev; AWS KMS for staging
- [ ] Run `supabase start` locally, verify schema applies cleanly
- [ ] Write integration tests: RLS isolation (user A cannot read user B's data)

**Deliverable:** Full schema in Supabase, RLS policies verified by integration tests.

### 16.3 Week 3–4: Capability Router + First Ingest

**Data tasks:**

- [ ] Write `supabase/migrations/20260616000007_providers.sql`: provider_definitions, agency_provider_installs, provider_resolutions
- [ ] Write `supabase/migrations/20260616000008_cache.sql`: cache_entries (with all RLS scope policies)
- [ ] Write `supabase/migrations/20260616000009_realtime.sql`: add belief_atoms to Supabase Realtime publication
- [ ] Implement `buildCacheKey()` with unit tests
- [ ] Implement Redis cache read/write (Upstash client)
- [ ] Implement Postgres cache fallback
- [ ] Wire Etherscan V2 connector: `get_tx_by_hash` for Ethereum
- [ ] Implement `CanonicalTransaction` normalization for EVM chains
- [ ] Implement `IngestJob` BullMQ worker on Fly.io (the 8-step flow from Section 1.4)
- [ ] Configure Supabase Storage buckets: chain-data, repro-packs, audit-log, backups, documents
- [ ] Test: paste ETH tx hash → canonical transaction row in Supabase Postgres + Redis cache entry

**Deliverable:** `router.resolve("get_tx_by_hash", args)` works end-to-end with cache, RLS protects reads.

### 16.4 Week 5–6: Memgraph + Graph Builder

**Data tasks:**

- [ ] Deploy Memgraph on Fly.io with persistent volume; apply index creation Cypher
- [ ] Implement `GraphBuilderWorker` (Fly.io worker): reads Postgres graph tables, writes to Memgraph
- [ ] Implement AddressNode and TransactionNode upsert in Memgraph
- [ ] Implement INPUT_TO / OUTPUT_TO / BRIDGE_TO edge creation
- [ ] Test: ingest one ETH tx → verify address + transaction nodes + edges in Memgraph
- [ ] Test: 3-hop neighborhood expansion Cypher returns correct subgraph
- [ ] Write Memgraph hourly snapshot → Supabase Storage pipeline
- [ ] Implement graph eviction for cases inactive > 30 days

**Deliverable:** Pasted tx hash materializes as transaction-centric subgraph in Memgraph, queryable from the API.

### 16.5 Week 7–8: Reproducibility Pack + Chain of Custody

**Data tasks:**

- [ ] Write `supabase/migrations/20260616000010_documents.sql`: case_documents, extracted_entities
- [ ] Write `supabase/migrations/20260616000011_coc.sql`: chain_of_custody_records (with restrictive RLS for no-update)
- [ ] Write `supabase/migrations/20260616000012_reports.sql`: reports, reproducibility_packs
- [ ] Implement `SupabaseStorageBackend` (Section 9.2)
- [ ] Implement `ReproPackBuilder` with Supabase Storage upload for the `.tar.gz`
- [ ] Implement `ChainOfCustodyService` with hash chain computation
- [ ] Implement audit log dual-write (Postgres + Supabase Storage)
- [ ] Implement `replay.sh` template generator
- [ ] Test: create case → paste tx hash → build Reproducibility Pack → verify hash → run replay.sh in Docker → identical output
- [ ] Test: CoC record hash chain validates from first event to last

**Deliverable:** Phase 0 end-to-end demo: tx hash → graph → Repro Pack → replay verified.

### 16.6 Parallel tasks (throughout)

- [ ] **Week 2:** Write local `supabase/seed.sql` with test agency, users, 1 case (one investigator, one admin)
- [ ] **Week 3:** Implement DuckDB cold store access (Section 2.6) for Python math service on Fly.io
- [ ] **Week 4:** Implement chain reorg detection in ingest worker (Section 1.6)
- [ ] **Week 5:** Write `supabase/migrations/20260616000013_vectors.sql` (vector tables, HNSW indexes)
- [ ] **Week 6:** Implement cache TTL sweep worker (Fly.io cron)
- [ ] **Week 7:** Add Supabase Realtime subscription in frontend for live belief atom updates
- [ ] **Week 8:** Write rollback migrations for all Phase 0 files

---

## Section 17 — Open Questions

These are specific decisions requiring founder input, ranked by urgency.

### Q-DE-1 — Supabase plan tier timing (BLOCKING for cost planning)

Supabase Pro ($25/month) supports 8 GB database storage. At Phase 0 scale (~50 cases), this is fine. However, pgvector HNSW indexes are memory-intensive — a 1M-row embedding table with 1024-dim vectors uses ~5 GB of Postgres storage alone.

**Decision needed:** When is the right moment to upgrade to Supabase Team ($599/month)? At 50 customers? At first enterprise prospect?

**My recommendation:** Budget for Team plan from the first paying customer. Pro is dev/pilot only. The Team plan's read replicas and larger connection pool are needed before the first real case workload.

### Q-DE-2 — Upstash vs. Fly.io Redis (non-blocking for Week 1, needed by Week 3)

**Upstash:** Serverless, per-request pricing, no idle cost, excellent for Phase 0 (< 1M operations/day). HTTP and Redis protocol APIs. Downside: higher latency than a co-located Redis instance (~2–5ms from Fly.io vs. ~0.1ms co-located).

**Fly.io Redis:** Persistent machine, low latency, fixed cost (~$10–30/month). Better for cache performance. Requires more ops overhead.

**Decision needed:** Upstash for pure serverless Phase 0, or Fly.io Redis from day one?

**My recommendation:** Upstash for Phase 0 (zero ops, cheap). Migrate to Fly.io Redis at Phase 1 when cache hit latency matters for the investigator UX (cache reads on the hot path must be < 5ms).

### Q-DE-3 — KMS provider for Phase 0 (BLOCKING for Week 1)

AWS KMS (accessible from Fly.io via standard SDK, ~$1/month per key). The encryption code is provider-agnostic.

**Decision needed:** LocalStack mock for local dev + AWS KMS for staging/production? Or AWS KMS from day one everywhere?

**My recommendation:** LocalStack in local Docker dev (`supabase start` + LocalStack compose), AWS KMS for staging and production. AWS KMS cost is negligible.

### Q-DE-4 — Supabase Realtime column filtering for belief_atoms (non-blocking for Phase 0)

Supabase Realtime can be configured to send only specific columns in change events (reducing payload size for encrypted tables). The `belief_atoms.object_enc` column (BYTEA, up to 64 KB) should not be replicated to the frontend.

**Decision needed:** Configure Supabase Realtime column filtering via `supabase_realtime` publication options, or filter in the frontend subscription callback?

**My recommendation:** Filter in the frontend subscription. Supabase Realtime's column filtering is a newer feature; filtering in the frontend is more robust and easier to update.

### Q-DE-5 — BullMQ vs. pg_boss for job queue (non-blocking for Phase 0)

**BullMQ (Redis-backed):** Fast, well-documented, straightforward for a solo developer. Requires Redis. Jobs are lost if Redis is lost without AOF.

**pg_boss (Postgres-backed):** Jobs stored in Postgres (Supabase). Zero additional infrastructure. Slower than Redis-backed queues but sufficient for the batch ingest workload. Postgres PITR means jobs survive infrastructure loss.

**Decision needed:** BullMQ on Upstash/Fly.io Redis, or pg_boss on Supabase Postgres?

**My recommendation:** **pg_boss** for Phase 0. Running everything on Supabase Postgres reduces the number of moving parts for a solo developer. The ingest workload is not latency-sensitive enough to require Redis queue performance. BullMQ is the right call when the queue volume exceeds pg_boss's comfortable range (> 10k jobs/minute) — likely Phase 3+.

### Q-DE-6 — Reproducibility Pack PII redaction (non-blocking, compliance question)

The pack's `belief-state/atoms.jsonl` must be readable by opposing counsel in a D'Aloia-style audit. Belief atoms may contain PII (attribution labels, investigator notes).

**Decision needed:** Two pack variants (sealed/open) or leave redaction to counsel?

**My recommendation:** Two variants. The sealed pack is the internal working document (encrypted `object_enc` fields included). The open pack is produced by a redaction step that replaces `object_enc` for PII-tagged atoms with `[REDACTED - available under protective order]`. This is a Phase 2 feature; Phase 0 ships sealed packs only.

### Q-DE-7 — Cold storage write for Phase 0 (non-blocking, Phase 1 question)

Currently designed as per-tx ingest + daily DuckDB compaction to properly-sized Parquet files. Supabase Storage does not support native lifecycle rules (Section 2.7).

**Decision needed:** Per-tx ingest + manual compaction worker, or buffer in Postgres and write Parquet only in daily batches?

**My recommendation:** Per-tx → daily compaction. The compaction job is simple (DuckDB `SELECT * ... ORDER BY block_timestamp → write Parquet`). Phase 0 volume is low enough that the file-count overhead is negligible.

### Q-DE-8 — Supabase Edge Functions for lightweight API (non-blocking, worth considering)

Supabase Edge Functions (Deno-based, deployed to Supabase's edge network) can handle lightweight API calls (auth webhooks, provider health checks, simple cache lookups) with sub-50ms cold starts from the same Supabase project, without a Fly.io round-trip.

**Decision needed:** Use Supabase Edge Functions for specific hot paths (e.g., cache key lookup, deconfliction check), or keep all API logic on Fly.io for simplicity?

**My recommendation:** All logic on Fly.io for Phase 0. Mixing Edge Functions and Fly.io API adds deployment complexity for a solo developer. Re-evaluate in Phase 2 if specific endpoints show high latency due to Supabase-to-Fly.io round-trips.

---

## Appendix A — Environment Configuration Reference

```bash
# Supabase (SaaS Blind)
SUPABASE_URL=https://{project-ref}.supabase.co
SUPABASE_ANON_KEY=eyJ...             # public key, safe for browser
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # private key, Fly.io only — NEVER in browser
SUPABASE_DB_URL=postgresql://postgres:{password}@{project-ref}.supabase.co:5432/postgres
SUPABASE_STORAGE_S3_ENDPOINT=https://{project-ref}.supabase.co/storage/v1/s3
SUPABASE_S3_ACCESS_KEY=...
SUPABASE_S3_SECRET_KEY=...
SUPABASE_S3_REGION=us-east-1

# Redis (Upstash Phase 0 / Fly.io Phase 1+)
REDIS_URL=rediss://...@...upstash.io:6379    # Upstash
# REDIS_URL=redis://chainsight-redis.internal:6379  # Fly.io internal

# Memgraph (Fly.io)
MEMGRAPH_HOST=chainsight-memgraph.internal    # Fly.io private network
MEMGRAPH_PORT=7687

# AWS KMS
KMS_PROVIDER=aws_kms
KMS_AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# KMS_LOCALSTACK_ENDPOINT=http://localhost:4566  # local dev only

# Encryption
ENCRYPTION_ALGORITHM=xchacha20poly1305
DEK_CACHE_TTL_SECONDS=300

# Job queue (pg_boss on Supabase Postgres)
PGBOSS_DB_URL=${SUPABASE_DB_URL}

# Cold storage (Supabase Storage in SaaS Blind)
COLD_STORAGE_BACKEND=supabase_storage
COLD_STORAGE_BUCKET=chain-data

# On-Prem overrides
# COLD_STORAGE_BACKEND=minio
# MINIO_ENDPOINT=http://minio.internal:9000
# MINIO_ACCESS_KEY=...
# MINIO_SECRET_KEY=...
```

---

## Appendix B — Locked Decision Cross-Reference

| Decision ID                                 | Where applied in this document                                             |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| **G10** (transaction-centric graph)         | Section 3 (Memgraph edges), Section 4.4 (graph tables + CHECK constraint)  |
| **F23** (cache layer)                       | Section 7 entirely, Section 4.7 (cache_entries RLS)                        |
| **F24** (UTXO clustering)                   | Section 10 entirely, Section 4.10                                          |
| **F25** (personal attribution)              | Section 4.11 (RLS with private/org/shared policies)                        |
| **F29** (chain of custody)                  | Section 4.8, Section 9.6, Section 14.5 (dual-write)                        |
| **B1** (Belief State)                       | Section 6 entirely, Section 4.5 (append-only RLS), Section 12.1 (Realtime) |
| **B2** (tiered determinism)                 | Section 1 (tier labels on CanonicalTransaction), Section 6 (tier field)    |
| **B3** (Reproducibility Pack)               | Section 8 entirely                                                         |
| **B8** (encryption)                         | Section 4.13, Section 9.4                                                  |
| **v0.3 BYOK**                               | Section 1 (capability router), Section 4.6 (provider tables + RLS)         |
| **v0.5 F2** (document storage)              | Section 9 entirely                                                         |
| **G1** (court-grade requires human signoff) | Section 6.5                                                                |
| **G5** (path immutability)                  | Section 4.9 (trace_paths status constraint)                                |
| **G22** (envelope encryption as v1 floor)   | Section 4.13                                                               |
| **Supabase stack**                          | Sections 1, 2, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15, 16                       |

---

## Appendix C — Supabase RLS Quick Reference

All tables with RLS enabled and the primary policy type:

| Table                      | Isolation level                              | Primary policy                                 |
| -------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `users`                    | User-self + admin-agency                     | `id = auth.uid()` or same agency admin         |
| `cases`                    | Agency-scoped + restricted                   | `agency_id = current_agency_id()`              |
| `case_access`              | Agency-scoped                                | Case in same agency                            |
| `iocs`                     | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `address_nodes`            | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `transaction_nodes`        | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `graph_edges`              | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `belief_atoms`             | Case-scoped read; service_role write         | `user_has_case_access(case_id)`                |
| `provider_definitions`     | Public read                                  | `auth.uid() IS NOT NULL`                       |
| `agency_provider_installs` | Agency-scoped                                | `agency_id = current_agency_id()`              |
| `cache_entries`            | Scope-specific (4 policies)                  | See Section 7.4                                |
| `case_documents`           | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `chain_of_custody_records` | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `utxo_clusters`            | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `personal_attributions`    | User-owned + sharing tiers                   | `attributor_id = auth.uid()` (private)         |
| `audit_log_entries`        | Admin/supervisor read; restrictive no-delete | `agency_id = current_agency_id()` + role check |
| `document_embeddings`      | Case-scoped                                  | `user_has_case_access(case_id)`                |
| `case_dek_refs`            | Service role only                            | No SELECT policy for authenticated users       |

---

_This document is one of eight discipline outputs for ChainSight v1.0. It incorporates the confirmed Supabase + Fly.io + GitHub stack for SaaS Blind v1, with On-Prem unchanged and a documented Phase 2 migration path to AWS RDS + S3 + EKS._

_Document version: 1.1.0 | Updated: 2026-06-16 | Supabase stack update incorporated._
