# ChainSight v0.4 — API Key Entry UX Addendum

> **Principle (locked):** Adding an API key must feel like editing a `.env` file. Paste, save, done.
>
> All the sophistication — HSM encryption, capability mapping, scope binding, health checks, audit logging, budget enforcement — happens invisibly after the investigator clicks Save.

This extends the BYOK Provider Marketplace from v0.3 by locking down the credential-entry UX specifically. The marketplace catalog and capability router are unchanged; only the human-facing step of _adding a key_ is being nailed down here.

---

## Part 1 — The product principle

The BYOK Marketplace's commercial value disappears if entering keys is painful. Every additional click between "agency just bought a Chainalysis license" and "Chainalysis attributions flowing into their cases" is friction that loses deals.

Target: **a non-technical agency administrator can wire up 10 providers in under 10 minutes** — about as long as it takes to copy 10 keys out of 10 vendor portals.

Reference experience: pasting secrets into a `.env` file. That's the bar. Anything more elaborate than that fails the "Caveman" principle from the canvas UX addendum.

---

## Part 2 — The two entry modes

### 2.1 Mode A — Single-key entry (the default)

The default. One provider, one key, ~15 seconds.

```
┌─────────────────────────────────────────────────────────┐
│  Add provider — Etherscan                          [X]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Etherscan API key                                      │
│  ┌───────────────────────────────────────────────┐      │
│  │ paste your key here                           │ 👁    │
│  └───────────────────────────────────────────────┘      │
│                                                         │
│  Don't have one yet?  → Get an Etherscan key            │
│                                                         │
│  [Cancel]                                  [Save]       │
└─────────────────────────────────────────────────────────┘
```

That's the whole modal. Three elements: paste field, vendor link, Save button.

On Save:

1. The platform validates the key by calling the provider's documented test endpoint (defined on the `ProviderDefinition.test_endpoint` field).
2. If the call returns 200, the key is encrypted with the agency's KMS key and stored as an `AgencyProviderInstall` with sensible defaults.
3. The modal closes with a green confirmation toast: "Etherscan connected — handling 14 capabilities."
4. The provider's row in the installed-providers list goes green and starts showing usage stats.

If the test call fails:

- 401/403 → "That key didn't authenticate. Double-check you copied the whole thing."
- 429 → "Key works but the provider is rate-limiting us — try again in 60s, or save anyway."
- Network/timeout → "Couldn't reach the provider — save anyway?" (offline-friendly)
- Anything else → show the raw error and let the admin save anyway with a warning flag

**No multi-step wizard. No required scope-picker. No mandatory budget-cap form.** Defaults are good; the admin can refine later if they want. Most admins won't, because the defaults will be fine.

### 2.2 Mode B — Bulk paste (the `.env` mode)

For the agency admin who has 10 keys to enter and wants to be done in 60 seconds. One click on "Bulk add" opens a single text area:

```
┌─────────────────────────────────────────────────────────┐
│  Bulk add API keys                                 [X]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Paste your keys below in .env format.                  │
│  We'll detect which provider each one belongs to        │
│  and validate them in parallel.                         │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ ETHERSCAN_API_KEY=ABC123...                       │  │
│  │ BLOCKCHAIR_API_KEY=def456...                      │  │
│  │ TRM_API_KEY=ghi789...                             │  │
│  │ CHAINALYSIS_API_KEY=jkl012...                     │  │
│  │ ARKHAM_API_KEY=mno345...                          │  │
│  │ ALCHEMY_API_KEY=pqr678...                         │  │
│  │ ANTHROPIC_API_KEY=sk-ant-...                      │  │
│  │ # comments and blank lines ignored                │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  [Cancel]                              [Detect & Save]  │
└─────────────────────────────────────────────────────────┘
```

On "Detect & Save":

1. The platform parses each line as `KEY=VALUE`.
2. For each `KEY`, it looks up the canonical provider in the registry — both by exact match (`ETHERSCAN_API_KEY` → Etherscan) and by fuzzy match (`TRM_LABS_KEY` → TRM Labs).
3. All keys are tested in parallel.
4. Results render in a compact table:

```
┌─────────────────────────────────────────────────────────────┐
│  Detected and validated 6 of 7 keys                         │
├─────────────────────────────────────────────────────────────┤
│  ✅  Etherscan                       — 14 capabilities       │
│  ✅  Blockchair                      — 22 capabilities       │
│  ✅  TRM Labs                        — 8 capabilities        │
│  ✅  Chainalysis                     — 11 capabilities       │
│  ✅  Arkham                          — 6 capabilities        │
│  ✅  Alchemy                         — RPC + archive         │
│  ❌  Anthropic — key authenticated but project ID missing   │
│      [Fix]    [Skip]                                        │
│                                                             │
│                                       [Save all valid]      │
└─────────────────────────────────────────────────────────────┘
```

Click Save. Six provider installs created. The marketplace coverage matrix lights up. Done.

This is the moment the agency admin realizes the platform respects their time. It's a sales feature as much as a UX feature.

### 2.3 Mode C — `.env` file upload (for the truly lazy)

A drag-and-drop zone next to the bulk-paste textarea accepts `.env` files directly. Same parser, same flow. The file is never persisted to disk; contents are parsed in memory and discarded after the credentials are encrypted into the HSM.

This is useful when:

- The agency has a sysadmin who maintains a master `.env` for their tooling and just wants to drop it in
- The investigator is migrating from another platform and exported their keys
- The agency runs a dev/staging/prod split and wants to bulk-load each environment

---

## Part 3 — Recognized environment variable names

The registry ships with a canonical mapping table so bulk paste "just works." A few examples:

| Provider       | Recognized env var names (any of these)                 |
| -------------- | ------------------------------------------------------- |
| Etherscan      | `ETHERSCAN_API_KEY`, `ETHERSCAN_KEY`, `ETHERSCAN_TOKEN` |
| Blockchair     | `BLOCKCHAIR_API_KEY`, `BLOCKCHAIR_KEY`                  |
| Blockchain.com | `BLOCKCHAIN_COM_API_KEY`, `BLOCKCHAIN_API_KEY`          |
| TRM Labs       | `TRM_API_KEY`, `TRM_LABS_KEY`, `TRMLABS_API_KEY`        |
| Chainalysis    | `CHAINALYSIS_API_KEY`, `CHAINALYSIS_KEY`, `CA_API_KEY`  |
| Elliptic       | `ELLIPTIC_API_KEY`, `ELLIPTIC_KEY`                      |
| Crystal        | `CRYSTAL_API_KEY`, `CRYSTAL_BLOCKCHAIN_KEY`             |
| Merkle Science | `MERKLE_SCIENCE_API_KEY`, `MERKLE_KEY`                  |
| Arkham         | `ARKHAM_API_KEY`, `ARKHAM_KEY`                          |
| Allium         | `ALLIUM_API_KEY`, `ALLIUM_KEY`                          |
| Dune           | `DUNE_API_KEY`, `DUNE_KEY`                              |
| Goldsky        | `GOLDSKY_API_KEY`                                       |
| Alchemy        | `ALCHEMY_API_KEY`, `ALCHEMY_KEY`                        |
| Infura         | `INFURA_API_KEY`, `INFURA_PROJECT_ID`                   |
| QuickNode      | `QUICKNODE_API_KEY`, `QUICKNODE_ENDPOINT`               |
| Anthropic      | `ANTHROPIC_API_KEY`                                     |
| OpenAI         | `OPENAI_API_KEY`, `OAI_KEY`                             |
| CoinGecko      | `COINGECKO_API_KEY`, `CG_API_KEY`                       |
| Kaiko          | `KAIKO_API_KEY`                                         |
| OpenSanctions  | `OPENSANCTIONS_API_KEY`                                 |
| Sumsub         | `SUMSUB_API_KEY`, `SUMSUB_SECRET_KEY` (paired)          |
| Twilio         | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (paired)      |
| Resend         | `RESEND_API_KEY`                                        |

For providers requiring **paired credentials** (e.g. Sumsub's API key + secret, Twilio's SID + token, AWS IAM, OAuth client ID + secret), the parser groups them automatically. The validation step confirms the pair works together before saving either.

For unrecognized env vars, the bulk-add table shows:

```
⚠️  SOMETHING_API_KEY — provider unknown
    [Map to a provider]  [Skip]
```

Clicking "Map to a provider" opens a dropdown of catalog providers; once mapped, the platform learns the alias and remembers it for future bulk-adds in this agency tenant.

---

## Part 4 — What's hidden from the admin (the iceberg)

Everything from the BYOK addendum still happens — just invisibly:

| Behind the Save button | What actually happens                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential encryption  | Key encrypted with envelope encryption using the agency's per-tenant KMS DEK; never written to disk in cleartext, never logged                                    |
| Storage                | `AgencyProviderInstall` row created in Postgres with `credential_ref` pointing to the encrypted blob; the key itself is in HSM/KMS, not the database              |
| Health check           | Test endpoint called immediately; result stored in `last_health_check`                                                                                            |
| Scope assignment       | Default scope set to `agency_wide` (configurable later in the install detail view)                                                                                |
| Capability mapping     | The provider's declared capabilities are linked to the platform's capability router; routes update on the next request                                            |
| Priority               | Default priority = highest existing priority + 1 within the same capability set, so a newly added key never displaces a working one without explicit admin action |
| Budget                 | Default budget = unlimited; admin can cap later from the install detail view                                                                                      |
| Rate limiting          | Default to the provider's documented free/paid tier limits from the registry; admin can override                                                                  |
| Audit log              | Every key add, edit, rotation, scope change, and removal logged immutably with admin identity, timestamp, and originating IP                                      |
| Telemetry              | First call through the new key emits a `provider_first_use` event for monitoring                                                                                  |

The admin sees: "Etherscan connected — handling 14 capabilities." The platform sees: 11 backend changes, all auditable.

---

## Part 5 — Edge cases handled silently

| Situation                                                                          | What the admin sees                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Admin pastes a key that's already installed                                        | "This key is already saved as `Etherscan — main`. Update the existing entry?"                                                   |
| Admin pastes a key for a provider not yet in the catalog                           | "We don't recognize this provider yet. [Request integration]" — sends a roadmap ticket to ChainSight, logged for the admin      |
| Admin pastes a key that authenticates but lacks required permissions               | "Key works but doesn't have access to entity attribution. [What you'd need to upgrade]"                                         |
| Admin pastes a malformed key (wrong length, wrong charset)                         | "Doesn't look like an Etherscan key (should be 34 hex chars). Save anyway?"                                                     |
| Admin pastes a key during an active case                                           | New key takes effect immediately for new calls; in-flight calls finish on the old install; no case disruption                   |
| Admin's organization has multiple Etherscan keys (overflow for rate-limit pooling) | "Already have Etherscan — Main. Add this as Etherscan — Overflow?" — multiple installs of same provider are first-class         |
| Provider rotates their auth scheme (e.g. moves from API key to OAuth)              | Catalog update prompts admin to re-auth; old install marked `auth_outdated`; case work continues until the deprecation deadline |

None of these require a wizard. They're inline prompts handled in the same modal.

---

## Part 6 — Power-user features (one click away, never required)

After the key is saved, the install's detail view exposes the full configuration surface for admins who want it:

- Per-capability override matrix (use Provider A for `get_tx_by_hash`, Provider B for `get_entity_attribution`)
- Budget caps (per day, per month, per case)
- Rate-limit overrides
- Scope binding (agency-wide → department → case-specific)
- Fallback chain configuration (if primary fails, try these in this order)
- Key rotation (paste new key; old key kept warm for 24h to drain in-flight calls)
- Per-case usage reports
- Disable / Remove

**None of these screens are blockers in the initial-entry flow.** The admin can set everything to defaults and ship. Power users can dial it in later. This is the central asymmetry: easy by default, sophisticated by configuration.

---

## Part 7 — `.env` export (the symmetry)

If the platform accepts `.env`-style input, it should be willing to give the admin a `.env`-style export — minus the secrets, for obvious reasons. The export looks like:

```
# ChainSight provider configuration — exported 2026-06-16
# Secrets redacted; keys must be re-entered on import.

ETHERSCAN_API_KEY=<REDACTED — main>
BLOCKCHAIR_API_KEY=<REDACTED>
TRM_API_KEY=<REDACTED — investigations team>
CHAINALYSIS_API_KEY=<REDACTED>
ANTHROPIC_API_KEY=<REDACTED>
# ALCHEMY: paired keys
ALCHEMY_API_KEY=<REDACTED>
ALCHEMY_PROJECT_ID=<REDACTED>
```

This is what a sysadmin uses to **migrate between environments** (staging → prod), **back up their configuration** (the structure, not the secrets), or **document what an agency has wired** without exposing the secrets themselves.

Importing this exported file walks the admin through re-entering each redacted slot, with the provider mapping pre-populated. A 20-provider re-setup becomes a 5-minute job instead of a 1-hour one.

---

## Part 8 — Where this updates the locked design

| Document                    | What changes                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.3 BYOK addendum**      | Part 3 "Provider Marketplace UI" — section 3.4 "Key entry flow" is replaced by the spec in this addendum (single, bulk, and `.env`-file modes) |
| **v0.4 consolidated**       | Pillar 3 (BYOK Marketplace) wording updated to emphasize that key entry is `.env`-equivalent in friction                                       |
| **v0.4 canvas UX addendum** | The "So Easy a Caveman Can Do It" principle now applies to the admin surface too, not just the investigator canvas                             |
| **Build phasing**           | Bulk-paste and `.env` file upload land in Phase 0 alongside single-key entry; no later phase. This is too important to defer.                  |

---

## Part 9 — TL;DR

Three modes, all equally first-class:

1. **Single-key modal** — paste, save, done. ~15 seconds.
2. **Bulk paste** — paste `.env`-format block, auto-detect every provider, validate in parallel, save all valid in one click. ~60 seconds for 10 keys.
3. **`.env` file drop** — drag a `.env` file onto the marketplace screen; same parser, same flow.

Backed by the full sophistication of envelope encryption, capability routing, audit logging, scope binding, budget enforcement, and health monitoring — all hidden from the admin until they choose to engage with it.

**The friction of entering an API key is now zero.** That removes one of the last remaining objections to BYOK as a commercial pillar.
