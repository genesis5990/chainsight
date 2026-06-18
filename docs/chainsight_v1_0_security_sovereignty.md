# ChainSight v1.0 — Security, Sovereignty & Cryptography Design

> **Audience:** Solo developer + AI agents building ChainSight v1.0. This is the authoritative security and sovereignty reference. Consult it before writing any code path that touches keys, credentials, audit events, chain of custody, or access control.
>
> **Build posture:** SaaS Blind first (Supabase + Fly.io + GitHub); On-Prem Sovereign as fast-follow (HashiCorp Vault + self-hosted stack). Both architecturally compatible from day one.
>
> **Stack (SaaS Blind v1):** Supabase (Postgres, pgvector, Auth, Storage, Realtime) · Fly.io (application hosting) · GitHub (source, CI/CD, releases) · AWS KMS (agency-controlled CMKs for envelope encryption)
>
> **The non-negotiable:** The vendor is never a counterparty to the investigation. Architecturally blind. Every privacy guarantee is enforceable by the agency through technical controls they own — not by policy they trust.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Encryption Hierarchy](#2-encryption-hierarchy)
3. [KMS and HSM Integration](#3-kms-and-hsm-integration)
4. [The Blind Guarantees in Detail](#4-the-blind-guarantees-in-detail)
5. [Audited Support Access Workflow](#5-audited-support-access-workflow)
6. [Authentication and Authorization](#6-authentication-and-authorization)
7. [Audit Log Architecture](#7-audit-log-architecture)
8. [Chain of Custody Implementation](#8-chain-of-custody-implementation)
9. [Reproducibility Pack Hashing Scheme](#9-reproducibility-pack-hashing-scheme)
10. [Sigstore-Backed Verifiable Builds](#10-sigstore-backed-verifiable-builds)
11. [BYOK Credential Storage Flow](#11-byok-credential-storage-flow)
12. [Network Security Posture](#12-network-security-posture)
13. [Secrets Management](#13-secrets-management)
14. [Sovereign Deployment Hardening](#14-sovereign-deployment-hardening)
15. [Anti-Feature Enforcement](#15-anti-feature-enforcement)
16. [Incident Response](#16-incident-response)
17. [Compliance Hooks](#17-compliance-hooks)
18. [Phase 0 Implementation Plan](#18-phase-0-implementation-plan)
19. [Open Questions](#19-open-questions)

---

## 1. Threat Model

This section names every adversary category explicitly. Vague threat models produce vague defenses.

### 1.1 Infrastructure Provider Landscape (SaaS Blind v1)

The SaaS Blind v1 deployment runs across three infrastructure providers plus AWS KMS. Each is a distinct trust boundary:

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ChainSight SaaS Blind v1                         │
│                                                                      │
│  ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────┐   │
│  │   Fly.io        │   │   Supabase       │   │   GitHub         │   │
│  │                 │   │                  │   │                  │   │
│  │  Application    │   │  Postgres +      │   │  Source code     │   │
│  │  servers        │   │  pgvector +      │   │  CI/CD pipelines │   │
│  │  (Fastify API,  │   │  Auth +          │   │  Release         │   │
│  │  BullMQ         │   │  Storage +       │   │  artifacts       │   │
│  │  workers)       │   │  Realtime        │   │  (Sigstore-      │   │
│  │                 │   │                  │   │  signed)         │   │
│  │  Sees: request  │   │  Sees:           │   │                  │   │
│  │  traffic,       │   │  CIPHERTEXT      │   │  No case data    │   │
│  │  decrypted data │   │  ONLY (by        │   │  ever in repo    │   │
│  │  in memory      │   │  design —        │   │                  │   │
│  │  during request │   │  see §2)         │   │                  │   │
│  └─────────────────┘   └─────────────────┘   └──────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │   AWS KMS (in the agency's own AWS account)                   │   │
│  │                                                               │   │
│  │   Agency Customer Master Key — held exclusively by agency     │   │
│  │   ChainSight application can GenerateDataKey + Decrypt        │   │
│  │   under a grant the agency controls and can revoke instantly  │   │
│  │                                                               │   │
│  │   AWS sees: KMS API calls (no plaintext content)             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**The layered defense principle:** No single infrastructure provider's compromise should expose case data in plaintext. Supabase holds ciphertext. Fly.io holds plaintext only ephemerally in application memory during request processing. GitHub holds code with no secrets. AWS KMS holds the agency's root key but cannot read case data (it only wraps/unwraps DEKs). Case data is only readable by someone who simultaneously controls the agency's KMS key *and* has access to the ciphertext. Those two controls live in different organizations with different threat profiles.

### 1.2 Primary Adversary: Vendor-as-Adversary (the ChainSight team)

The design must hold even if the entire ChainSight organization is assumed adversarial or fully compromised. This is the governing assumption for SaaS Blind architecture.

**What a fully-compromised ChainSight team could access:**

| Layer | Accessible to ChainSight | Defense |
|---|---|---|
| Fly.io app server admin | Application process memory during active requests | Plaintext exists only ephemerally in-memory; not logged, not serialized; closes fully in Phase 3 with confidential computing (G22) |
| Supabase service key (bypasses RLS) | All rows in all tables | Application-layer envelope encryption: all sensitive columns are ciphertext before INSERT; even with Supabase service key, ChainSight sees only encrypted blobs |
| Supabase Storage | All uploaded objects | Objects encrypted with case DEK before upload; Supabase Storage sees only ciphertext |
| GitHub repo access | Source code, CI config, GitHub Actions secrets | No case data in repo; no production secrets in repo; Fly secrets separate; Vault for production |
| AWS billing / usage data | API call counts to KMS | Only metadata (how many decrypt calls); no content |

### 1.3 Supabase as Compelled Adversary

Supabase the company could be legally compelled to produce database contents by a court order, law enforcement request, or national security letter in their jurisdiction (US).

**This is structurally identical to ChainSight hosting Postgres on AWS RDS.** The defense is identical: application-layer encryption with agency-held keys means Supabase produces ciphertext that has no value without the agency's AWS KMS CMK.

**What Supabase would produce if compelled:**
- Schema structure (table names, column names)
- Ciphertext blobs in `encrypted_payload` columns
- Unencrypted metadata that ChainSight deliberately puts in plaintext (status fields, timestamps, agency_id for routing — see §2.3 for the explicit plaintext/ciphertext boundary)
- Auth records (email addresses of investigators — a real privacy consideration; see §1.8 for mitigation)

**What Supabase cannot produce (without the agency's KMS key):**
- IOC values, addresses, tx hashes
- Attribution content, belief atom content, report text
- Document content
- Investigator notes, memos, marks, annotations
- Path descriptions or findings
- Any BYOK provider credential values

**Honest marketing statement on this threat:** "ChainSight's SaaS Blind deployment stores your case data encrypted with keys you control in your own AWS account. Supabase, our database provider, sees only encrypted data — just as any database administrator would see if we hosted Postgres ourselves. The encryption is designed so that Supabase (or anyone who compels them) cannot read your case content. The remaining metadata they hold is documented explicitly in §4.2."

### 1.4 Fly.io as Compelled Adversary

Fly.io hosts the application servers. A compelled Fly.io would produce:
- Container images (the application code — same as what's on GitHub)
- Fly Secrets (application secrets — not agency KMS keys, which live in AWS; not BYOK credentials, which are encrypted in Supabase)
- Memory snapshots of running processes — this is the **real exposure window**

**Memory exposure window:** During an active HTTP request, the Fly.io application process briefly holds plaintext case data (the decrypted payload after receiving a case DEK from KMS). This is the same gap that exists on any IaaS host, including AWS EC2. It is the honest v1 limitation. At v1, the mitigation is:
- Plaintext exists only for the duration of a request handler (~50-200ms)
- No logging of plaintext content
- No swap file on application servers (`--no-swap` in Fly config)
- Process isolation: no shared memory between tenant request handlers
- Memory is GC'd after handler scope exit

This gap closes in Phase 3 with confidential computing (Fly Machines with Intel TDX, or migrating to AWS Nitro Enclaves).

### 1.5 GitHub as Compelled Adversary

GitHub hosts source code and CI/CD pipelines. A compelled GitHub would produce:
- The source code (which is openly published or at minimum visible to ChainSight)
- GitHub Actions run logs
- GitHub Actions secrets scoped to the `chainsight-io/chainsight` repository

**Critical property:** GitHub Actions secrets **never** contain agency KMS keys or BYOK credentials. They contain only ChainSight infrastructure credentials (Docker registry push tokens, Fly deploy tokens). Agency keys live in AWS KMS, never in GitHub.

**Mitigations:**
- Secret scanning enabled — GitHub scans all commits for credential patterns
- Branch protection: signed commits required on `main`; no direct push without PR + review
- OIDC-based deployment: GitHub Actions uses OIDC tokens to authenticate to Fly.io, not long-lived secrets
- Sigstore-signed releases (§10) — the release artifact integrity is verifiable even if GitHub's distribution is compromised

### 1.6 Vendor-as-Adversary in SaaS Blind: Complete Access Matrix

| Component | ChainSight sees | Supabase sees | Fly.io sees | AWS KMS sees | Agency sees |
|---|---|---|---|---|---|
| Case name / codename | Ciphertext | Ciphertext | Ephemeral plaintext in memory | KMS API calls (no content) | Plaintext |
| IOC values | Ciphertext | Ciphertext | Ephemeral | API calls | Plaintext |
| Belief atoms | Ciphertext | Ciphertext | Ephemeral | API calls | Plaintext |
| BYOK API keys | Ciphertext | Ciphertext | Ephemeral | API calls | Plaintext |
| Investigator email | Supabase Auth record | Auth record | N/A | N/A | Plaintext |
| Seat count (billing) | Plaintext | Plaintext | Plaintext | N/A | Plaintext |
| Table schema | Plaintext | Plaintext | Plaintext | N/A | N/A |
| Service health metrics | Plaintext | DB metrics | Fly metrics | N/A | Opt-in |
| KMS API call count | Via CloudTrail grant | N/A | N/A | Plaintext | Via CloudTrail |

### 1.7 Compromised Provider Keys (BYOK Credentials)

A threat actor who gains read access to the Supabase database reads `credential_blob` columns. These are ciphertext encrypted under per-tenant DEKs wrapped under the agency's KMS CMK. Without the CMK, the blobs are valueless. The attack surface for actually obtaining the plaintext credential is:

1. Compromise the agency's AWS KMS CMK (requires AWS account compromise or KMS grant abuse)
2. AND obtain the ciphertext blob from Supabase

Two separate organizations must be compromised simultaneously. This is the belt-and-suspenders property.

### 1.8 Investigator Identity in Supabase Auth

**The real gap:** Supabase Auth stores investigator email addresses in cleartext as part of its auth user records. This means Supabase (and a compelled Supabase) can see that `investigator@agency.gov` has an account in ChainSight. This does not reveal case data, but it does reveal *which investigators use the platform* — potentially sensitive for undercover or intelligence operations.

**v1 mitigation:**
- Agencies that have this sensitivity concern are routed to On-Prem immediately (On-Prem uses no Supabase)
- For SaaS Blind, document this explicitly in the MSA and data processing agreement
- Consider: agency-assigned pseudonymous login IDs for highly sensitive investigator accounts (not real email addresses)

**Phase 2 mitigation:** Migration to self-hosted Ory Kratos (§6.1) eliminates the Supabase Auth dependency entirely for auth user records. At that point, investigator auth records live on agency-controlled infrastructure in On-Prem, and on ChainSight-owned infrastructure in SaaS Blind (but not Supabase).

### 1.9 Insider Threat at the Agency

An investigator, administrator, or IT staff member at the agency with legitimate access credentials could exfiltrate case data. The platform's security posture for insider threats is detection, attribution, and forensic support — not prevention (which is impossible without destroying usability).

**Defenses:**
- Full hash-chained audit trail: every read, write, export, print, and share is logged with actor identity, timestamp, and content reference
- Chain of custody: every artifact access generates a custody event (F29, §8)
- RBAC + case-scoped ABAC: investigators see only assigned cases
- Export controls: bulk exports require supervisor approval (F27) in sensitive configurations
- WebAuthn for high-impact actions: hardware key required for freeze, seizure, court-grade signoff (§6.2)
- Session binding: re-authentication required after idle period and for high-impact actions

### 1.10 Court-Ordered Disclosure (Targeted at ChainSight Vendor)

**Structural defense:** The vendor cannot comply with an order for case data because the vendor cannot decrypt it. Supabase holds ciphertext. Fly.io holds ephemeral process memory. The decryption keys are held by the agency in their own AWS account.

**Vendor response:** "We do not hold the decryption keys for case content. All case data in our database is encrypted with keys controlled exclusively by the customer agency in their own AWS KMS account. We are unable to produce plaintext case data. The decryption capability resides with the agency." (Pre-drafted response reviewed by outside counsel per F43.)

**For orders seeking Supabase data:** ChainSight would need to be the party in receipt of such an order. They produce: table schema, ciphertext rows, auth user records. They cannot produce case content plaintext. If the order is served directly on Supabase, Supabase would produce the same.

### 1.11 Hostile Acquirer

A hostile acquirer of ChainSight inherits the same architecture: they hold Supabase ciphertext; agencies hold KMS keys. The acquirer cannot read case data. Source-code escrow and perpetual on-prem license (F44) provide the customer exit ramp.

### 1.12 Air-Gapped Exfiltration (On-Prem Sovereign)

See §14 for the full on-prem air-gapped hardening section. On-Prem deployments do not use Supabase, Fly.io, or GitHub in any capacity.

### 1.13 Threat Model Summary

| Threat | Primary defense | Secondary defense | v1 honest gap |
|---|---|---|---|
| ChainSight as adversary | Supabase holds ciphertext; no plaintext in DB | Audited support access; agency-revocable | Ephemeral in-memory plaintext on Fly.io |
| Supabase as compelled adversary | App-layer encryption before INSERT | RLS (belt) | Investigator email in Supabase Auth |
| Fly.io as compelled adversary | Ephemeral in-memory only; no logging | No swap; process isolation | Memory snapshot during active request |
| GitHub as compelled adversary | No case data in repo; no agency keys in CI | Sigstore-signed releases | Build log metadata |
| AWS compelled (KMS) | KMS holds only wrapped DEKs; no content | CloudTrail visible to agency | Agency must trust AWS KMS |
| Insider at agency | Audit log; CoC; RBAC | WebAuthn for high-impact actions | Authorized over-sharing |
| Court order to vendor | Vendor has only ciphertext | MSA pre-drafted response | Auth metadata in Supabase |
| Hostile acquirer | Source escrow; encryption unchanged | Perpetual on-prem license | Acquisition notification timing |
| Supply chain | Sigstore-signed releases; secret scanning | Branch protection; signed commits | Zero-day in dependencies |

---

## 2. Encryption Hierarchy

### 2.1 Key Hierarchy Overview

The encryption hierarchy is identical for SaaS Blind and On-Prem above the persistence layer. What changes is where the root key lives (AWS KMS vs. HashiCorp Vault) and where the ciphertext is stored (Supabase vs. agency Postgres).

```
Agency KMS Root Key (Customer Master Key)
│  SaaS Blind: AWS KMS CMK in the agency's own AWS account.
│  On-Prem: HashiCorp Vault transit key on agency infrastructure.
│  Never leaves the KMS in plaintext. ChainSight cannot access without
│  an agency-controlled grant.
│
├── Per-Tenant Data Encryption Key (Tenant DEK)
│   Generated on tenant creation. 32 bytes, AES-256-equivalent.
│   Encrypted ("wrapped") under the Agency KMS Root Key.
│   Stored as ciphertext in the AgencyEncryptionConfig row in Supabase.
│   To use: KMS Decrypt call → plaintext Tenant DEK in Fly.io app memory → use → zero.
│
│   ├── Per-Case Data Encryption Key (Case DEK)
│   │   Generated on case creation. 32 bytes.
│   │   Wrapped under the Tenant DEK.
│   │   Stored in the Case row's encryption_config_json in Supabase Postgres.
│   │   To use: unwrap Tenant DEK from KMS → decrypt Case DEK → use → zero both.
│   │
│   │   ├── Row-level encryption for all case-bearing Postgres tables
│   │   │   encrypted_payload BYTEA columns contain libsodium ciphertext.
│   │   │   Supabase sees only the BYTEA blobs. Never plaintext.
│   │   │
│   │   ├── Supabase Storage object encryption
│   │   │   CaseDocuments, ReproducibilityPack blobs, evidence files.
│   │   │   Encrypted with the Case DEK BEFORE upload to Supabase Storage.
│   │   │   Supabase Storage API receives only ciphertext byte streams.
│   │   │
│   │   └── Per-Document DEK (for large evidence artifacts)
│   │       Generated per CaseDocument. Wrapped under Case DEK.
│   │       Stored in CaseDocument.encryption_ref in Supabase.
│   │       Decrypted only during document read/display; zeroed after.
│   │
│   └── Credential DEK (per AgencyProviderInstall)
│       One per BYOK credential. 32 bytes.
│       Wrapped under the Tenant DEK.
│       Stored in AgencyProviderInstall.credential_blob in Supabase.
│       Decrypted only during capability router calls. Never logged.
│
└── Audit Log Chain Key
    Separate HMAC key for hash-chaining audit log entries.
    Wrapped under Agency KMS Root Key.
    Used only to compute prior_hash and this_hash in AuditLogEntry.
    Supabase stores only the HMAC outputs (hashes), not the key.
```

### 2.2 Cryptographic Primitives

All application-layer encryption uses **libsodium** (`sodium-native` for Node.js; `PyNaCl` for Python math service). A `CryptoService` abstraction layer wraps all primitives so Phase 3 can swap to OpenSSL FIPS without business-logic changes (see Q-SEC-7 in §19).

| Use case | Primitive | Key size | Notes |
|---|---|---|---|
| Symmetric encryption (DEK-encrypted payloads) | `crypto_secretbox_xsalsa20poly1305` | 32 bytes | Authenticated encryption. 24-byte random nonce prepended to ciphertext output. |
| Key derivation (child DEK from parent + context) | `crypto_kdf_hkdf_sha256` | Variable → 32 bytes | RFC 5869 HKDF-SHA256. Context string = `agency_id + purpose` to prevent cross-context key reuse. |
| Content addressing | `crypto_generichash_blake2b` | output: 32 bytes | BLAKE2b-256. Used for all content hashes: Reproducibility Pack files, CoC chain links, Merkle roots. |
| Audit log HMAC chaining | `crypto_auth_hmacsha256` | 32 bytes | HMAC-SHA256 per entry. |
| Nonce generation | `randombytes_buf` | 24 bytes | libsodium CSPRNG. New nonce per plaintext. Never reused. |
| Investigator signing (manifests, declarations) | `crypto_sign_ed25519` | 64-byte keypair | Ed25519. Private key in agency KMS or hardware key. Public key published. |

**KMS operations (key wrapping / unwrapping):**
- AWS KMS: `GenerateDataKey`, `Decrypt` API calls — plaintext DEK returned to app process memory only; key material never crosses the Supabase trust boundary
- HashiCorp Vault: `transit/datakey/plaintext` and `transit/decrypt` endpoints — same semantics

### 2.3 The Plaintext / Ciphertext Boundary in Supabase

The most important design decision in the schema is the explicit boundary between what Supabase can see (plaintext) and what it cannot (ciphertext). This boundary is non-negotiable and must be enforced in code review.

**Columns Supabase sees in plaintext (acceptable metadata):**

| Column | Table | Why plaintext | Privacy exposure |
|---|---|---|---|
| `id` | All tables | Routing / FK references | Random UUID — no content |
| `agency_id` | All tables | Multi-tenancy routing | Reveals agency has an account |
| `created_at`, `updated_at` | All tables | Time-based queries | Reveals activity timing |
| `status` | `cases`, `belief_atoms`, etc. | State-machine queries | Reveals workflow state; not content |
| `tier` | `belief_atoms` | Confidence tier queries | T0/T1/T2/T3 — no content |
| `seq` | `audit_log_entries` | Monotonic ordering | Audit sequence number |
| `prior_hash`, `this_hash` | `audit_log_entries`, `coc_records` | Tamper-evidence | HMAC outputs — no content |
| `s3_object_key` | `audit_log_entries`, `case_documents` | Storage routing | Random UUIDs |
| `key_version` | All encrypted tables | Rotation tracking | Integer; no content |

**Columns that are always ciphertext (encrypted_payload BYTEA pattern):**

| Table | What lives in encrypted_payload |
|---|---|
| `belief_atoms` | subject_ref, predicate, object, provenance_json, derivation_json, signoff_id |
| `cases` | codename, narrative, classification, all content fields |
| `iocs` | value (address, tx hash, entity name) |
| `case_documents` | filename, document_type metadata |
| `trace_paths` | name, ordered_steps_json, all path content |
| `wallets` | name, addresses, analysis content |
| `reports` | draft_md, all report content |
| `personal_attributions` | label, category, description |
| `agency_provider_installs` | credential_blob (the BYOK API key, double-encrypted: Credential DEK + Tenant DEK) |
| `cache_entries` | response_payload |
| `agent_calls` | inputs_hash, outputs_hash (hashes of content, not content itself — still encrypted) |

**The rule:** If a column contains investigation content, it is ciphertext. If a column contains only operational metadata needed for routing, filtering, or integrity checking, it may be plaintext. This rule is enforced via a code review checklist item on every new Supabase migration.

### 2.4 Supabase Row-Level Security (Belt) on Top of Encryption (Suspenders)

RLS is a defense-in-depth layer. It protects against application bugs that might return wrong-tenant data. It does NOT replace encryption — it is layered on top.

**RLS policies for all case-bearing tables:**

```sql
-- Enable RLS on every case-bearing table
ALTER TABLE belief_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE iocs ENABLE ROW LEVEL SECURITY;
-- ... (all case-bearing tables)

-- Policy: app can only read rows for the authenticated agency
CREATE POLICY "agency_isolation" ON belief_atoms
  FOR ALL
  USING (agency_id = auth.jwt() -> 'agency_id');

-- Policy: audit log is append-only for the app role
CREATE POLICY "audit_append_only" ON audit_log_entries
  FOR INSERT
  WITH CHECK (agency_id = auth.jwt() -> 'agency_id');
-- No UPDATE or DELETE policy — those operations are blocked entirely

-- Policy: service role (used by ChainSight app with Supabase service key)
-- can read/write, but still only returns rows matching the request context
-- Note: even with the service key, a ChainSight engineer cannot read the
-- encrypted_payload — they see only ciphertext.
```

**What RLS does:** Prevents an application-level bug (wrong WHERE clause, JWT parsing error) from leaking row data across agency boundaries. Supabase's service key bypasses RLS, which is why encryption is the primary control — service key access still returns ciphertext.

**What RLS does NOT do:** Protect against Supabase infrastructure access, SQL injection that escalates to the service key, or the database being compelled to produce its data. Those are encryption's job.

### 2.5 Supabase Storage Encryption

Supabase Storage provides object storage (S3-compatible). For all case artifacts (CaseDocuments, ReproducibilityPack blobs, evidence files), encryption happens **before** the bytes are sent to Supabase Storage:

```typescript
// BEFORE upload: encrypt the document with its Document DEK
async function uploadCaseDocument(
  caseId: string,
  agencyId: string,
  filename: string,
  plaintext: Buffer
): Promise<StorageRef> {
  const caseDEK = await getCaseDEK(caseId, agencyId); // from KMS + Supabase
  
  try {
    // Generate per-document DEK for large files (wrapped under Case DEK)
    const docDEK = sodium.randombytes_buf(32);
    try {
      const encryptedContent = cryptoService.encrypt(plaintext, docDEK);
      const wrappedDocDEK = cryptoService.encrypt(docDEK, caseDEK);
      
      // The object key in Supabase Storage is a random UUID — no content in the key
      const objectKey = `${agencyId}/${caseId}/${randomUUID()}`;
      
      // Upload ONLY ciphertext to Supabase Storage
      // Supabase Storage sees: a UUID key + opaque bytes
      await supabaseStorage
        .from("case-documents")
        .upload(objectKey, encryptedContent.buffer, {
          contentType: "application/octet-stream",
          // Supabase's own server-side encryption is ALSO applied (SSE-S3)
          // Belt and suspenders: even if SSE were somehow bypassed, the payload is our ciphertext
        });
      
      // Store the wrapped doc DEK and object key in Postgres (also encrypted via case DEK)
      const docRef = await db.createCaseDocumentRecord({
        case_id: caseId,
        agency_id: agencyId,
        storage_key: objectKey,                    // plaintext: random UUID
        wrapped_doc_dek: wrappedDocDEK.toString("base64"),  // stored encrypted_payload
        content_hash: blake2b256(plaintext).toString("hex"), // hash of original plaintext
      });
      
      return docRef;
    } finally {
      sodium.memzero(docDEK);
    }
  } finally {
    sodium.memzero(caseDEK);
  }
}
```

Supabase Storage's own server-side encryption is in addition to our application-layer encryption — belt and suspenders. Supabase encrypts a ciphertext. Even if their SSE were bypassed, an adversary has our ciphertext, not plaintext.

### 2.6 Encrypted Postgres Column Schema

Full pattern for every case-bearing table:

```sql
-- Example: belief_atoms (canonical pattern for all case-bearing tables)
CREATE TABLE belief_atoms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID NOT NULL,              -- plaintext: multi-tenancy routing
  case_id         UUID NOT NULL,              -- plaintext: FK + case-scoped queries
  created_at      TIMESTAMPTZ DEFAULT now(),  -- plaintext: time-based filtering
  status          TEXT NOT NULL DEFAULT 'asserted',  -- plaintext: state-machine queries
  tier            TEXT NOT NULL,              -- plaintext: T0|T1|T2|T3 for confidence queries

  -- Everything sensitive: ciphertext
  encrypted_payload  BYTEA NOT NULL,          -- libsodium secretbox ciphertext
  nonce              BYTEA NOT NULL,          -- 24-byte random nonce
  key_version        INTEGER NOT NULL DEFAULT 1,  -- for rotation tracking

  -- Tamper-evident hash chain (no content exposed)
  prior_event_hash   BYTEA,                   -- BLAKE2b-256 of prior atom's content_hash
  content_hash       BYTEA NOT NULL,          -- BLAKE2b-256 of encrypted_payload (not plaintext)

  CONSTRAINT fk_case FOREIGN KEY (case_id) REFERENCES cases(id)
);

-- RLS (belt on top of encryption suspenders)
ALTER TABLE belief_atoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_iso" ON belief_atoms FOR ALL
  USING (agency_id = (auth.jwt()->>'agency_id')::uuid);

-- Application role: INSERT + SELECT + UPDATE only
-- No DELETE (belief atoms are immutable; retraction is additive)
GRANT SELECT, INSERT, UPDATE ON belief_atoms TO chainsight_app;
```

**The encrypted_payload serialization:**

```typescript
// Serialize to MessagePack (compact, deterministic) → encrypt
interface BeliefAtomPayload {
  subject_type: string;
  subject_ref: string;       // e.g., "eth:0xabc123..."
  predicate: string;         // e.g., "is_controlled_by"
  object: unknown;           // the attributed entity, finding, etc.
  confidence: number;
  provenance_json: ProviderResolutionRef[];
  derivation_json: ReasoningStep[];
  signoff_id: string | null;
  superseded_by: string | null;
  retracted_by: string | null;
  created_by: string;        // investigator ID
}

function encryptBeliefAtomPayload(
  payload: BeliefAtomPayload,
  caseDEK: Buffer
): { encrypted_payload: Buffer; nonce: Buffer } {
  const plaintext = msgpack.encode(payload);
  const nonce = Buffer.from(sodium.randombytes_buf(24));
  const encrypted_payload = Buffer.alloc(plaintext.length + sodium.crypto_secretbox_MACBYTES);
  sodium.crypto_secretbox_easy(encrypted_payload, plaintext, nonce, caseDEK);
  return { encrypted_payload, nonce };
}
```

### 2.7 Key Rotation Strategy

**Scheduled rotation:**
- Agency KMS Root Key: annual (AWS KMS automatic rotation; key ID unchanged, new key material)
- Tenant DEK: 90 days (automated job)
- Case DEKs: not rotated on schedule (they live as long as the case; rotated on-demand if Case DEK believed compromised)
- BYOK Credential DEKs: rotate with the Tenant DEK

**Rotation process for Tenant DEK (simplified):**

```typescript
async function rotateTenantDEK(agencyId: string): Promise<void> {
  // 1. Generate new Tenant DEK (KMS creates new plaintext DEK + wraps it under CMK)
  const { plaintextDEK: newDEKPlaintext, ciphertextDEK: newDEKCiphertext } =
    await kms.generateDataKey(agencyId);

  try {
    // 2. Re-wrap all Case DEKs under the new Tenant DEK
    // (We do NOT re-encrypt case content — just the envelope)
    const cases = await supabase.from("cases").select("id, encryption_config_json")
      .eq("agency_id", agencyId);

    for (const c of cases.data!) {
      const oldCaseDEK = await decryptCaseDEK(c.encryption_config_json, agencyId);
      try {
        const newWrappedCaseDEK = cryptoService.encrypt(oldCaseDEK, newDEKPlaintext);
        await supabase.from("cases").update({
          encryption_config_json: { ...c.encryption_config_json,
            wrapped_case_dek: newWrappedCaseDEK.toString("base64"),
            key_version: c.encryption_config_json.key_version + 1
          }
        }).eq("id", c.id);
      } finally {
        sodium.memzero(oldCaseDEK);
      }
    }

    // 3. Re-wrap all Credential DEKs
    const installs = await supabase.from("agency_provider_installs")
      .select("id, credential_blob").eq("agency_id", agencyId);

    for (const install of installs.data!) {
      // Re-wrap credential DEK under new Tenant DEK
      await rewrapCredentialDEK(install, agencyId, newDEKPlaintext);
    }

    // 4. Store new Tenant DEK ciphertext
    await supabase.from("agency_encryption_config").update({
      wrapped_tenant_dek: newDEKCiphertext.toString("base64"),
      key_version: sql`key_version + 1`,
      rotated_at: new Date().toISOString()
    }).eq("agency_id", agencyId);

    await appendAuditEntry({ actor: "system:key-rotation", action: "key.tenant_dek_rotated",
      target_ref: `agency:${agencyId}`, ts: new Date() });

  } finally {
    sodium.memzero(newDEKPlaintext);
  }
}
```

**What does and does NOT get re-encrypted on rotation:** Only the envelope (wrapped DEKs) changes. The `encrypted_payload` columns in case tables remain encrypted under the same Case DEK ciphertext — but that Case DEK ciphertext is now wrapped under the new Tenant DEK. This is correct: rotating the envelope key is cryptographically sufficient. Full re-encryption of case content would be enormously expensive and is only warranted if the Case DEK itself is believed compromised (§16.1).

### 2.8 Cryptographic Separation Between Agencies

Agency A's data can never be decrypted with Agency B's keys, by construction:
- Each agency has its own CMK in its own AWS account (or on its own Vault)
- Each Tenant DEK is wrapped under that agency's CMK
- Each Case DEK is wrapped under that agency's Tenant DEK
- The `EncryptionContext` on every KMS call includes `{"agency_id": "<tenant_id>"}` — KMS enforces this; Agency B's credentials cannot decrypt Agency A's DEKs even at the KMS layer
- RLS enforces `agency_id` isolation at the Supabase query layer (belt on top of the suspenders)

---

## 3. KMS and HSM Integration

### 3.1 AWS KMS for SaaS Blind v1

**CMK provisioning — what the agency does:**

1. Agency creates (or uses) an AWS account
2. Agency creates a symmetric CMK (AES-256) in AWS KMS:
   - Key type: `SYMMETRIC_DEFAULT` (AES-256-GCM)
   - Key usage: `ENCRYPT_DECRYPT`
   - Enable automatic key rotation (annual)
3. Agency configures the key policy to allow ChainSight's Fly.io application IAM role to call `GenerateDataKey` and `Decrypt`, but only with the matching encryption context
4. Agency provides the CMK ARN to ChainSight during the sovereign onboarding wizard

**KMS key policy (minimum viable for blind guarantees):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AgencyFullControl",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::AGENCY_ACCOUNT:root"},
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "ChainSightOperationalGrant",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::CHAINSIGHT_ACCOUNT:role/fly-chainsight-app"},
      "Action": [
        "kms:GenerateDataKey",
        "kms:GenerateDataKeyWithoutPlaintext",
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:agency_id": "AGENCY_TENANT_ID"
        }
      }
    },
    {
      "Sid": "ExplicitlyDenyChainSightAdmin",
      "Effect": "Deny",
      "Principal": {"AWS": "arn:aws:iam::CHAINSIGHT_ACCOUNT:root"},
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "*"
    }
  ]
}
```

**The encryption context constraint is the cryptographic enforcement.** Every `kms:Decrypt` call from ChainSight's Fly.io application must include `{"agency_id": "<tenant_id>"}`. If a ChainSight engineer tried to decrypt Agency A's wrapped DEK while claiming to be Agency B, the KMS call fails — enforced by AWS, not by application code.

**CloudTrail — agency-owned audit of KMS access:**

All KMS API calls are logged in the agency's CloudTrail in the agency's AWS account. The agency has an independent, vendor-inaccessible audit trail of every time ChainSight touched their root key: timestamp, operation, principal identity, encryption context. This is the agency's technical means of verifying the "no unauthorized access" guarantee.

**The Fly.io → AWS KMS connection:**

Fly.io application servers need IAM credentials to call AWS KMS. Options:

1. **IAM User with long-lived access key** — simple but bad practice; long-lived credentials stored in Fly secrets
2. **IAM Role with OIDC federation** (preferred for Phase 1+) — Fly.io machines use workload identity federation with AWS; short-lived credentials; no long-lived secrets
3. **Phase 0 pragmatic approach** — IAM user with access key stored in Fly secrets; rotate quarterly; migrate to OIDC in Phase 1

The access key (whatever form) gives ChainSight's application the ability to call KMS. It does NOT give access to case data — the data is ciphertext in Supabase. The key only allows DEK wrap/unwrap operations, and only with the matching encryption context.

**v2: Customer-provided KMS in SaaS Blind**

Some agencies will have existing AWS accounts and want to provide their own CMK ARN. The v1 onboarding wizard already supports this (agency enters ARN; ChainSight stores it in the tenants config; all KMS calls use that ARN). Extensions in v2:
- AWS KMS External Key Store (XKS): agency's CMK backed by their own on-prem HSM, while still running SaaS Blind
- Azure Key Vault: for agencies locked into Azure (same pattern, different API)
- Google Cloud KMS: same

### 3.2 HashiCorp Vault for On-Prem

On-Prem Sovereign deployments use HashiCorp Vault as the KMS. The agency installs and operates Vault on their own infrastructure; no ChainSight connectivity required.

**Vault Transit Engine configuration:**

```hcl
# Enable the transit secrets engine
path "sys/mounts/transit" {
  capabilities = ["create", "update"]
}

# Create the agency master key (AES-256-GCM96)
vault write transit/keys/chainsight-master-key \
  type=aes256-gcm96 \
  derived=true \
  convergent_encryption=false

# ChainSight application AppRole policy
path "transit/datakey/plaintext/chainsight-master-key" {
  capabilities = ["update"]
  allowed_parameters = {
    "context" = []  # Enforce context parameter for key derivation
  }
}
path "transit/decrypt/chainsight-master-key" {
  capabilities = ["update"]
}
```

**Generate a DEK via Vault (equivalent to AWS KMS GenerateDataKey):**

```typescript
async function generateDEKViaVault(context: KeyContext): Promise<{
  plaintextDEK: Buffer;
  wrappedDEK: string;
}> {
  const contextB64 = Buffer.from(JSON.stringify(context)).toString("base64");

  const resp = await vault.write(
    "transit/datakey/plaintext/chainsight-master-key",
    { bits: 256, context: contextB64 }
  );

  return {
    plaintextDEK: Buffer.from(resp.data.plaintext, "base64"),
    wrappedDEK: resp.data.ciphertext,  // stored in Postgres / local DB
  };
}
// Always: sodium.memzero(plaintextDEK) after use
```

**Vault HA and availability:**
- Deploy 3-node Vault HA cluster with Raft storage (no Consul dependency)
- Auto-unseal via AWS KMS or local HSM (avoids manual unseal ceremony)
- ChainSight fails-safe on Vault unavailability: encryption operations fail with a clear error; no silent degradation or key caching

**On-Prem database:** For On-Prem, Supabase is replaced by a self-hosted Postgres + pgvector instance (Docker Compose or Kubernetes). The schema is identical; RLS still applies. The encrypted_payload columns contain the same libsodium ciphertext — only the underlying storage changes.

### 3.3 HSM Backing for Classified Deployments

For Agency tier and Classified tier customers requiring FIPS 140-2 Level 3 backing:

- **SaaS Blind + HSM:** AWS KMS with CloudHSM (agency runs CloudHSM cluster in their own AWS account; KMS uses CloudHSM as the key store — transparent to ChainSight)
- **On-Prem + HSM:** HashiCorp Vault with PKCS#11 seal provider pointing to a Thales Luna Network HSM 7 or Entrust nShield Connect XC

ChainSight's code does not change for either option. The KMS/Vault client interface is the same; the HSM is an underlying implementation detail of the key store.

---

## 4. The Blind Guarantees in Detail

### 4.1 The Trust Stack: Three Providers + One Agency KMS

The SaaS Blind v1 trust model is explicit: there are four parties who could theoretically access your data, and this is what each can and cannot see:

**ChainSight (the vendor):**
- Can see: service health metrics, billing counters, table schema, ciphertext in Supabase
- Cannot see: any case content, investigator notes, IOC values, provider credentials in plaintext
- Why: all sensitive content is encrypted with agency-held keys before it reaches Supabase

**Supabase:**
- Can see: table schema, metadata columns in plaintext (IDs, timestamps, status fields), ciphertext blobs, investigator email addresses in Auth
- Cannot see: investigation content (ciphertext), BYOK credentials (ciphertext)
- Why: application-layer encryption before INSERT; Supabase never receives plaintext case content

**Fly.io:**
- Can see: application code, request/response traffic at the application layer, ephemeral process memory during request handling (~50-200ms)
- Cannot see: persistent plaintext; case data survives Fly.io access only as ciphertext in Supabase
- Why: no plaintext written to disk; no logging of case content; process isolation

**AWS KMS (in the agency's account):**
- Can see: API call metadata (who called, when, with what context), usage statistics
- Cannot see: case content, the plaintext of the CMK itself (HSM-protected), DEK content beyond the API call that produces it
- Why: KMS is an HSM-backed service; the CMK never leaves the HSM in plaintext; DEK plaintext is returned to the calling application only

**The only party that can read plaintext case data:** The agency itself — because they hold the CMK that wraps all DEKs. Even then, reading encrypted Supabase rows requires both the CMK (in AWS) and the ciphertext (in Supabase). Revoking the agency-granted KMS access instantly prevents ChainSight's application from decrypting anything, without ChainSight being able to re-grant it.

### 4.2 What Each Provider Observably Has (Complete Inventory)

**Supabase observably holds:**

| Data | Form | Location |
|---|---|---|
| Investigator accounts | Plaintext email addresses | Supabase Auth `auth.users` table |
| Table schema | Plaintext DDL | Supabase metadata |
| Row counts per table per agency | Plaintext integer | Supabase metrics |
| Timestamps on all rows | Plaintext datetime | All tables |
| Case status values | Plaintext enum values | `cases.status` |
| Belief atom tier values | Plaintext T0/T1/T2/T3 | `belief_atoms.tier` |
| Audit log sequence numbers | Plaintext integers | `audit_log_entries.seq` |
| HMAC chain hashes | Plaintext HMAC-SHA256 digests | `audit_log_entries.prior_hash`, `this_hash` |
| All content fields | Ciphertext BYTEA | `encrypted_payload` columns |
| BYOK credentials | Ciphertext BYTEA | `agency_provider_installs.credential_blob` |
| Storage objects | Ciphertext byte streams | Supabase Storage |

**Supabase does NOT hold:**
- Case names, codenames, or IOC values
- Addresses, transaction hashes, entity names
- Investigation findings, attribution content, report text
- Any BYOK credential plaintext
- KMS keys or DEK plaintexts

**Fly.io observably holds:**
- Container images (application code — same as GitHub)
- Fly application secrets (ChainSight infrastructure credentials — NOT agency keys)
- Application logs (stripped of case content per logging policy)
- Process memory (ephemeral, not persisted, contains plaintext during request handling)

### 4.3 Minimizing the Supabase Plaintext Exposure Surface

Beyond the mandatory operational metadata, there are additional measures to reduce what Supabase observes:

**Investigator identity obfuscation (optional, for sensitive deployments):**

Agencies can configure pseudonymous login IDs for high-sensitivity investigators. Instead of `detective.jones@agency.gov` in Supabase Auth, the account appears as a random UUID-based email `<uuid>@investigators.chainsight.internal`. The mapping from UUID to real identity lives only in agency-controlled records.

**Query pattern opacity:**

Supabase can observe which rows are queried (at the PostgreSQL statement level if pg_stat_statements is enabled). To reduce query pattern leakage for highly sensitive operations:

- Address lookups for deconfliction use a BLAKE2b-256 hash with a per-agency secret (HMAC-based keyed hash) before the query. Supabase sees the hashed value, not the address.
- Full-text search over case content: tokenized and hashed client-side before the query; Supabase sees hashed token indices (OPE-style), not plaintext terms.
- This is consistent with the v0.7 design for encrypted indexes.

**Acknowledged remaining leakage (documented):**
- Activity timing: request rates reveal when agencies are actively working
- Volume: row counts reveal case load (at aggregate level)
- Case count per agency: number of active cases is observable from row counts
- Investigator identity: email addresses in Supabase Auth (mitigated by pseudonymous IDs for sensitive cases)

These are acknowledged in the MSA and Data Processing Agreement (DPA) as the irreducible minimum of metadata observable by Supabase when used as the database provider.

### 4.4 Confidential Computing Roadmap (Phase 3 — per G22)

The v1 floor (envelope encryption + application-layer crypto + audited support access) is the honest starting point. Phase 3 closes the Fly.io in-memory plaintext gap:

**Target architecture (Phase 3, SaaS Blind):**

```
┌────────────────────────────────────────────────────────────┐
│  Fly.io Machine with Intel TDX / AMD SEV-SNP enabled       │
│  (or: migrate hot-path to AWS Nitro Enclaves)              │
│                                                            │
│  ChainSight Application Code                               │
│  ├── Receives encrypted request                            │
│  ├── Attests to agency: PCR measurements published         │
│  ├── Agency verifies attestation ↔ Sigstore build hash     │
│  ├── Agency KMS policy: release DEK only if PCR matches    │
│  ├── Processes request in plaintext inside secure enclave  │
│  ├── Returns encrypted response                            │
│  └── Plaintext never escapes the enclave boundary          │
└────────────────────────────────────────────────────────────┘
```

The Sigstore-signed release hash (§10) becomes the PCR measurement the agency's KMS policy validates. If Fly.io or ChainSight modifies the running code, PCR measurements change, KMS rejects the decrypt request, and no plaintext is produced. This closes the last observable gap.

**Phase 3 prerequisite check:** Fly.io as of mid-2026 does not yet offer Intel TDX or AMD SEV-SNP as generally available Fly Machine features. The Phase 3 decision point is: (a) wait for Fly.io TEE support, (b) migrate the hot-path to AWS EC2 with Nitro Enclaves, or (c) use a specialized confidential computing provider. This is an open architecture decision to be confirmed at Phase 2 exit. (See Q-SEC-8 in §19.)

### 4.5 The v1 Technical Floor (Honest Summary)

At v1 SaaS Blind launch:

| Control | Status | Who it stops |
|---|---|---|
| Application-layer encryption (libsodium) before Supabase | ✅ Phase 0 | Supabase compelled disclosure; ChainSight DB admin |
| Per-agency KMS root key in agency's AWS account | ✅ Phase 0 | ChainSight accessing data without agency KMS grant |
| Agency KMS grant revocability | ✅ Phase 0 | Instant cut-off of ChainSight decryption capability |
| Supabase RLS for cross-tenant isolation | ✅ Phase 0 | Application bugs leaking data across agencies |
| No case content in logs or telemetry | ✅ Phase 0 | Passive observation of application logs |
| Audited support access (agency-granted tokens) | ✅ Phase 1 | Unauthorized ChainSight support access |
| Agency CloudTrail for all KMS calls | ✅ Phase 0 | Silent key misuse by ChainSight |
| Secrets in Fly secrets (not in code or Supabase) | ✅ Phase 0 | GitHub repository compromise |

| Gap | Expected close | Note |
|---|---|---|
| Ephemeral in-memory plaintext on Fly.io | Phase 3 | Confidential computing; same gap as any IaaS host |
| Investigator email in Supabase Auth | Phase 2 | Migration to self-hosted auth; pseudonymous IDs interim |
| Query pattern leakage | Partially Phase 0; fully Phase 3 | Hashed indexes for sensitive queries; full opacity needs enclaves |
| Supabase Auth metadata | Phase 2 | Auth migration eliminates Supabase Auth entirely |

---

## 5. Audited Support Access Workflow

### 5.1 Design Principles

No support access to any case content — in Supabase or in the Fly.io application — without:
- An explicit agency-initiated grant with defined scope
- A hard time limit the agency sets (no extension without a new grant)
- Real-time agency-visible logging: every action the vendor takes appears in the agency's own audit trail as the vendor takes it
- Instant revocation: one click terminates the session; the next API call from a revoked token returns 401

**The critical constraint:** Even with a maximum-scope support token, a ChainSight support engineer cannot read case content. The support token grants operational access (health metrics, job queue state, schema queries). It does not and cannot grant the agency's AWS KMS DEK — that remains exclusively in the agency's control. To share case content with support for debugging, the agency must explicitly export and share it themselves.

### 5.2 Support Access Grant Lifecycle

```
1. AGENCY OPENS SUPPORT TICKET
   Describes the issue. Does not need to share case data.

2. VENDOR REQUESTS SCOPED ACCESS
   Support engineer specifies in the system:
   - Capabilities requested (see §5.3 scope table)
   - Requested duration (max 4 hours standard; max 24 hours escalated)
   - Justification text (permanently logged; agency-visible)
   The request appears in the agency admin console.

3. AGENCY REVIEWS AND GRANTS (OR DENIES)
   Agency admin reviews in admin console.
   Can: grant as-requested, reduce scope, reduce duration, deny.
   On "Grant": system issues a signed SupportAccessToken.

4. VENDOR ACTS UNDER THE TOKEN
   Every API call under the token is:
   - Checked against the token's scope at the middleware layer
   - Logged IMMEDIATELY to the agency's audit_log_entries table
     (action: "support.action_performed", actor: "support:{engineer_id}")
   The agency admin sees the live log feed in real time.

5. TOKEN EXPIRES OR IS REVOKED
   Hard expiry: no extension possible.
   Instant revocation: agency clicks "Revoke" → token invalidated in Redis;
   next call from that token returns 401.
   A new grant is required for any continued access.
```

### 5.3 Scope Table

| Scope | Allows | Does NOT allow |
|---|---|---|
| `health_read` | Service health metrics (latency, error rates, resource) | Any case data |
| `config_read` | Tenant config (feature flags, provider install metadata) | Case content |
| `log_read` | Sanitized application error logs (no case content) | Case content, audit log |
| `db_schema_read` | Table schema, row counts per table | Row contents |
| `job_queue_read` | BullMQ queue state (job types, durations, failures) | Job payloads (which are case content) |
| `case_metadata_read` | Case status counts, workflow state | Case content, IOC values |
| `case_content_read` | **NOT OFFERED** — requires agency to decrypt + share manually | — |
| `supabase_admin` | **NOT OFFERED** — ChainSight support cannot access Supabase service key via this mechanism | — |

**Why `case_content_read` does not exist:** Granting it would require the agency to also grant KMS decryption access to the support engineer — an action completely outside ChainSight's token system. The agency would need to explicitly add a new KMS grant in their AWS account. This is the structural enforcement: decryption requires the agency's KMS, which is the agency's choice alone.

### 5.4 Token Implementation

```typescript
interface SupportAccessToken {
  token_id: string;
  agency_id: string;
  granted_by: string;           // agency admin user ID
  granted_at: Date;
  expires_at: Date;             // hard expiry; max 24h
  revoked_at: Date | null;
  scopes: SupportScope[];
  support_engineer_id: string;
  justification: string;        // permanently logged
  
  // Signed with the agency's audit HMAC key
  // → agency can independently verify token wasn't forged
  signature: string;
}

// Middleware: validate every request under a support token
const supportTokenMiddleware: FastifyMiddleware = async (req, reply) => {
  const rawToken = req.headers["x-support-token"] as string | undefined;
  if (!rawToken) return;

  const token = await resolveAndValidateSupportToken(rawToken);

  if (!token || token.revoked_at || token.expires_at < new Date()) {
    throw new ForbiddenError("Invalid, revoked, or expired support token");
  }

  const requiredScope = ENDPOINT_SCOPE_MAP[req.routerPath]?.[req.method];
  if (!requiredScope || !token.scopes.includes(requiredScope)) {
    // Log denied attempt
    await appendAuditEntry({
      actor: `support:${token.support_engineer_id}`,
      action: "support.action_denied",
      target_ref: req.url,
      ts: new Date(),
      metadata_json: { reason: "insufficient_scope", required: requiredScope }
    });
    throw new ForbiddenError("Insufficient scope");
  }

  // Log every accepted action in real time to the agency's audit trail
  await appendAuditEntry({
    actor: `support:${token.support_engineer_id}`,
    action: "support.action_performed",
    target_ref: req.url,
    ts: new Date(),
    metadata_json: { scope_used: requiredScope, token_id: token.token_id }
  });

  req.supportToken = token;
};
```

---

## 6. Authentication and Authorization

### 6.1 Supabase Auth for SaaS Blind v1

**Supabase Auth** replaces Clerk for v1 SaaS Blind. The decision drivers:
- The founder already uses Supabase; Supabase Auth is natively integrated with Supabase Postgres (JWT claims, RLS policies using `auth.jwt()`)
- Reduces external dependencies in the v1 stack
- MFA support: TOTP (authenticator app) and WebAuthn (FIDO2/passkey) are both supported in Supabase Auth

**Supabase Auth provides:**
- Email/password authentication with bcrypt password hashing
- TOTP MFA (`supabase.auth.enrollMFA()`, `supabase.auth.verifyMFA()`)
- WebAuthn/passkey support (available in Supabase Auth v2)
- JWT issuance with custom claims
- Row-Level Security integration: `auth.jwt()` available in RLS policies
- Session management (access token 1h TTL + refresh token rotation)

**Injecting agency_id into the JWT (custom claims via Supabase Auth hook):**

```sql
-- Supabase Auth "JWT Claims Hook" (called on every token issue)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  user_agency_id uuid;
  user_role text;
BEGIN
  claims := event->'claims';
  
  -- Look up the user's agency and role
  SELECT agency_id, role INTO user_agency_id, user_role
  FROM public.investigators
  WHERE id = (event->>'user_id')::uuid;
  
  -- Add to JWT claims
  claims := jsonb_set(claims, '{agency_id}', to_jsonb(user_agency_id));
  claims := jsonb_set(claims, '{role}', to_jsonb(user_role));
  
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant the hook execute permission
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
```

**JWT validation in the Fastify backend (provider-agnostic):**

```typescript
// The JWT validates against Supabase's public JWKS endpoint.
// When auth migrates to Ory Kratos, only the JWKS URL changes — no business logic changes.
const jwtValidator = createJWTValidator({
  jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  algorithms: ["RS256"],
  audience: process.env.SUPABASE_PROJECT_REF,
  issuer: `${process.env.SUPABASE_URL}/auth/v1`,
});

const authMiddleware: FastifyMiddleware = async (req, reply) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) throw new UnauthorizedError("No token");

  const payload = await jwtValidator.verify(token) as ChainSightJWT;

  // Enforce MFA verification for all case-data-accessing endpoints
  if (REQUIRES_MFA_ENDPOINTS.has(req.routerPath)) {
    if (!payload.aal || payload.aal < "aal1") {  // Supabase AAL (Authenticator Assurance Level)
      throw new MFARequired("MFA required");
    }
  }

  req.user = payload;
};
```

**Migration path to self-hosted auth (Phase 2, required before On-Prem ships broadly):**

Supabase Auth is a SaaS product — it cannot run on the customer's infrastructure for On-Prem sovereign deployments. The migration plan:

1. Wrap all auth calls behind an `AuthService` interface from day one
2. Current implementation: `SupabaseAuthService` (calls Supabase Auth APIs)
3. Phase 2 replacement: `KratosAuthService` (calls self-hosted Ory Kratos)
4. The `AuthService` interface methods: `signIn()`, `signOut()`, `enrollMFA()`, `verifyMFA()`, `createUser()`, `getUserById()`, `validateJWT()`
5. On-Prem installer ships with Ory Kratos as the auth provider from day one
6. SaaS Blind migrates to self-hosted Kratos in Phase 2 (coincides with the AWS migration for SOC 2 readiness)

### 6.2 MFA Enforcement

**TOTP required for all accounts:** No investigator account can access case data without enrolling TOTP MFA. New accounts are in a "MFA pending" state; all endpoints except `/auth/mfa/enroll` return 403 until MFA is enrolled.

**Supabase MFA enrollment flow:**

```typescript
// Agency admin triggers MFA enrollment for a new investigator
const { data: enrollment } = await supabase.auth.mfa.enroll({ factorType: "totp" });
// Returns: { id: "factor_id", totp: { qr_code: "data:image/svg...", secret: "BASE32..." } }
// Display QR code to investigator; they scan with authenticator app

// After investigator enters the TOTP code:
const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
const { data: verify } = await supabase.auth.mfa.verify({
  factorId: enrollment.id,
  challengeId: challenge.id,
  code: investigatorEnteredCode
});
// On success: Supabase session is at AAL2 (MFA-verified)
```

**WebAuthn / FIDO2 hardware keys for high-impact actions:**

The following actions require a hardware key authentication challenge even after TOTP login:

| Action | Rationale |
|---|---|
| Submit a freeze request | Irreversible real-world action |
| Sign off a seizure recommendation | Irreversible real-world action |
| Promote BeliefAtom to court-grade | Signature on an evidentiary claim |
| Export a Reproducibility Pack | Evidence custody event; mass data movement |
| Grant support access to vendor | Security control activation |
| Revoke support access | Security control activation |
| Initiate key rotation | Cryptographic operation with broad impact |
| Bulk export or case transfer | Mass data movement |

**WebAuthn challenge implementation:**

```typescript
// Generate a context-bound WebAuthn challenge
async function generateHighImpactChallenge(
  userId: string,
  actionType: HighImpactAction,
  targetResourceId: string
): Promise<WebAuthnChallenge> {
  const challenge = crypto.randomBytes(32);
  // The challenge includes the action context so a passkey signature for
  // "freeze case A" cannot be replayed as "freeze case B"
  const contextHash = sha256(`${actionType}:${targetResourceId}:${userId}:${Date.now()}`);

  await redis.setex(`webauthn:challenge:${userId}`, 60,
    JSON.stringify({ challenge: challenge.toString("base64"), contextHash }));

  return {
    challenge: challenge.toString("base64"),
    contextHash,                    // displayed to investigator to confirm what they're signing
    rpId: process.env.RELYING_PARTY_ID,
    userVerification: "required",   // biometric or PIN always required
    timeout: 60000,
  };
}
```

**Supabase Auth WebAuthn note:** Supabase Auth v2 supports WebAuthn/passkeys. For the high-impact action flow described above, we implement a custom WebAuthn challenge layer on top of the Supabase session — the investigator has already authenticated (TOTP satisfies session auth), and the WebAuthn challenge is an additional action-level proof-of-presence, not a session-level re-auth. This is compatible with the `AuthService` abstraction and survives the Kratos migration.

### 6.3 Role-Based Access Control (RBAC)

Four base roles, enforced via JWT claims + Supabase RLS:

| Role | Capabilities |
|---|---|
| `investigator` | Create/read/update own cases; read shared cases; trace, attribute, draft reports; initiate freeze (pending supervisor approval per F27) |
| `supervisor` | All investigator capabilities; supervisor dashboard (F27); approve freeze/seizure/declaration; reassign cases; view all cases in span of control |
| `admin` | All supervisor capabilities; user management; KMS key management; BYOK provider management; support access grants; billing |
| `read_only` | Read cases they are explicitly added to; no writes; for outside counsel, oversight, compliance auditors |

### 6.4 Attribute-Based Access Control (ABAC) for Cases

RBAC governs base capabilities. ABAC governs per-case access:

```typescript
interface CasePermission {
  role: "owner" | "collaborator" | "observer" | "reviewer";
  can_export: boolean;
  can_add_collaborators: boolean;
  expiry: Date | null;  // for time-limited access (outside counsel, etc.)
}
```

Enforced at the application layer (case_id + user ABAC check before any case DEK unwrap) and at the Supabase RLS layer (agency_id on every query). Both must pass; either can block access.

### 6.5 Supervisory Permissions (F27)

```typescript
type SupervisoryPermission =
  | "view_active_cases"
  | "view_caseload_metrics"
  | "approve_freeze"
  | "approve_seizure"
  | "approve_expert_declaration"
  | "reassign_case"
  | "close_case"
  | "audit_actions";
```

Middleware validates both the JWT role (`supervisor` or `admin`) and the specific `SupervisoryPermission` required for each endpoint, and that the target case is within the supervisor's configured span of control.

---

## 7. Audit Log Architecture

### 7.1 Design Goals

The audit log is:
1. **Append-only in Supabase:** PostgreSQL RLS + role separation prevents modifications
2. **Tamper-evident:** HMAC-SHA256 hash chain links every entry to the prior
3. **Agency-owned:** Agency has direct Supabase read access to their own audit entries; the hash chain is verifiable independently
4. **Mirrored:** Asynchronous copy to S3-compatible storage with Object Lock
5. **Supabase-opaque in content:** The audit log records *what happened* (action type, actor, resource ID) but no investigation content; Supabase can see the audit trail structure but not case data

### 7.2 Hash-Chained Audit Log Schema

```sql
CREATE TABLE audit_log_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id     UUID NOT NULL,       -- plaintext: for RLS + CloudWatch routing
  seq           BIGSERIAL NOT NULL,  -- monotonic sequence per tenant
  
  -- Event content (plaintext: audit log must be independently verifiable)
  actor         TEXT NOT NULL,       -- "user:{user_id}" | "system:{svc}" | "support:{id}"
  action        TEXT NOT NULL,       -- action type (see §7.6 taxonomy)
  target_ref    TEXT NOT NULL,       -- resource identifier (no case content)
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json JSONB,               -- action-specific metadata (no case content in values)
  
  -- Hash chain (tamper-evidence)
  prior_hash    BYTEA NOT NULL,      -- HMAC-SHA256 of prior entry's canonical form
  this_hash     BYTEA NOT NULL,      -- HMAC-SHA256 of (seq ‖ actor ‖ action ‖ target_ref ‖ ts ‖ prior_hash)
  
  -- S3 mirror reference
  s3_object_key TEXT,
  s3_etag       TEXT,
  
  -- Optional public-chain anchor (G2)
  anchor_batch_id UUID,
  anchor_tx_hash  TEXT
);

-- Unique sequence per agency (gap detection = tamper indicator)
CREATE UNIQUE INDEX audit_log_seq_unique ON audit_log_entries (agency_id, seq);

-- RLS: each agency sees only their own entries
ALTER TABLE audit_log_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_audit_iso" ON audit_log_entries FOR SELECT
  USING (agency_id = (auth.jwt()->>'agency_id')::uuid);

-- Application role: INSERT only (no UPDATE, no DELETE)
GRANT INSERT, SELECT ON audit_log_entries TO chainsight_app;
REVOKE UPDATE, DELETE ON audit_log_entries FROM chainsight_app;

-- Supabase service key: also SELECT only on this table (even service key cannot DELETE)
-- Enforced at RLS + object-level grant level
```

**Hash chain pseudocode:**

```typescript
async function appendAuditEntry(entry: AuditEntryInput): Promise<void> {
  const agencyHMACKey = await getAgencyAuditHMACKey(entry.agency_id); // from KMS

  const { data: prior } = await supabase
    .from("audit_log_entries")
    .select("this_hash, seq")
    .eq("agency_id", entry.agency_id)
    .order("seq", { ascending: false })
    .limit(1)
    .single();

  const priorHash = prior
    ? Buffer.from(prior.this_hash as string, "hex")
    : hmacSHA256(agencyHMACKey, Buffer.from(`GENESIS:${entry.agency_id}`));

  const nextSeq = prior ? (prior.seq as number) + 1 : 1;

  const content = Buffer.concat([
    Buffer.from(String(nextSeq)),
    Buffer.from(entry.actor),
    Buffer.from(entry.action),
    Buffer.from(entry.target_ref),
    Buffer.from(entry.ts.toISOString()),
    priorHash,
  ]);
  const thisHash = hmacSHA256(agencyHMACKey, content);

  await supabase.from("audit_log_entries").insert({
    agency_id: entry.agency_id,
    seq: nextSeq,
    actor: entry.actor,
    action: entry.action,
    target_ref: entry.target_ref,
    ts: entry.ts.toISOString(),
    metadata_json: entry.metadata_json ?? null,
    prior_hash: priorHash.toString("hex"),
    this_hash: thisHash.toString("hex"),
  });

  // Async mirror to S3 with Object Lock
  setImmediate(() => mirrorAuditEntryToS3(nextSeq, entry.agency_id));
}
```

### 7.3 S3 Object Lock Mirror

The Supabase Postgres audit log is the primary store and append-only via RLS. The S3 mirror provides:
- A second independent copy (Supabase delete would require defeating two systems)
- Object Lock COMPLIANCE mode (7-year default retention; cannot be shortened without AWS root account action)
- Verifiable integrity independent of Supabase

```typescript
async function mirrorAuditEntryToS3(seq: number, agencyId: string): Promise<void> {
  const entry = await getAuditEntry(agencyId, seq);
  const key = `audit/${agencyId}/${entry.ts.toISOString().slice(0, 7)}/${seq}.json`;
  const body = JSON.stringify(entry);

  await s3.putObject({
    Bucket: AUDIT_MIRROR_BUCKET,
    Key: key,
    Body: body,
    ContentType: "application/json",
    ObjectLockMode: "COMPLIANCE",
    ObjectLockRetainUntilDate: addYears(new Date(), 7),
    ChecksumSHA256: sha256(body).toString("base64"),
  });

  await supabase.from("audit_log_entries")
    .update({ s3_object_key: key, s3_etag: s3Result.ETag })
    .eq("agency_id", agencyId).eq("seq", seq);
}
```

### 7.4 Tamper Detection

Background job (runs hourly) verifies the entire hash chain for each agency:

```typescript
async function verifyAuditChain(agencyId: string): Promise<ChainVerificationResult> {
  const agencyHMACKey = await getAgencyAuditHMACKey(agencyId);
  const { data: entries } = await supabase
    .from("audit_log_entries")
    .select("*")
    .eq("agency_id", agencyId)
    .order("seq", { ascending: true });

  let expectedPriorHash = hmacSHA256(agencyHMACKey, Buffer.from(`GENESIS:${agencyId}`));
  const errors: ChainError[] = [];

  for (const entry of entries!) {
    const entryPriorHash = Buffer.from(entry.prior_hash as string, "hex");
    if (!entryPriorHash.equals(expectedPriorHash)) {
      errors.push({ type: "PRIOR_HASH_MISMATCH", seq: entry.seq });
    }
    // Recompute this_hash and compare
    const expectedThisHash = hmacSHA256(agencyHMACKey, buildContent(entry, expectedPriorHash));
    const entryThisHash = Buffer.from(entry.this_hash as string, "hex");
    if (!entryThisHash.equals(expectedThisHash)) {
      errors.push({ type: "THIS_HASH_MISMATCH", seq: entry.seq });
    }
    expectedPriorHash = entryThisHash;
  }

  if (errors.length > 0) {
    await alertAgencySecurityAdmin(agencyId, "AUDIT_CHAIN_TAMPER_DETECTED", errors);
  }

  return { entries_verified: entries!.length, errors, verified_at: new Date() };
}
```

### 7.5 Optional Public-Chain Anchoring (G2)

Per G2 (default-off; opt-in per case at case-close when going to court):

At case-close, the platform builds a Merkle tree of all audit log entry hashes for that case, posts the Merkle root as Bitcoin OP_RETURN or Ethereum calldata, and records the transaction hash. Any party with the audit log can independently verify the Merkle root against the on-chain transaction, proving the audit trail existed before the block timestamp.

### 7.6 Audit Event Taxonomy (Partial)

```typescript
type AuditAction =
  | "auth.login" | "auth.logout" | "auth.mfa_enrolled" | "auth.mfa_challenged"
  | "auth.webauthn_verified" | "auth.session_expired" | "auth.force_logout"
  | "case.created" | "case.opened" | "case.closed" | "case.status_changed"
  | "belief.atom_asserted" | "belief.atom_challenged" | "belief.atom_retracted"
  | "belief.atom_court_graded"
  | "document.uploaded" | "document.viewed" | "document.exported" | "document.printed"
  | "custody.collected" | "custody.viewed" | "custody.exported"
  | "custody.produced_in_discovery" | "custody.signed" | "custody.sealed"
  | "credential.added" | "credential.rotated" | "credential.removed"
  | "capability.resolved"
  | "support.access_requested" | "support.access_granted"
  | "support.access_revoked" | "support.action_performed" | "support.action_denied"
  | "freeze.drafted" | "freeze.approved" | "freeze.submitted"
  | "seizure.recommended" | "seizure.approved"
  | "declaration.signed"
  | "key.tenant_dek_rotated" | "key.case_dek_reencrypted"
  | "pack.created" | "pack.signed" | "pack.exported"
  | "audit.chain_verified" | "audit.chain_anchor_published" | "audit.tamper_detected";
```

---

## 8. Chain of Custody Implementation

### 8.1 First-Class Architecture (F29)

Chain of custody is a first-class Supabase table — not implicit in the audit trail. Every view, export, print, share, or modification of every evidence artifact generates a `CustodyEvent` that is hash-chained into the artifact's `ChainOfCustodyRecord`.

### 8.2 Schema

```sql
CREATE TABLE chain_of_custody_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id             UUID NOT NULL,
  case_id               UUID NOT NULL,
  artifact_ref          TEXT NOT NULL,       -- "case_document:{id}" | "belief_atom:{id}" | etc.
  artifact_content_hash TEXT NOT NULL,       -- BLAKE2b-256 of artifact at creation (hex)
  
  -- Encrypted payload: event details with sensitive content
  encrypted_events_json BYTEA NOT NULL,      -- libsodium-encrypted JSON array of CustodyEvents
  events_nonce          BYTEA NOT NULL,
  
  -- Plaintext metadata for queries
  current_custodian     TEXT NOT NULL,
  classification        TEXT NOT NULL DEFAULT 'unclassified',
  event_count           INTEGER NOT NULL DEFAULT 0,
  last_event_at         TIMESTAMPTZ NOT NULL,
  
  -- Tamper-evident chain per artifact
  prior_record_hash     TEXT,                -- BLAKE2b-256 of prior state (hex)
  this_record_hash      TEXT NOT NULL,       -- BLAKE2b-256 of current state (hex)
  key_version           INTEGER NOT NULL DEFAULT 1,
  
  -- Optional RFC 3161 timestamp
  tsa_timestamp_token   BYTEA,
  tsa_timestamp_ts      TIMESTAMPTZ,
  
  -- Optional public-chain anchor
  chain_anchor_tx_hash  TEXT,
  chain_anchor_ts       TIMESTAMPTZ
);

ALTER TABLE chain_of_custody_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coc_agency_iso" ON chain_of_custody_records FOR ALL
  USING (agency_id = (auth.jwt()->>'agency_id')::uuid);
GRANT SELECT, INSERT, UPDATE ON chain_of_custody_records TO chainsight_app;
```

**Note on encrypting custody events:** The `encrypted_events_json` contains the `CustodyEvent[]` array. This includes `rationale`, `authority_ref`, and `recipient` fields — investigation-sensitive content. The `artifact_ref`, `current_custodian`, and `last_event_at` are in plaintext because queries need them. The event detail is in ciphertext; Supabase sees only that a custody event happened.

### 8.3 CustodyEvent Types

```typescript
interface CustodyEvent {
  event_type:
    | "collected" | "viewed" | "exported" | "printed" | "shared"
    | "signed" | "modified" | "sealed" | "unsealed" | "destroyed"
    | "produced_in_discovery";
  actor: string;          // user_id or "system:{service}"
  timestamp: string;      // ISO 8601
  authority: "warrant" | "subpoena" | "court_order" | "mlat"
           | "voluntary" | "internal_authority" | "none";
  authority_ref: string | null;   // document reference
  rationale: string;
  recipient: string | null;       // for shares/exports/productions
  hash_at_event: string;          // BLAKE2b-256 of artifact content at this event (hex)
}
```

### 8.4 Hash Chaining Per Artifact

```typescript
function computeRecordHash(record: Omit<CoCRecord, "this_record_hash">): string {
  const canonical = msgpack.encode({
    id: record.id,
    case_id: record.case_id,
    artifact_ref: record.artifact_ref,
    artifact_content_hash: record.artifact_content_hash,
    // Use HMAC of decrypted events for the hash, not the ciphertext
    // (so the hash is stable regardless of nonce changes)
    events_digest: blake2b256(record.decryptedEventsBuffer),
    prior_record_hash: record.prior_record_hash ?? "GENESIS",
  });
  return blake2b256(canonical).toString("hex");
}
```

### 8.5 Discovery Production Manifest

When evidence is produced to opposing counsel, the platform generates a `DiscoveryProductionManifest` — a structured document listing every artifact produced, its content hash at time of production, the producing investigator, the authority, and the recipient. This is signed by the producing investigator with their Ed25519 key and logged as a `custody.produced_in_discovery` event.

---

## 9. Reproducibility Pack Hashing Scheme

### 9.1 Content Addressing

Every Reproducibility Pack is content-addressed: the pack's identity is its cryptographic hash, computed as the Merkle root of all file hashes in the pack manifest.

**Pack structure:**
```
reproducibility_pack_{case_id}_{ts}.zip
├── manifest.json          ← Merkle root of all files; this IS the pack identity
├── chain_data/            ← frozen raw chain data (Parquet)
├── attribution_snapshots/ ← frozen provider responses
├── rule_versions.json     ← pinned rule version hashes
├── model_cards/           ← model IDs, prompt template hashes, sampling params
├── sbs_history.jsonl      ← Belief State history (append-only)
├── tool_log.jsonl         ← every agent tool call with inputs/outputs
├── coc_records.json       ← decrypted CoC records for all included artifacts
├── audit_extract.jsonl    ← relevant audit log entries
└── replay.sh              ← single command to reconstruct and verify
```

### 9.2 Manifest and Merkle Root

```typescript
function buildPackManifest(files: PackFile[]): PackManifest {
  const sorted = files.sort((a, b) => a.path.localeCompare(b.path));
  const fileHashes = sorted.map(f => ({
    path: f.path,
    blake2b256: blake2b256(f.content).toString("hex"),
    size_bytes: f.content.length,
  }));

  // Leaf hash: BLAKE2b-256(path ‖ file_hash)
  const leaves = fileHashes.map(f =>
    blake2b256(Buffer.concat([Buffer.from(f.path), Buffer.from(f.blake2b256, "hex")]))
  );
  const merkleRoot = computeMerkleRoot(leaves).toString("hex");

  return {
    pack_format_version: "1.0",
    case_id: /* case id */,
    agency_id_hash: blake2b256(Buffer.from(agencyId)).toString("hex"),  // hashed for privacy
    created_at: new Date().toISOString(),
    files: Object.fromEntries(fileHashes.map(f => [f.path, { blake2b256: f.blake2b256, size_bytes: f.size_bytes }])),
    merkle_root: merkleRoot,
    investigator_signature: null,  // set after Ed25519 signing
  };
}
```

### 9.3 Manifest Signing

Court-grade packs are signed by the producing investigator using their Ed25519 key (stored in the agency's KMS or on a hardware key). The signature covers the entire serialized manifest (which includes the Merkle root, which covers every file in the pack):

```typescript
async function signPackManifest(manifest: PackManifest, investigatorId: string): Promise<PackManifest> {
  const manifestBytes = msgpack.encode(manifest);
  const signingKey = await getInvestigatorSigningKey(investigatorId); // from KMS
  const signature = ed25519Sign(signingKey.privateKey, manifestBytes);

  await appendAuditEntry({
    actor: `user:${investigatorId}`,
    action: "pack.signed",
    target_ref: `pack:${manifest.case_id}`,
    ts: new Date(),
    metadata_json: { merkle_root: manifest.merkle_root }
  });

  return { ...manifest, investigator_signature: signature.toString("base64") };
}
```

### 9.4 Supabase Storage for Pack Blobs

Reproducibility Pack `.zip` files are encrypted with the Case DEK and uploaded to Supabase Storage (§2.5 pattern). The Merkle root is stored in plaintext in the `reproducibility_packs` table (it is a hash — no case content). The pack object key in Supabase Storage is a random UUID.

### 9.5 Replay Verification

The `replay.sh` script in each pack:
1. Verifies all file hashes against the manifest
2. Verifies the manifest Merkle root
3. Verifies the investigator Ed25519 signature (if signed)
4. Checks the on-chain anchor (if anchored per G2)
5. Re-runs the investigation trace using frozen chain data and attribution snapshots
6. Compares replay output against recorded findings — PASS if identical

```bash
#!/usr/bin/env bash
set -euo pipefail
PACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== ChainSight Reproducibility Pack Verification ==="
echo "Pack Merkle root: $(jq -r .merkle_root "${PACK_DIR}/manifest.json")"
python3 "${PACK_DIR}/tools/verify_hashes.py" "${PACK_DIR}/manifest.json" "${PACK_DIR}"
python3 "${PACK_DIR}/tools/verify_signature.py" "${PACK_DIR}/manifest.json"
docker run --rm -v "${PACK_DIR}:/pack:ro" \
  chainsight/replay:$(jq -r .platform_version "${PACK_DIR}/manifest.json") \
  /pack/replay.sh --verify-output
python3 "${PACK_DIR}/tools/compare_outputs.py" \
  "${PACK_DIR}/recorded_findings.json" /tmp/replay_output.json
echo "=== PASS: all findings reproducible from frozen inputs ==="
```

---

## 10. Sigstore-Backed Verifiable Builds

### 10.1 Why This Matters for Sovereignty

Sovereign customers must be able to verify that the binary they receive is what ChainSight claims it is. Supply chain attacks, hostile acquirers, and malicious insiders are all in the threat model (§1). Sigstore-backed verifiable builds address all three: any modification to the build pipeline produces a different binary, detectable against the public transparency log.

**Decision locked (G23):** Use Sigstore (Cosign + Rekor) from the start. No proprietary transparency log.

### 10.2 GitHub Actions Release Pipeline

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ["v*.*.*"]

permissions:
  contents: read
  packages: write
  id-token: write   # Required for Sigstore OIDC keyless signing

jobs:
  build-sign-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      # Build reproducible Docker image
      # Fixed base image digest (not tag), SOURCE_DATE_EPOCH for reproducibility
      - name: Build Docker image
        run: |
          export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)
          docker buildx build \
            --platform linux/amd64 \
            --build-arg SOURCE_DATE_EPOCH \
            --cache-from type=gha \
            --output type=oci,dest=chainsight-api.tar \
            .
          docker load < chainsight-api.tar

      # Generate SBOM
      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/chainsight-io/chainsight-api:${{ github.ref_name }}
          format: spdx-json
          output-file: sbom.spdx.json

      # Run security scans
      - name: Trivy vulnerability scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/chainsight-io/chainsight-api:${{ github.ref_name }}
          severity: CRITICAL
          exit-code: 1

      # Keyless signing with Sigstore (no long-lived private key)
      - name: Install Cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign Docker image
        run: |
          cosign sign --yes \
            ghcr.io/chainsight-io/chainsight-api@${{ steps.build.outputs.digest }}
          # Signature is pushed to Rekor automatically

      # Attach SBOM attestation
      - name: Attach SBOM attestation
        run: |
          cosign attest --yes \
            --predicate sbom.spdx.json \
            --type spdx \
            ghcr.io/chainsight-io/chainsight-api@${{ steps.build.outputs.digest }}

      # Attach SLSA provenance
      - name: Generate SLSA provenance
        uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2.0.0

      # Build and sign on-prem installer package
      - name: Build on-prem installer
        run: make installer VERSION=${{ github.ref_name }}

      - name: Sign on-prem installer
        run: |
          cosign sign-blob --yes \
            --output-signature chainsight-installer-${{ github.ref_name }}.sig \
            --output-certificate chainsight-installer-${{ github.ref_name }}.pem \
            chainsight-installer-${{ github.ref_name }}.tar.gz

      # Deploy to Fly.io
      - name: Deploy to Fly.io
        uses: superfly/flyctl-actions@1.5
        with:
          args: "deploy --image ghcr.io/chainsight-io/chainsight-api:${{ github.ref_name }}"
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 10.3 GitHub Security Configuration

```yaml
# Branch protection (main branch):
# - Require PR reviews before merge
# - Require status checks to pass (CI + security scans)
# - Require signed commits
# - No force pushes; no deletions

# GitHub Actions security:
# - Pin all action versions to full SHA (not tags)
# - Minimal permissions per job (principle of least privilege)
# - OIDC-based deployment (no long-lived FLY_API_TOKEN where possible)
# - Secret scanning enabled
# - Dependabot enabled for dependency updates
# - Code scanning (CodeQL) on all PRs
```

**Signed commits enforcement:**

```bash
# Developer setup (one-time)
git config --global commit.gpgsign true
git config --global tag.gpgsign true
gpg --full-generate-key  # or use hardware key (Yubikey OpenPGP)
git config --global user.signingkey <KEY_ID>

# GitHub branch protection: "Require signed commits" is enabled on main
```

### 10.4 Customer-Side Verification

```bash
# Verify a Docker image from GitHub Container Registry
cosign verify \
  --certificate-identity-regexp \
    "https://github.com/chainsight-io/chainsight/.github/workflows/release.yml@refs/tags/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/chainsight-io/chainsight-api:v1.2.3

# Verify the SBOM attestation (inspect what's in the software)
cosign verify-attestation --type spdx \
  --certificate-identity-regexp "..." \
  ghcr.io/chainsight-io/chainsight-api:v1.2.3 \
  | jq '.payload | @base64d | fromjson | .packages[] | .name'

# Verify the on-prem installer package
cosign verify-blob \
  --certificate chainsight-installer-v1.2.3.pem \
  --signature chainsight-installer-v1.2.3.sig \
  --certificate-identity-regexp "..." \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  chainsight-installer-v1.2.3.tar.gz
```

If verification fails → do not install. Any tampering between the GitHub build and the artifact the agency received would produce a Cosign verification failure.

### 10.5 Build Attestation for Phase 3 Confidential Computing

When Phase 3 adds confidential computing, the Sigstore build hash becomes the measurement the agency's KMS policy validates (§4.4). The published Cosign signature for a release is the customer's independent source of truth for the binary hash. Agency KMS policy: "Only release the DEK if the enclave's PCR0 matches the hash in the Cosign signature for `v1.2.3`." Tampered code → different PCR0 → KMS rejects → no decryption.

---

## 11. BYOK Credential Storage Flow

### 11.1 The Complete Lifecycle

```
PASTE → VALIDATE → ENCRYPT (Credential DEK + Tenant DEK) → STORE CIPHERTEXT IN SUPABASE
                                                        → CREDENTIAL BLOB OPAQUE TO SUPABASE
USE → DECRYPT IN-MEMORY → CALL PROVIDER → ZERO MEMORY
     (KMS call → Tenant DEK → Credential DEK → API key in memory for ~100ms only)
```

### 11.2 Concrete Code Pattern

```typescript
class CredentialStore {
  async storeCredential(
    agencyId: string,
    installId: string,
    plaintextCredential: Buffer  // Buffer, not string — so sodium.memzero works
  ): Promise<void> {
    // Unwrap Tenant DEK from KMS
    const tenantDEK = await this.kms.decryptTenantDEK(agencyId);
    try {
      // Generate per-credential DEK
      const credDEK = Buffer.from(sodium.randombytes_buf(32));
      try {
        // Encrypt the credential with its DEK
        const nonce = Buffer.from(sodium.randombytes_buf(24));
        const credCiphertext = Buffer.alloc(
          plaintextCredential.length + sodium.crypto_secretbox_MACBYTES
        );
        sodium.crypto_secretbox_easy(credCiphertext, plaintextCredential, nonce, credDEK);

        // Wrap the credential DEK under the Tenant DEK
        const wrappedCredDEK = cryptoService.encrypt(credDEK, tenantDEK);

        // Build the credential blob (all ciphertext; Supabase sees only this)
        const blob = {
          format: "v1",
          wrapped_cred_dek: wrappedCredDEK.ciphertext.toString("base64"),
          wrapped_cred_dek_nonce: wrappedCredDEK.nonce.toString("base64"),
          cred_ciphertext: credCiphertext.toString("base64"),
          cred_nonce: nonce.toString("base64"),
          key_version: 1,
        };

        await supabase.from("agency_provider_installs")
          .update({ credential_blob: blob })
          .eq("id", installId);

        // Never log, never return to UI, never include in error messages
      } finally {
        sodium.memzero(credDEK);
      }
    } finally {
      sodium.memzero(tenantDEK);
    }
    sodium.memzero(plaintextCredential);  // also zero the input
  }

  async resolveCredential<T>(
    agencyId: string,
    installId: string,
    callback: (cred: Buffer) => Promise<T>  // credential lives ONLY within this scope
  ): Promise<T> {
    const { data: install } = await supabase
      .from("agency_provider_installs")
      .select("credential_blob")
      .eq("id", installId)
      .single();

    const blob = install!.credential_blob as CredentialBlob;

    const tenantDEK = await this.kms.decryptTenantDEK(agencyId);
    try {
      // Unwrap credential DEK
      const credDEK = cryptoService.decrypt(
        { ciphertext: Buffer.from(blob.wrapped_cred_dek, "base64"),
          nonce: Buffer.from(blob.wrapped_cred_dek_nonce, "base64") },
        tenantDEK
      );
      try {
        // Decrypt the credential
        const plaintext = Buffer.alloc(
          Buffer.from(blob.cred_ciphertext, "base64").length - sodium.crypto_secretbox_MACBYTES
        );
        const ok = sodium.crypto_secretbox_open_easy(
          plaintext,
          Buffer.from(blob.cred_ciphertext, "base64"),
          Buffer.from(blob.cred_nonce, "base64"),
          credDEK
        );
        if (!ok) throw new DecryptionError("Credential authentication failed");

        try {
          return await callback(plaintext);  // credential exists only inside this call
        } finally {
          sodium.memzero(plaintext);
        }
      } finally {
        sodium.memzero(credDEK);
      }
    } finally {
      sodium.memzero(tenantDEK);
    }
  }
}
```

### 11.3 LLM Provider Credential Handling (v0.9 AI Strategy)

AI provider credentials (Anthropic API key, OpenAI API key, etc.) follow the exact same `CredentialStore` pattern stored as `AgencyLLMInstall.credential_blob`. The credential is passed only in the HTTP `Authorization` header of the outbound API call — never in the prompt, never logged.

### 11.4 Forbidden Patterns (CI-Enforced)

```typescript
// BANNED — ESLint rule: no-credential-logging
logger.info(`Calling provider with key: ${credential}`);     // ❌

// BANNED — no credential in error messages
throw new Error(`Provider call failed: key=${credential}`);  // ❌

// BANNED — no credential returned to API layer
return { install, credential: plaintextCred };               // ❌

// BANNED — no credential caching in Redis
await redis.set(`cred:${installId}`, cred, "EX", 3600);     // ❌

// BANNED — no credential in URL query parameters
fetch(`https://api.provider.com/data?key=${cred}`);         // ❌ (use Authorization header)

// BANNED — no credential in Supabase Realtime events
supabase.channel("updates").send({ credential: cred });     // ❌
```

---

## 12. Network Security Posture

### 12.1 TLS Everywhere (TLS 1.3 Minimum)

**Fly.io → browsers/clients:** TLS 1.3 enforced at the Fly.io proxy layer. Cipher suites: `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`, `TLS_AES_128_GCM_SHA256`. HSTS with `max-age=31536000; includeSubDomains; preload`.

**Fly.io → Supabase:** Supabase connections use TLS 1.3. The Supabase connection string includes `sslmode=verify-full` with the Supabase root CA certificate pinned in the application. A Man-in-the-Middle on the Fly.io → Supabase link would see only ciphertext blobs anyway (application-layer encryption), but TLS prevents even that observation.

**Fly.io → AWS KMS:** HTTPS to the AWS KMS VPC endpoint. AWS KMS enforces TLS 1.2 minimum (TLS 1.3 supported). The connection uses the AWS SDK's default TLS configuration with certificate verification.

**Fly.io → BYOK provider APIs:** HTTPS only. The `CapabilityRouter` refuses HTTP URLs in provider endpoint configurations.

**Supabase → AWS:** Not applicable; Supabase does not connect to the agency's AWS account. Only the Fly.io application does.

### 12.2 Fly.io Security Configuration

```toml
# fly.toml
[env]
  PORT = "3000"
  NODE_ENV = "production"
  # No secrets in fly.toml — all via `fly secrets set`

[[services]]
  internal_port = 3000
  protocol = "tcp"
  [services.concurrency]
    type = "connections"
    hard_limit = 1000
    soft_limit = 800
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
    tls_options = { alpn = ["h2", "http/1.1"], versions = ["TLSv1.3"] }

[metrics]
  port = 9091  # Prometheus metrics endpoint (internal only)
  path = "/metrics"

# No swap (prevents plaintext case data from landing on disk)
[build.args]
  NO_SWAP = "true"
```

**Fly Secrets (not in code, not in Supabase):**

```bash
# Set at deployment time; injected into Fly app as environment variables
fly secrets set SUPABASE_URL=https://xxxx.supabase.co
fly secrets set SUPABASE_SERVICE_KEY=eyJhbGc...  # service key; NOT the anon key
fly secrets set SUPABASE_JWT_SECRET=...
fly secrets set AWS_ACCESS_KEY_ID=...            # for KMS access; rotate to OIDC in Phase 1
fly secrets set AWS_SECRET_ACCESS_KEY=...
fly secrets set REDIS_URL=redis://...            # internal Fly Redis
fly secrets set JWT_SECRET=...
# Agency KMS CMK ARNs are stored per-tenant in Supabase tenant config (plaintext — not sensitive)
# BYOK credentials are stored encrypted in Supabase (never in Fly secrets)
```

### 12.3 Security Headers (Fastify)

```typescript
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";

app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'nonce-{nonce}'"],  // nonce-based CSP
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", process.env.SUPABASE_URL!],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

app.register(cors, {
  origin: process.env.ALLOWED_ORIGINS!.split(","),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
});
```

### 12.4 Supabase Row-Level Security as Network-Layer Analogue

Supabase RLS acts as a network policy within the database: even if a Fly.io application bug sends the wrong `agency_id`, the RLS policy enforces row-level isolation. It is the database-layer equivalent of a network ACL — belt on top of the encryption suspenders.

### 12.5 Internal Service mTLS (Phase 2+)

When the application decomposes into multiple Fly.io services (API, workers, Math service, Belief State service), inter-service communication uses mTLS with SPIFFE-compatible service identities:

```
spiffe://chainsight.internal/api
spiffe://chainsight.internal/worker
spiffe://chainsight.internal/math
spiffe://chainsight.internal/beliefstate
```

Short-lived service certificates issued by an internal CA (Vault PKI secrets engine). Each service verifies peer certificates before accepting connections.

### 12.6 Egress Filtering for Sovereign (On-Prem) Deployments

On-prem sovereign deployments maintain explicit egress allowlists:

| Destination | Port | Purpose |
|---|---|---|
| BYOK provider API endpoints (agency-configured) | 443 | Capability router calls |
| HashiCorp Vault (internal) | 8200 | KMS operations |
| Agency blockchain RPC nodes (internal or configured) | 8545/8546 | Chain data |
| Agency LLM inference (internal vLLM/Ollama) | Configurable | AI model calls |
| NTP (agency's own) | 123 | Time synchronization |

No outbound connections to Supabase, GitHub, Fly.io, or AWS in sovereign deployments. Zero.

---

## 13. Secrets Management

### 13.1 The Three-Environment Secret Hierarchy

| Environment | Tool | Notes |
|---|---|---|
| Local development | `.env.local` + `direnv` (or Doppler CLI) | Not committed; `.env.example` documents required vars with fake values |
| CI/CD (GitHub Actions) | GitHub Actions secrets + OIDC tokens | No agency keys; no BYOK credentials; only ChainSight infra creds |
| Production (Fly.io SaaS Blind) | Fly Secrets + AWS KMS (for agency DEKs) | All sensitive app secrets in Fly; agency keys in their own AWS |

### 13.2 Fly Secrets Management

```bash
# Initial setup (one-time per environment)
fly secrets set \
  SUPABASE_URL="https://xxxx.supabase.co" \
  SUPABASE_SERVICE_KEY="eyJ..." \
  SUPABASE_ANON_KEY="eyJ..." \
  JWT_SECRET="$(openssl rand -hex 64)" \
  REDIS_URL="redis://..." \
  AWS_ACCESS_KEY_ID="AKIA..." \
  AWS_SECRET_ACCESS_KEY="..." \
  HMAC_CHAIN_MASTER_KEY="$(openssl rand -hex 32)"

# Rotation (quarterly or on-demand)
fly secrets set AWS_ACCESS_KEY_ID="AKIA..." AWS_SECRET_ACCESS_KEY="..."

# Never commit to GitHub
# Never include in fly.toml
# Never log (Fly masks secrets in logs by default)
```

**Phase 1 upgrade:** Replace long-lived AWS access keys with OIDC federation between Fly.io workload identity and AWS IAM. Short-lived credentials; no long-lived secrets.

### 13.3 Supabase Service Key Handling

The Supabase service key (`service_role`) bypasses RLS. It is held only in Fly Secrets. It is:
- Never committed to GitHub
- Never stored in Supabase itself
- Never returned via API responses
- Only used server-side (Fastify backend); the frontend uses only the `anon` key via Supabase Auth JWTs

### 13.4 Rotation Cadence

| Secret | Rotation cadence | Method |
|---|---|---|
| Agency KMS Root Key (CMK) | Annual | AWS KMS automatic key rotation |
| Tenant DEK | 90 days | Automated job (§2.7) |
| Fly Secrets (AWS access key) | Quarterly until OIDC; then per-session | Manual rotation / OIDC |
| Supabase service key | On any suspected exposure | Supabase console regeneration |
| JWT secret | Annual | Fly `secrets set` + rolling session invalidation |
| TLS certificates | 90 days | Fly.io automated (Let's Encrypt) |
| Supabase database password | Annual | Supabase console + update connection string |

### 13.5 On-Prem Secrets (HashiCorp Vault)

For on-prem deployments, HashiCorp Vault manages all application secrets:

```hcl
# Dynamic database credentials (rotated every 1h)
vault write database/roles/chainsight-api \
  db_name=chainsight_prod \
  creation_statements="CREATE ROLE '{{name}}' LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT chainsight_app TO '{{name}}';" \
  default_ttl="1h" max_ttl="24h"

# JWT signing key (private key never leaves Vault)
vault write transit/keys/jwt-signing-key type=ed25519
# Sign via: vault write transit/sign/jwt-signing-key input=<base64>
```

---

## 14. Sovereign Deployment Hardening

### 14.1 On-Prem Does Not Use Supabase, Fly.io, or GitHub

This is the clean separation. For On-Prem Sovereign deployments:

| SaaS Blind component | On-Prem replacement |
|---|---|
| Supabase Postgres | Self-hosted Postgres 16 (Docker/K8s) |
| Supabase Auth | Ory Kratos (self-hosted) |
| Supabase Storage | MinIO or agency NFS/Ceph |
| Supabase Realtime | Postgres LISTEN/NOTIFY + Redis Pub/Sub |
| Supabase pgvector | pgvector extension on self-hosted Postgres |
| Fly.io app hosting | Docker Compose or Kubernetes (Helm chart) |
| GitHub CI/CD | Agency's own CI, or offline installer |
| AWS KMS | HashiCorp Vault + optional HSM |

**The application code is identical.** Deployment configuration changes; business logic does not. This is the value of the abstraction layers (CryptoService, AuthService, StorageService, DatabaseClient).

### 14.2 Air-Gapped Deployment Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Agency Secure Enclave (zero outbound network connectivity)        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ChainSight Application Services                             │  │
│  │  Docker Compose or Kubernetes (RKE2 STIG-hardened)          │  │
│  │  ├── API (Fastify)                                           │  │
│  │  ├── Worker (BullMQ)                                         │  │
│  │  ├── Math Service (Python FastAPI)                           │  │
│  │  └── Belief State Service                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Agency Data Infrastructure                                  │  │
│  │  ├── Postgres 16 + pgvector (HA: primary + replica)          │  │
│  │  ├── Redis (HA: Sentinel or Cluster)                         │  │
│  │  ├── Memgraph (graph store)                                  │  │
│  │  ├── MinIO (object storage; replaces Supabase Storage)       │  │
│  │  ├── Ory Kratos (auth; replaces Supabase Auth)               │  │
│  │  └── OpenTelemetry collector (internal only)                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Security Infrastructure                                     │  │
│  │  ├── HashiCorp Vault (HA: 3-node Raft) + optional HSM        │  │
│  │  ├── Local LLM inference (vLLM or Ollama)                    │  │
│  │  └── Mirrored blockchain archive nodes (Erigon, Bitcoin Core)│  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  INGRESS ONLY (data diode or physical media, no outbound):         │
│  ← Signed software updates (Cosign-verified)                       │
│  ← Updated attribution data (signed packages)                      │
│  ← Signed offline license certificates                             │
│  ← Model weight updates (signed packages)                          │
└────────────────────────────────────────────────────────────────────┘
```

### 14.3 Signed Offline Update Packages

Update packages are structured, signed archives verified before installation:

```
chainsight-update-v1.2.3-to-v1.3.0.tar.gz.sig  (Cosign signature)
chainsight-update-v1.2.3-to-v1.3.0.tar.gz
├── manifest.json         (file list + hashes + "from" and "to" versions)
├── images/               (Docker image tarballs)
├── migrations/sql/       (idempotent DB migrations)
├── helm/                 (Helm chart update)
└── model_updates/        (fine-tuned model updates, if any)
```

```bash
# Agency verifies before applying
cosign verify-blob \
  --certificate chainsight-update-v1.3.0.pem \
  --signature chainsight-update-v1.3.0.sig \
  --certificate-identity-regexp "https://github.com/chainsight-io/chainsight/..." \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  chainsight-update-v1.3.0.tar.gz
# PASS → apply; FAIL → do not apply; contact ChainSight security
```

**G21 (open):** Physical media (USB) or one-way data diode — confirm with first classified pilot.

### 14.4 Offline License Validation

```typescript
interface LicenseCertificate {
  version: "1";
  agency_id: string;
  agency_name: string;
  tier: "investigator" | "team" | "department" | "agency" | "classified";
  features: string[];
  seat_limit: number;
  valid_from: string;
  valid_until: string | null;  // null = perpetual
  update_subscription_until: string;
  signature: string;           // Ed25519 over the rest of the fields
  issuer_public_key_fp: string;
}

function validateLicense(certPath: string): ValidationResult {
  const cert = JSON.parse(fs.readFileSync(certPath, "utf8"));
  const { signature, ...payload } = cert;

  // Verify against the BUNDLED issuer public key (no network call, no phone-home)
  const valid = ed25519Verify(
    Buffer.from(signature, "base64"),
    Buffer.from(JSON.stringify(payload)),
    BUNDLED_ISSUER_PUBLIC_KEY  // shipped with the installer; updated only via signed updates
  );

  if (!valid) return { valid: false, reason: "Invalid signature" };
  if (cert.valid_until && new Date(cert.valid_until) < new Date())
    return { valid: false, reason: "Expired", gracePeriodDays: 30 };

  return { valid: true, license: cert };
}
```

**No phone-home, ever.** The license check is a local Ed25519 signature verification. ChainSight's servers can be offline permanently and the deployment keeps running.

### 14.5 STIG-Hardened OS

| Component | Recommended OS | STIG Baseline |
|---|---|---|
| All servers | RHEL 9 / Rocky Linux 9 | DISA STIG for RHEL 9 |
| Container runtime | Podman (rootless) or Docker CE | Docker CE STIG |
| Kubernetes | RKE2 | DISA STIG for RKE2 |
| Postgres | Postgres 16 on RHEL 9 | PostgreSQL STIG |
| Vault | RHEL 9 | RHEL 9 STIG |

Key STIG controls: FIPS mode (`fips=1` kernel param); SELinux enforcing; `auditd` covering ChainSight data paths; SSH hardened (no password, no root login, 4096-bit RSA or Ed25519 key only); `firewalld` allowlist policy; USB storage blocked at udev.

---

## 15. Anti-Feature Enforcement

### 15.1 F41 Commitments in Code

```typescript
// ESLint plugin: chainsight-antifeatures
// Rules applied to all TypeScript and Python in the monorepo

// Rule 1: Capability router calls must have case_id (no untargeted dragnets)
// Rule 2: No SELECT queries on investigation tables without agency_id + case_id WHERE clause
// Rule 3: No watcher rules without documented investigative predicate
// Rule 4: No BeliefAtom T3 assertions without provenance or signoff
// Rule 5: No demographic, geographic, or political data joins on investigation tables
// Rule 6: No model inference calls with uncited outputs (Verifier gate not bypassed)
```

**Tests that fail the build if anti-features are added:**

```typescript
describe("Anti-feature commitments (F41)", () => {
  test("capability router always requires case_id", async () => {
    await expect(router.resolve("get_address_attribution", {
      chain: "ethereum", address: "0xabc"
      // Missing: case_id
    })).rejects.toThrow("case_id required");
  });

  test("watcher rules require investigative predicate", async () => {
    await expect(watcherService.createRule({
      address_pattern: "*",
      chain: "ethereum",
      // Missing: case_id, predicate_documentation
    })).rejects.toThrow("investigative predicate required");
  });

  test("no mass surveillance mode exists", () => {
    // Enumerate all exported API functions; none should match the pattern
    // "monitor all addresses in chain/jurisdiction without case context"
    const exported = Object.keys(require("../capability-router"));
    const massSurveillancePattern = /monitorAll|watchAll|dragnet|massMonitor/i;
    exported.forEach(fn => expect(fn).not.toMatch(massSurveillancePattern));
  });
});
```

### 15.2 Civil-Liberties Review Board Interface (Phase 2)

All features in these categories require CLRB review before release:
- Mass-clustering or wallet analysis features
- Attribution promotion mechanisms
- Watcher/monitoring rule expansions
- Any ML/AI feature producing behavioral predictions
- Any feature touching demographic, geographic, or political data

### 15.3 FPR Target Monitoring (Seven Metrics from B7)

Nightly CI regression run measures actual vs. target FPR for all seven detectors. Any breach blocks feature releases for that detector category until remediated.

| Detector | Published FPR target |
|---|---|
| CIH clustering (UTXO) | < 1% |
| Change-output detection | < 5% |
| Mixer attribution | < 0.5% |
| Sanctions-list matching | < 0.1% |
| Peel-chain detection | < 3% |
| ML-based attribution | < 2% |
| AI-generated path suggestions | < 5% (gated by Critic Agent) |

---

## 16. Incident Response

### 16.1 Key Compromise Response

**Scenario: Tenant DEK believed compromised (e.g., plaintext DEK included in a diagnostic log that was exposed):**

```
Immediate (within 1 hour):
1. Disable all active sessions for the agency (Supabase Auth: invalidate all sessions)
2. Revoke all active support access tokens for the agency
3. Initiate emergency Tenant DEK rotation (§2.7 on-demand trigger)
4. New Tenant DEK generated; all Case DEKs and Credential DEKs re-wrapped
5. Log KEY_COMPROMISE_INCIDENT to audit trail (P0 severity)
6. Notify agency security admin and ChainSight security team

Within 24 hours:
7. Assess which cases were potentially accessible
8. If any case content was exfiltrated: initiate full Case DEK re-encryption for affected cases
9. Root cause analysis: how was the DEK in a log? (Should not happen — investigate the deviation)
10. Audit Fly.io application logs for the exposure window

Within 2 weeks:
11. Remediation of the process failure
12. External review if warranted
13. Notify affected investigators per agency's internal protocol
```

**Scenario: Agency AWS KMS CMK believed compromised:**

The agency revokes the existing KMS grant, creates a new CMK, and initiates a full tenant re-key (all DEKs re-wrapped under the new CMK). Full case content re-encryption is the worst case (all content stays encrypted under old Case DEKs; those DEKs were wrapped under the old CMK; re-wrapping the DEKs under the new CMK is sufficient unless the old DEK plaintexts were also extracted).

### 16.2 Agency-Reported Breach (Insider)

```
1. Agency opens a security incident ticket
2. ChainSight reviews audit trail for the reported time window (under agency-granted token)
   - Which accounts were active?
   - What exports, prints, shares were performed?
   - Anomalous access patterns?
3. Agency disables the suspected account (Supabase Auth: disable user)
4. Place legal hold on audit entries (S3 Object Lock prevents deletion regardless)
5. Export audit trail in court-ready format (HMAC chain verifiable)
6. Agency handles downstream notifications (breach notification law, supervisory chain)
```

### 16.3 Court-Ordered Disclosure (to ChainSight)

```
1. Outside counsel receives the order
2. Standard response (pre-drafted per F43):
   "ChainSight does not hold the decryption keys for case content.
   Case data is encrypted with keys held exclusively by the customer agency
   in their own AWS KMS account. We can produce: billing records, service
   health logs, table schema, and encrypted ciphertext rows. We cannot
   produce plaintext case content. To obtain case content, the order
   should be directed to [agency] at [address]."
3. Notify the affected agency (unless NDO prevents it)
4. If order seeks billing/telemetry: comply with what ChainSight actually holds
```

### 16.4 Supabase Compelled Disclosure

If Supabase is served a compelled disclosure order for ChainSight's customer data:

- Supabase produces: schema, ciphertext rows, auth user records, billing metadata
- Supabase cannot produce: plaintext case content (they don't have the agency's KMS keys)
- ChainSight's response to notification from Supabase: notify affected agencies; same pre-drafted response as §16.3

The structural defense remains: ciphertext without the agency's CMK is worthless.

---

## 17. Compliance Hooks

### 17.1 SOC 2 Type 1 (Phase 2 target)

The Supabase + Fly.io + GitHub stack has compliance implications:

| Provider | SOC 2 Status | Impact on ChainSight SOC 2 |
|---|---|---|
| Supabase | SOC 2 Type 2 compliant | Supabase's SOC 2 report covers the infrastructure layer; ChainSight's report covers the application layer and encryption controls |
| Fly.io | SOC 2 Type 2 compliant | Same scoping; ChainSight responsible for application-layer controls |
| GitHub | SOC 2 Type 2 compliant | CI/CD and source code management covered |
| AWS KMS | FedRAMP High authorized | Strongest compliance baseline; agency KMS account may have independent compliance posture |

ChainSight's SOC 2 scope is the application layer: access controls, encryption key management, audit logging, incident response, change management. The infrastructure providers' SOC 2 reports cover their layers.

**Evidence collection hooks:**

| SOC 2 Criterion | Automated evidence source |
|---|---|
| CC6.1 — Logical access | Supabase Auth user records; RLS policy exports; JWT claim validation logs |
| CC6.7 — Transmission security | Fly.io TLS configuration export; certificate transparency logs |
| CC7.1 — Anomaly detection | Audit chain verification run logs; failed auth event counts |
| CC7.2 — Monitoring | FPR monitoring reports; nightly regression run results |
| CC8.1 — Change management | GitHub Actions run logs; Cosign signature records in Rekor |

**Phase 2 migration note:** The move from Supabase/Fly.io to AWS (planned for Phase 2 SOC 2 readiness) changes the infrastructure providers but not the application-layer controls. The encryption hierarchy is identical; only the underlying storage and hosting move. The SOC 2 audit of the application layer is the same in both configurations.

### 17.2 SOC 2 Type 2 (Phase 3)

6-12 months of operating effectiveness evidence. The hash-chained audit log with S3 Object Lock provides continuous, tamper-evident evidence of control operation throughout the observation period.

### 17.3 CJIS Conformance (Phase 3)

CJIS Policy Area 7 (encryption) requires AES-256 at rest and in transit. XSalsa20-Poly1305 is not the standard CJIS cipher. Phase 3 CJIS conformance requires the `CryptoService` abstraction layer (§2.2) to swap to AES-256-GCM via OpenSSL FIPS — a configuration change, not a business-logic change.

CJIS Policy Area 5 (MFA): Supabase Auth TOTP + WebAuthn satisfies AAL2. PIV/CAC is a Phase 3 addition (FIDO2/PIV bridge).

### 17.4 FedRAMP Moderate (Phase 4)

Phase 4 FedRAMP path requires migrating from Fly.io to AWS GovCloud (or an AWS region with FedRAMP authorization boundary). The encryption hierarchy (agency KMS CMK already in AWS), the audit log (S3 Object Lock mirror), and the application code are all migration-ready. The compute layer (Fly.io → AWS EC2 with Nitro Enclaves) is the principal change, which also delivers the Phase 3 confidential computing target.

---

## 18. Phase 0 Implementation Plan

### 18.1 Week-by-Week Security Work

**Week 1-2: Supabase Foundation + Auth**

| Task | Priority | Notes |
|---|---|---|
| Supabase project setup with security defaults | Critical | Disable public schema, enable RLS on all tables from creation |
| Supabase Auth + TOTP MFA | Critical | `supabase.auth.mfa.enroll`; require AAL2 before case access |
| Custom JWT claims hook (agency_id, role) | Critical | SQL hook in Supabase; §6.1 |
| Fastify JWT validation middleware | Critical | Provider-agnostic; JWKS from Supabase |
| Basic RBAC (admin/investigator) | Critical | Role in JWT; middleware validates |
| Fly.io initial deployment + Fly Secrets | Critical | No secrets in code, no secrets in fly.toml |
| TLS configuration (1.3, HSTS) | Critical | Fly.io proxy handles cert; configure HSTS headers in Fastify |
| Security headers (Helmet, CSP) | Required | §12.3 |

**Week 3-4: Encryption Foundation**

| Task | Priority | Notes |
|---|---|---|
| `CryptoService` abstraction (§2.2 + §19 Q-SEC-7) | Critical | libsodium Phase 0; swappable to OpenSSL FIPS at Phase 3 |
| AWS KMS CMK provisioning wizard for agencies | Critical | Agency enters their CMK ARN; stored in tenant config |
| Tenant DEK generation + Supabase storage | Critical | `agency_encryption_config` table; wrapped DEK ciphertext only |
| Per-case DEK generation and wrapping | Critical | On `cases` INSERT; wrap under Tenant DEK |
| Encrypted column pattern for case tables | Critical | `encrypted_payload BYTEA` + `nonce BYTEA` + `key_version INT` |
| RLS policies for all case-bearing tables | Critical | `agency_id = auth.jwt()->>'agency_id'` |
| Supabase role separation (no UPDATE/DELETE on audit table) | Critical | Postgres GRANT/REVOKE |
| BYOK `CredentialStore` service (§11.2) | Critical | Encrypt before storing; zero after use |

**Week 5-6: Audit Log + Chain of Custody**

| Task | Priority | Notes |
|---|---|---|
| Audit log table + HMAC hash chain | Critical | §7.2; append-only via RLS + role |
| S3 Object Lock mirror setup | Required | Async; fail-open if S3 unavailable |
| Audit event taxonomy (auth.*, case.*, credential.*) | Critical | §7.6 |
| `appendAuditEntry` function wired to all key actions | Critical | Every auth event, every case mutation |
| Chain of Custody table + hash chain (F29) | Critical | §8.2; Phase 0 locked — do not defer |
| CoC event recording for document upload/view/export | Critical | §8.3 |
| Supabase Storage upload with pre-encryption (§2.5) | Critical | Encrypt with Case DEK BEFORE upload |

**Week 7-8: Signing, Secrets, and Sovereignty**

| Task | Priority | Notes |
|---|---|---|
| GitHub Actions release pipeline with Cosign signing | Critical | §10.2; G23 commitment |
| Branch protection: signed commits required on main | Required | GitHub repo settings |
| Secret scanning enabled on GitHub repo | Required | GitHub security settings; Dependabot enabled |
| Reproducibility Pack Merkle-root hashing | Critical | §9.2 |
| Offline license validation (Ed25519 signed cert) | Required | §14.4 |
| Minimal telemetry (billing-only; no case content) | Critical | §4.1; verify with test that no case content appears in logs |
| `no-credential-logging` ESLint rule | Critical | §11.4; enforced at CI |
| Anti-feature CI checks | Required | §15.1 |

### 18.2 What Is Absolutely Required at Phase 0 Ship

**Non-negotiable for any SaaS Blind customer:**

1. Application-layer encryption (libsodium) before every Supabase INSERT for sensitive columns
2. Agency-held AWS KMS CMK; ChainSight never holds the plaintext key
3. TOTP MFA enforcement (block case access until enrolled)
4. Hash-chained append-only audit log
5. Chain of Custody as first-class system (F29 — do not defer)
6. BYOK credential encryption (never logged; never returned to UI)
7. Supabase RLS on all case-bearing tables
8. TLS 1.3 + HSTS everywhere
9. Sigstore-signed releases (GitHub Actions + Cosign)
10. No case content in any log, telemetry, or error message

**Required but can ship within first 2 weeks post-launch:**
- WebAuthn for high-impact actions (TOTP in the interim — document the interim gap)
- S3 Object Lock configuration for the audit mirror

**Can wait for Phase 1:**
- Audited support access token automation (manual access discipline in the interim)
- Key rotation automation
- Air-gapped hardening and signed offline packages
- On-Prem installer (Supabase → self-hosted Postgres switch)
- Ory Kratos auth migration

**Can wait for Phase 3:**
- Confidential computing (G22)
- FIPS 140-2 mode (CryptoService swap to OpenSSL FIPS)
- RFC 3161 timestamp integration
- Public-chain anchoring (G2)

### 18.3 Three Things That Must Not Be Deferred

1. **Encryption from the first INSERT.** Retrofitting encrypted columns into an existing unencrypted database is one of the costliest migrations in software engineering. The `encrypted_payload` column pattern must be in the initial schema.

2. **Audit log hash chain from the first event.** Retrofitting a hash chain into an existing flat audit log requires re-processing all historical entries and re-establishing a genesis hash. Do it from day one.

3. **Chain of Custody from the first artifact.** F29 is explicitly Phase 0 per v0.8 — "too painful to retrofit." The cost now is two tables and a service. The cost in Phase 2 is weeks of migration plus the inability to claim court-grade chain of custody for all earlier cases.

---

## 19. Open Questions

These are specific decisions requiring founder/principal clarity before the corresponding code is written.

### Q-SEC-1: KMS Option for Small / Solo-Investigator Tier

**Question:** Supabase Auth + AWS KMS requires every agency to have an AWS account to create a CMK. For the Investigator tier (solo PI, forensic accountant), this may be friction-prohibitive.

**Options:**
- A) Require AWS KMS for all tiers (full blind guarantee for everyone)
- B) Offer ChainSight-managed KMS for Investigator tier with a clear documented reduced-guarantee notice; require agency KMS for Team+ tiers
- C) For Investigator tier, use a per-user derived key from a ChainSight-managed root, documented honestly as "ChainSight-managed encryption" (not blind) with a migration path to agency KMS
- D) Explore simpler key management options (e.g., agency-provided 32-byte secret key stored as a Fly secret per agency — not ideal, but functional for a first customer)

**Recommendation:** Option B or D for Phase 0 with a clear roadmap to A. The blind guarantee is most critical for Department tier and above. For the solo investigator who doesn't care about the distinction, the friction of an AWS account may lose the sale. Be honest about what each tier provides.

### Q-SEC-2: Supabase Auth Migration Trigger

**Question:** When exactly does the Supabase Auth → Ory Kratos migration happen? What is the trigger?

Candidates: (a) Phase 2 SOC 2 preparation; (b) first On-Prem customer closes; (c) first customer complaint about investigator identity in Supabase Auth.

**Recommendation:** First On-Prem customer closes is the hard trigger — On-Prem cannot use Supabase Auth. SOC 2 is the soft trigger for SaaS Blind (self-hosted auth is easier to audit than Supabase Auth for a managed service). Build the `AuthService` interface from day one so the migration is clean.

### Q-SEC-3: Air-Gapped Update Delivery (G21)

**Question:** Physical media (USB/DVD) or one-way data diode for classified/air-gapped updates?

**Status:** Open per G21. Both should be supported. Confirm with first classified pilot.

### Q-SEC-4: RFC 3161 TSA Selection

**Question:** Which RFC 3161 TSA for chain-of-custody timestamping?

**Recommendation:** DigiCert for Phase 0-2; evaluate NIST-accredited TSA for Phase 3 CJIS conformance.

### Q-SEC-5: Public-Chain Anchor Selection (G2)

**Question:** Bitcoin OP_RETURN or Ethereum calldata for optional public-chain anchoring?

**Recommendation:** Support both; let the agency choose per-case. Default-off until court production.

### Q-SEC-6: Confidential Computing Platform (G22)

**Question:** What triggers Phase 3 confidential computing, and which platform — Fly.io TEE (if available), AWS Nitro Enclaves (requires AWS migration), or specialized confidential computing provider?

**Status:** Open. Fly.io TEE availability as of mid-2026 is limited. Most likely outcome: Phase 3 coincides with AWS migration (SOC 2 / FedRAMP path), and Nitro Enclaves are the confidential computing vehicle. Confirm at Phase 2 exit.

### Q-SEC-7: CryptoService Abstraction for FIPS Transition

**Question:** Build the `CryptoService` abstraction layer from day one (swappable libsodium ↔ OpenSSL FIPS), or use libsodium directly and refactor at Phase 3?

**Recommendation:** Build the abstraction from day one. The upfront cost is 1-2 days of interface design. The Phase 3 refactor without the abstraction costs 2-4 weeks and touches every code path that does crypto. The interface is straightforward (`encrypt`, `decrypt`, `hash`, `hmac`, `sign`, `verify`, `memzero`).

### Q-SEC-8: Supabase Anon Key on Frontend

**Question:** The Supabase `anon` key is exposed in the browser (it's in the client-side JavaScript). This is by Supabase design — the anon key has no permissions beyond what RLS allows. But it is technically observable by anyone who loads the page. Is this acceptable?

**Status:** Yes, this is Supabase's expected architecture. The anon key is safe to expose publicly because Supabase RLS restricts all access to authenticated, agency-scoped rows. The `service_role` key (which bypasses RLS) is never exposed to the browser; it lives only in Fly Secrets. Document this for SOC 2 evidence: "the Supabase anon key is public by design; access is controlled by RLS, not key secrecy."

### Q-SEC-9: Supabase Realtime and Encrypted Channels

**Question:** Supabase Realtime is used for live collaborative updates (e.g., when one investigator adds a belief atom, other case collaborators see it immediately). Realtime messages flow through Supabase's infrastructure. Are Realtime messages encrypted with the case DEK before being sent through Supabase Realtime channels?

**Recommendation:** Yes — any Realtime event that contains case content must be encrypted with the case DEK before being broadcast to the Supabase Realtime channel. The channel carries ciphertext. Collaborators' browsers decrypt using the session-cached case DEK (obtained from the API on case open). Supabase Realtime infrastructure sees only ciphertext payloads. This must be implemented from day one.

---

## Appendix A: Security Decision Log

Decisions locked in this document:

| ID | Decision | Phase |
|---|---|---|
| S1 | `CryptoService` abstraction wrapping libsodium (Phase 0–2) → OpenSSL FIPS (Phase 3) | Phase 0 |
| S2 | BLAKE2b-256 for all content addressing and hash chains | Phase 0 |
| S3 | Ed25519 for investigator/manifest signing | Phase 0 |
| S4 | HMAC-SHA256 for audit log chain | Phase 0 |
| S5 | AWS KMS (agency CMK) for SaaS Blind v1; HashiCorp Vault for On-Prem | Phase 0 |
| S6 | Envelope encryption: root CMK → Tenant DEK → Case DEK (→ Document DEK) | Phase 0 |
| S7 | Application-layer libsodium encryption BEFORE Supabase INSERT (every sensitive column) | Phase 0 |
| S8 | Supabase RLS on all case-bearing tables (belt on top of encryption suspenders) | Phase 0 |
| S9 | Supabase Storage: encrypt with Case DEK BEFORE upload; Storage sees only ciphertext | Phase 0 |
| S10 | Hash-chained append-only audit log in Supabase Postgres + S3 Object Lock mirror | Phase 0 |
| S11 | Supabase Auth for SaaS Blind v1; Ory Kratos for On-Prem (and SaaS Blind migration Phase 2) | Phase 0 |
| S12 | TOTP MFA (all accounts) + WebAuthn (high-impact actions) | Phase 0 (WebAuthn) |
| S13 | Sigstore/Cosign/Rekor for release signing (G23) | Phase 0 |
| S14 | Confidential computing deferred to Phase 3 (G22) | Phase 3 |
| S15 | No vendor-held key escrow, ever | Architectural commitment |
| S16 | Support access requires agency-issued, scoped, time-limited, audited token | Phase 1 |
| S17 | TLS 1.3 minimum everywhere; no TLS 1.2 | Phase 0 |
| S18 | No case content in any log, telemetry, or error message | Phase 0 |
| S19 | Supabase anon key is public by design; service_role key in Fly Secrets only | Phase 0 |
| S20 | Supabase Realtime messages containing case content must be DEK-encrypted | Phase 0 |

---

## Appendix B: Trust Boundary Summary

```
ENTITY              HOLDS                       CANNOT READ
──────────────────────────────────────────────────────────────────────
Agency              KMS CMK + all DEKs          — (controls everything)
                    Supabase ciphertext
                    Fly.io application code

ChainSight          Supabase ciphertext          Case content (no CMK)
(vendor)            Fly.io process memory*       BYOK credentials (ciphertext)
                    GitHub source code

Supabase            Schema + metadata            Case content (ciphertext)
                    Investigator email (Auth)    BYOK credentials (ciphertext)
                    Ciphertext blobs

Fly.io              App code + secrets           Persistent case data
                    Process memory*              (exists only ephemerally)

GitHub              Source code                  Case data (never in repo)
                    CI run logs (sanitized)      Agency keys (never in CI)

AWS KMS             KMS API call metadata        Case content (not held)
(agency account)    Wrapped DEK ciphertexts      DEK plaintexts (HSM-protected)

* = v1 gap; closes in Phase 3 with confidential computing
```

---

*Document version: v1.1 — incorporates SaaS Blind v1 stack update (Supabase + Fly.io + GitHub)*
*Prior version: v1.0 (Clerk + generic IaaS assumptions)*
*Updated: June 2026*
*Author: Security & Cryptography Architecture Agent*
*Status: Design complete — pending Phase 0 implementation*
