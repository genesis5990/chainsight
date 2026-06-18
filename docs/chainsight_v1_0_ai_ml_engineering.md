# ChainSight v1.0 — AI/ML Engineering Design

> **Discipline:** AI/ML Engineering
>
> **Audience:** The solo developer building ChainSight, AI coding agents, and any future engineering hire who inherits the AI layer.
>
> **Scope:** This document is the authoritative deep-pass engineering design for ChainSight's AI/ML layer. It translates the locked strategy from v0.9, the accuracy spine from v0.2 B1-B8, and every agent touchpoint across the design pack into buildable specifications: schemas, pseudocode, prompt templates, Python/TypeScript signatures, routing rules, fine-tuning pipelines, evaluation harness, and a week-by-week Phase 0 implementation plan.
>
> **Locked decisions cited throughout:**
>
> - G1: court-grade attribution requires investigator signoff_id
> - B1–B8: belief state, tiered determinism, reproducibility, confidence calculus, critic, verifier, ground-truth flywheel, privacy
> - F41: anti-feature commitments (no predictive policing, no demographic correlation)
> - D1: attribution agent never publishes court-grade without human signoff
> - v0.9 Part 6: the ten hallucination mitigation techniques
>
> **What this document is not:** a data engineering spec, a backend architecture spec, or a frontend spec. Each of those is a separate discipline document.

---

## Part 1 — Agent Orchestration Architecture

### 1.1 The coordination model: Belief State as the contract

The Belief State Service is not a side effect of agent execution — it is the contract by which agents coordinate. Every agent reads context from the Belief State and writes conclusions back to it. No agent holds private memory between calls (the orchestrator holds ephemeral working state within a single run, but nothing persists across runs outside BeliefAtoms).

This is the architectural choice that makes ChainSight different from a generic LangGraph graph: agents are not nodes in a workflow engine. They are services with well-defined input contracts, output contracts, and a shared medium (the Belief State) that makes their work auditable and reproducible.

**The orchestrator is not a workflow manager.** It is a reasoning model (Tier C by default — Claude Opus 4.6) that reads the current Belief State, decides what specialist to invoke next, and routes control. The orchestrator has no hard-coded sequencing — it reasons about what work is incomplete given the current belief state and what the case theory requires.

### 1.2 The agent protocol

Every agent, without exception, conforms to this protocol:

```typescript
// packages/agents/src/protocol.ts

// ─── Agent input contract ───────────────────────────────────────────
interface AgentInput {
  case_id: string;
  agent_run_id: string; // UUID, unique per invocation
  task: AgentTask; // discriminated union per agent type
  belief_context: BeliefContextSlice; // relevant BeliefAtoms for this task
  model_card: ModelCardRef; // which model to use (from LLM registry)
  budget: AgentBudget; // cost cap, token limits
  ai_toggle: AIToggleState; // agency/role/case/action toggles
  idempotency_key: string; // for retry safety
}

interface AgentTask {
  type: string; // e.g. "decode_calldata", "trace_hop", "attribute_address"
  inputs: Record<string, unknown>;
  priority: 'high' | 'normal' | 'low';
  max_latency_ms: number | null;
  required_confidence: number; // minimum confidence for primary output
}

interface BeliefContextSlice {
  atoms: BeliefAtom[]; // relevant atoms, not the whole case
  path_context: TracePathRef | null; // if this task is on a specific path
  open_challenges: Challenge[]; // challenges the agent should be aware of
}

interface AgentBudget {
  max_input_tokens: number;
  max_output_tokens: number;
  max_cost_usd: number | null; // null = use model tier default
  tier_ceiling: 'A' | 'B' | 'C'; // hard limit on model tier for this call
}

// ─── Agent output contract ──────────────────────────────────────────
interface AgentOutput {
  agent_run_id: string; // echoed from input
  status: 'success' | 'partial' | 'failed' | 'skipped_ai_off';

  // Primary outputs (agent-specific, discriminated by task type)
  result: AgentResult; // discriminated union per agent type

  // BeliefAtom emissions (mandatory for every successful output)
  belief_atoms_emitted: BeliefAtomEmission[];

  // Confidence
  output_confidence: number; // overall output confidence [0, 1]
  confidence_breakdown: ConfidenceComponent[];

  // Provenance
  model_card_id: string; // which model/version was used
  prompt_template_hash: string; // reproducibility: which prompt was used
  tool_calls_made: ToolCallRecord[]; // every tool call with inputs/outputs
  provider_responses: ProviderResponseSnapshot[];

  // Latency and cost
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number; // 0 for self-hosted models

  // Errors
  errors: AgentError[];
  degraded_mode: boolean; // true if AI was off and non-AI fallback ran
}

// ─── BeliefAtom emission contract ───────────────────────────────────
interface BeliefAtomEmission {
  subject_type: 'address' | 'transaction' | 'entity' | 'path' | 'cluster' | 'hypothesis';
  subject_ref: string;
  predicate: BeliefPredicate;
  object: unknown;
  confidence: number;
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  provenance: ProvenanceRecord[];
  derivation: DerivationStep[];
  // note: status defaults to "asserted"; court_grade requires separate signoff
}

// ─── Error handling contract ─────────────────────────────────────────
interface AgentError {
  code: AgentErrorCode;
  message: string;
  recoverable: boolean;
  retry_strategy: 'backoff' | 'escalate_tier' | 'human_review' | 'none';
  partial_result_available: boolean;
}

type AgentErrorCode =
  | 'model_unavailable'
  | 'context_too_large'
  | 'confidence_below_floor'
  | 'tool_call_failed'
  | 'budget_exceeded'
  | 'grounding_check_failed' // Verifier rejected output
  | 'critic_hard_block' // Critic issued blocking challenge
  | 'ai_toggle_off'
  | 'math_service_error';
```

### 1.3 The orchestrator loop

The orchestrator is a Tier C model (Claude Opus 4.6 default) that runs the investigation planning and agent dispatch loop. It does not hard-code a fixed pipeline — it reasons about what the Belief State says is incomplete and dispatches accordingly.

```python
# packages/agents/src/orchestrator.py
#
# The orchestrator loop. This is NOT LangGraph. It's a direct SDK call loop
# with explicit state management via the Belief State Service.
#
# All tool calls are via Anthropic's tool_use / OpenAI's function_calling.
# The orchestrator uses the Anthropic SDK directly.

import anthropic
from belief_state_client import BeliefStateClient, BeliefAtom
from agent_registry import AgentRegistry
from model_router import ModelRouter
from cost_tracker import CostTracker
from typing import Generator

ORCHESTRATOR_SYSTEM_PROMPT = """
You are the ChainSight investigation orchestrator. Your job is to coordinate
specialist agents to build a complete, court-defensible trace of cryptocurrency
funds for the investigation case you have been given.

Your working constraints:
1. You NEVER compute numbers directly. All math goes through the Math Service tool.
2. You NEVER assert entity attributions without citing a BeliefAtom.
3. You NEVER promote a conclusion to court-grade without investigator signoff.
4. Every specialist agent you invoke writes BeliefAtoms; you read from them.
5. Stop when: (a) confidence falls below the case threshold, (b) the path
   reaches a terminus (known entity, privacy boundary, off-chain), or
   (c) the investigator's budget is exhausted.
6. At every decision point, check whether the Critic Agent has issued open
   challenges on the atoms you are reasoning from.

The Belief State you receive is your authoritative source. If it conflicts with
your reasoning, trust the Belief State and emit a challenge.

Current model tier constraints: {tier_ceiling}
Current cost remaining: ${remaining_budget:.2f}
AI toggle state: {ai_toggle_state}
"""

def run_orchestrator(
    case_id: str,
    task_description: str,
    config: OrchestratorConfig,
    belief_client: BeliefStateClient,
    agent_registry: AgentRegistry,
    model_router: ModelRouter,
    cost_tracker: CostTracker,
) -> Generator[OrchestratorEvent, None, OrchestratorResult]:
    """
    Main orchestration loop. Yields events for streaming to the investigator UI.

    Design: structured as a multi-turn conversation with the Tier C model.
    Each turn: (1) build context from Belief State, (2) call the model,
    (3) dispatch tool calls (agent invocations), (4) write results to Belief State,
    (5) repeat until done or budget exhausted.
    """

    client = anthropic.Anthropic()
    messages = []
    run_id = generate_run_id()

    # --- Initial context build ---
    belief_context = belief_client.get_relevant_slice(case_id, task_description)
    open_challenges = belief_client.get_open_challenges(case_id)

    system = ORCHESTRATOR_SYSTEM_PROMPT.format(
        tier_ceiling=config.tier_ceiling,
        remaining_budget=cost_tracker.remaining(case_id),
        ai_toggle_state=config.ai_toggle.serialize(),
    )

    # Seed the conversation with the task
    messages.append({
        "role": "user",
        "content": build_orchestrator_user_message(
            task_description, belief_context, open_challenges, config
        ),
    })

    max_turns = config.max_orchestrator_turns  # default 40

    for turn in range(max_turns):

        # --- Check budget before each turn ---
        if cost_tracker.budget_exhausted(case_id):
            yield OrchestratorEvent(type="budget_exhausted")
            break

        # --- Call the orchestrator model ---
        model = model_router.resolve_for_role("orchestrator", config)

        response = client.messages.create(
            model=model.id,
            max_tokens=config.max_orchestrator_output_tokens,
            system=system,
            messages=messages,
            tools=build_orchestrator_tools(agent_registry),
            tool_choice={"type": "auto"},
        )

        # Track cost
        cost_tracker.record(
            case_id=case_id,
            agent_role="orchestrator",
            model=model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

        # --- Process the response ---
        messages.append({"role": "assistant", "content": response.content})

        # If the model is done (no more tool calls), we're done
        if response.stop_reason == "end_turn":
            result = extract_final_orchestrator_result(response)
            yield OrchestratorEvent(type="complete", result=result)
            break

        # --- Dispatch tool calls (agent invocations) ---
        tool_results = []

        for tool_use in [b for b in response.content if b.type == "tool_use"]:

            yield OrchestratorEvent(
                type="agent_dispatched",
                agent=tool_use.name,
                inputs=tool_use.input
            )

            # Look up the agent, route the model, execute
            agent = agent_registry.get(tool_use.name)
            agent_model = model_router.resolve_for_role(
                role=tool_use.name,
                config=config,
                task_complexity=estimate_task_complexity(tool_use.input),
            )

            agent_result = agent.run(
                inputs=tool_use.input,
                model=agent_model,
                belief_client=belief_client,
                config=config,
            )

            # Write BeliefAtoms from the agent result
            if agent_result.status == "success":
                for atom_emission in agent_result.belief_atoms_emitted:
                    atom_id = belief_client.write_atom(case_id, atom_emission, run_id)
                    yield OrchestratorEvent(type="belief_atom_written", atom_id=atom_id)

            # Parallel: fire the Critic on each emitted atom
            # (Critic runs asynchronously; challenges will appear in subsequent turns)
            if agent_result.belief_atoms_emitted:
                fire_critic_async(
                    case_id=case_id,
                    atoms=[e.as_belief_atom() for e in agent_result.belief_atoms_emitted],
                    config=config,
                )

            # Cost tracking
            cost_tracker.record(
                case_id=case_id,
                agent_role=tool_use.name,
                model=agent_model,
                input_tokens=agent_result.input_tokens,
                output_tokens=agent_result.output_tokens,
                cost_usd=agent_result.cost_usd,
            )

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": serialize_agent_result(agent_result),
            })

            yield OrchestratorEvent(
                type="agent_completed",
                agent=tool_use.name,
                status=agent_result.status,
                confidence=agent_result.output_confidence,
            )

        # Refresh Belief State context with latest atoms (including Critic challenges)
        belief_context = belief_client.get_relevant_slice(case_id, task_description)
        open_challenges = belief_client.get_open_challenges(case_id)

        # Append tool results + refreshed Belief State summary
        messages.append({
            "role": "user",
            "content": tool_results + [
                {
                    "type": "text",
                    "text": f"Updated belief state after above tool calls:\n{serialize_belief_slice(belief_context)}\n\nOpen Critic challenges: {len(open_challenges)}\n{format_challenges(open_challenges)}"
                }
            ],
        })

    else:
        # max_turns hit
        yield OrchestratorEvent(type="max_turns_exceeded", turns=max_turns)
```

### 1.4 Tool definitions exposed to the orchestrator

The orchestrator sees each specialist agent as a structured tool. Example tool definitions:

```python
# Illustrative tool definitions for the orchestrator
ORCHESTRATOR_TOOLS = [
    {
        "name": "invoke_tracer_agent",
        "description": "Trace one hop from a source address. Calls the Tracer Agent to expand the trace graph by one hop forward or backward from the given address, emitting BeliefAtoms for each discovered transaction and counterparty.",
        "input_schema": {
            "type": "object",
            "properties": {
                "source_address": {"type": "string", "description": "Chain-qualified address e.g. eth:0xabc..."},
                "direction": {"type": "string", "enum": ["forward", "backward"]},
                "hops": {"type": "integer", "default": 1, "maximum": 5},
                "confidence_floor": {"type": "number", "default": 0.6},
                "chain": {"type": "string"},
            },
            "required": ["source_address", "direction", "chain"],
        },
    },
    {
        "name": "invoke_swap_agent",
        "description": "Decode a token swap transaction. Calls the Swap Agent which uses the fine-tuned Calldata Decoder SLM to parse router calldata and extract swap structure.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tx_hash": {"type": "string"},
                "chain": {"type": "string"},
            },
            "required": ["tx_hash", "chain"],
        },
    },
    {
        "name": "invoke_bridge_agent",
        "description": "Correlate a cross-chain bridge transaction. Uses the Bridge Correlator SLM to match source-side and destination-side bridge events.",
        "input_schema": {
            "type": "object",
            "properties": {
                "source_tx_hash": {"type": "string"},
                "source_chain": {"type": "string"},
                "bridge_protocol": {"type": "string", "description": "e.g. layerzero, cctp, wormhole, across"},
                "time_window_hours": {"type": "number", "default": 24},
            },
            "required": ["source_tx_hash", "source_chain"],
        },
    },
    {
        "name": "invoke_attribution_agent",
        "description": "Attribute an address or cluster to a known entity. Queries installed BYOK attribution providers and synthesizes the result using the Attribution Synthesizer SLM.",
        "input_schema": {
            "type": "object",
            "properties": {
                "address": {"type": "string"},
                "chain": {"type": "string"},
                "include_personal_attributions": {"type": "boolean", "default": True},
            },
            "required": ["address", "chain"],
        },
    },
    {
        "name": "invoke_accounting_agent",
        "description": "Compute taint values at a given path node under one or more methodologies. LLM formats results; all arithmetic runs in the Math Service.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path_id": {"type": "string"},
                "at_node": {"type": "string"},
                "methodologies": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["fifo", "lifo", "hifo", "libr", "pari_passu", "rolling_charge"]},
                },
            },
            "required": ["path_id", "at_node", "methodologies"],
        },
    },
    {
        "name": "invoke_narrative_agent",
        "description": "Draft a plain-language summary of a transaction analysis, a path segment, or a complete case section. Output is gated by the Verifier before delivery.",
        "input_schema": {
            "type": "object",
            "properties": {
                "narrative_type": {"type": "string", "enum": ["tx_summary", "path_segment", "case_section", "handoff_doc"]},
                "context_ref": {"type": "string"},
                "tone": {"type": "string", "enum": ["court_grade", "investigative", "executive"]},
            },
            "required": ["narrative_type", "context_ref"],
        },
    },
    {
        "name": "invoke_suggestion_agent",
        "description": "Generate ranked investigative path suggestions given the current Belief State.",
        "input_schema": {
            "type": "object",
            "properties": {
                "case_id": {"type": "string"},
                "focus": {"type": "string", "description": "e.g. 'find exchange deposit termini', 'identify commingling points'"},
                "max_suggestions": {"type": "integer", "default": 5},
            },
            "required": ["case_id"],
        },
    },
    {
        "name": "invoke_osint_agent",
        "description": "Run open-source intelligence queries against installed OSINT providers for entities or addresses.",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "target_type": {"type": "string", "enum": ["address", "entity", "email", "username", "ip"]},
                "providers": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["target", "target_type"],
        },
    },
    {
        "name": "call_math_service",
        "description": "Perform any numerical computation: fiat conversion, taint calculation, fee summation, confidence math. ALWAYS use this instead of computing in text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "operation": {"type": "string"},
                "inputs": {"type": "object"},
            },
            "required": ["operation", "inputs"],
        },
    },
]
```

### 1.5 Agent isolation and no private memory

Per v0.2 B1 and v1.0 Part 9 Principle 6:

```python
# Every agent MUST read its context from the Belief State, not from a prior run's
# in-memory state. This function is called at the start of every agent.run():

def get_agent_context(
    agent_name: str,
    case_id: str,
    task: AgentTask,
    belief_client: BeliefStateClient,
) -> AgentContext:
    """
    Agents have no persistent memory. They receive a context slice on each call.
    This is the ONLY memory they're allowed to use.
    """
    return AgentContext(
        relevant_atoms=belief_client.query(
            case_id=case_id,
            predicates=AGENT_RELEVANT_PREDICATES[agent_name],
            subject_refs=extract_subject_refs(task),
        ),
        open_challenges=belief_client.get_open_challenges(case_id),
        case_metadata=belief_client.get_case_metadata(case_id),
    )
```

---

## Part 2 — The Complete Agent List with Specifications

Each agent is a service with a defined interface. All TypeScript signatures live in `packages/agents/src/agents/`. All Python fine-tuning happens in `tools/fine-tune/`. The agents below are ordered by typical execution frequency.

### 2.1 Intake Agent

**Purpose:** Extract structured IOCs (addresses, tx hashes, amounts, entities, dates) from complaint narratives, affidavits, referrals, and other unstructured text at case creation.

**Default model tier:** Tier A (Phi-4 14B with Entity Extractor LoRA)

**Inputs:**

```typescript
interface IntakeAgentTask {
  type: 'extract_iocs';
  raw_text: string; // complaint narrative, affidavit, referral text
  document_type: 'complaint' | 'affidavit' | 'referral' | 'email' | 'other';
  source_document_id: string | null;
}
```

**Outputs:**

```typescript
interface IntakeAgentResult {
  extracted_iocs: ExtractedIOC[];
  extracted_entities: ExtractedEntity[];
  extracted_timeline: TimelineEvent[];
  extraction_confidence: number;
  unextracted_passages: string[]; // text the model couldn't extract from
}

interface ExtractedIOC {
  value: string; // the raw extracted value
  ioc_type: 'address' | 'tx_hash' | 'email' | 'username' | 'amount';
  chain: string | null;
  normalized: string;
  confidence: float;
  source_passage: string; // the exact text it came from
  page_number: int | null;
  bounding_box: BBox | null;
}
```

**System prompt outline:**

```
You are a blockchain forensics intake specialist. Extract all cryptocurrency
indicators of compromise (IOCs) from the provided document with high precision.

EXTRACTION RULES:
1. Extract ONLY what is explicitly stated. Do not infer or guess.
2. For every extracted item, record the EXACT passage it came from.
3. Normalize addresses to checksummed form where possible.
4. For amounts, extract the raw value AND the unit (ETH, BTC, USDT, etc.).
5. If uncertain about an extraction, include it with confidence < 0.7.
6. Do NOT compute any values. Report raw extracted numbers only.
7. Return JSON matching the ExtractedIOC schema exactly.

CITATION TOKEN FORMAT: Every claim must include a citation_token pointing to
the source passage. Format: [SOURCE:passage_index:char_start:char_end]
```

**Tool calls available:** None (pure extraction; no external calls)

**Success criteria:** Recall ≥ 0.95 on labeled extraction test set; zero hallucinated IOCs not present in the source document (Verifier enforces this)

**Failure modes:**

- Documents with complex tables → falls back to Extraction Agent with document intelligence pipeline
- Heavily redacted documents → partial extraction with honest coverage score
- Non-English text → language-detection gate routes to multilingual specialist (Phase 4)

**BeliefAtoms emitted:** One atom per extracted IOC with tier T2 (document-attested) when the document source is confirmed, T3 when extracted from unverified text.

---

### 2.2 Scope Agent

**Purpose:** Before running an expensive autonomous trace, estimate the scope: number of transactions, expected hop depth, number of chains involved, estimated confidence at depth, and projected cost. Lets the investigator make an informed decision before committing.

**Default model tier:** Tier A (Qwen 3.5 8B — fast, cheap, constrained task)

**Inputs:**

```typescript
interface ScopeAgentTask {
  type: 'estimate_scope';
  seed_addresses: string[];
  seed_txs: string[];
  chains: string[];
  max_hops: number;
  confidence_floor: number;
}
```

**Outputs:**

```typescript
interface ScopeAgentResult {
  estimated_tx_count: number;
  estimated_hop_depth: ConfidenceInterval;
  chains_likely_involved: string[];
  confidence_at_max_depth: ConfidenceInterval;
  estimated_provider_cost_usd: CostEstimate;
  estimated_duration_seconds: number;
  scope_warnings: ScopeWarning[]; // e.g. "high-volume mixer detected at hop 3"
  recommendation: 'proceed' | 'narrow_scope' | 'increase_budget' | 'review_manually';
}
```

**System prompt outline:**

```
You are a blockchain investigation scope estimator. Given seed indicators,
estimate the breadth and depth of a trace without running it.

Use the get_address_tx_count and get_address_history_sample tools to gather
signals. Do NOT trace — only estimate.

Confidence at depth formula: Use the call_math_service tool with operation
"compound_confidence" to compute expected confidence decay. Never compute
this yourself.
```

**Tool calls available:** `get_address_tx_count`, `get_address_history_sample` (sampling only), `call_math_service`

**Failure modes:** Returns "manual estimation required" if seed address has >1M transactions (exchange hot wallet, likely erroneous IOC)

---

### 2.3 Tracer Agent

**Purpose:** Expand the trace graph one hop at a time, forward or backward. For each hop, pull transaction data, decode the action, compute value flow, and emit BeliefAtoms for each discovered edge.

**Default model tier:** Tier B (DeepSeek V4 Pro) — elevates to Tier C for ambiguous branches, privacy-boundary decisions, and mixer adjacency

**Inputs:**

```typescript
interface TracerAgentTask {
  type: 'trace_hop';
  source_ref: string; // address or tx, chain-qualified
  direction: 'forward' | 'backward';
  hops: number; // 1-5
  confidence_floor: number;
  include_internal_calls: boolean;
  filter_dust: boolean; // ignore < $1 outputs
}
```

**Outputs:**

```typescript
interface TracerAgentResult {
  discovered_nodes: DiscoveredNode[];
  discovered_edges: DiscoveredEdge[];
  termination_reason:
    | 'hops_exhausted'
    | 'confidence_floor'
    | 'privacy_boundary'
    | 'exchange_terminus'
    | 'loop_detected'
    | 'budget_exhausted';
}

interface DiscoveredNode {
  node_type: 'address' | 'transaction';
  chain_qualified_ref: string;
  hop_from_source: number;
  cumulative_confidence: number;
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  attribution_hint: string | null; // from any installed provider, not authoritative
}
```

**System prompt outline:**

```
You are a blockchain transaction tracer. For each hop:
1. Fetch the transaction using fetch_tx tool
2. Decode the action type using decode_calldata tool (or swap_agent for swaps,
   bridge_agent for bridges)
3. Compute value flow using call_math_service — NEVER compute values yourself
4. For each discovered address, check existing Belief State attributions
5. Emit a BeliefAtom for each discovered edge with tier based on evidence type:
   - T0: UTXO direct spend / EVM Transfer log
   - T1: Router decode with known ABI
   - T2: Attribution from BYOK provider
   - T3: Heuristic inference
6. STOP if confidence drops below floor, or if you encounter:
   - A known mixer (Tornado, CoinJoin, Sinbad, ChipMixer historical)
   - A privacy chain (Monero, Zcash shielded)
   - A dead end (address with no history)

Confidence calculation: call_math_service with operation "hop_confidence_decay"
```

**Tool calls available:** `fetch_tx`, `decode_calldata`, `get_address_history`, `call_math_service`, `check_sanctions`, `get_attribution`, `invoke_swap_agent`, `invoke_bridge_agent`

**Elevation to Tier C trigger:** confidence < 0.7 AND topic is mixer-adjacent, bridge-heuristic, or multiple competing interpretations exist

**Failure modes:**

- Rate limit on chain data provider → capability router failover to alternate provider
- Unknown contract → Swap Agent attempted; falls back to raw calldata with confidence T3
- Privacy boundary → emits boundary marker BeliefAtom, stops trace, surfaces investigation options

---

### 2.4 Bridge Agent

**Purpose:** Correlate source-side and destination-side bridge transactions. The Bridge Correlator SLM is the best-performing specialist for this task because bridge message formats are highly repetitive and learnable.

**Default model tier:** Tier A (Qwen 3.5 8B with Bridge Correlator LoRA)

**Inputs:**

```typescript
interface BridgeAgentTask {
  type: 'correlate_bridge';
  source_tx: string;
  source_chain: string;
  bridge_protocol: BridgeProtocol; // layerzero | cctp | wormhole | across | hop | synapse | stargate
  time_window_hours: number;
  max_candidates: number;
}
```

**Outputs:**

```typescript
interface BridgeAgentResult {
  matched_destination_tx: string | null;
  matched_destination_chain: string | null;
  match_method: 'message_id' | 'amount_correlation' | 'timing_heuristic' | 'no_match';
  match_confidence: number;
  alternative_candidates: BridgeCandidate[]; // Critic reviews these
  message_id: string | null; // protocol-level correlation ID if available
}
```

**System prompt outline:**

```
You are a cross-chain bridge correlator. Given a source bridge transaction,
find the matching destination-side event.

Correlation priority:
1. FIRST: Use the message_id if available (T0/T1 certainty)
   - LayerZero: nonce + (src_chain_id, dst_chain_id, src_app)
   - CCTP: message hash from MessageTransmitter event
   - Wormhole: sequence number from LogMessagePublished
   - Across: depositId from V3FundsDeposited
2. If no message_id: amount + time window correlation (T3, flag for Critic)
3. NEVER conflate two different deposits of the same amount — always prefer
   message-ID correlation. If you cannot correlate with message_id, output
   match_method = "timing_heuristic" and confidence ≤ 0.70.
```

**Failure modes:** Multiple candidates of same amount in same time window → returns all as candidates, confidence ≤ 0.60, Critic forced review

---

### 2.5 Swap Agent

**Purpose:** Decode any token swap transaction into structured swap data: token in/out, amounts, path, slippage, fees. Handles Uniswap V2/V3/V4, Curve, Balancer, 1inch, Paraswap, CoW, Raydium, Orca, and others.

**Default model tier:** Tier A (Phi-4 14B with Token Swap Specialist LoRA)

**Inputs:**

```typescript
interface SwapAgentTask {
  type: 'decode_swap';
  tx_hash: string;
  chain: string;
  calldata: string;
  to_address: string;
  logs: EventLog[];
}
```

**Outputs:**

```typescript
interface SwapAgentResult {
  decoded_action: DecodedSwap;
  decode_confidence: number;
  abi_source: 'verified_sourcify' | '4byte_selector' | 'heuristic' | 'unknown';
}

interface DecodedSwap {
  protocol: string; // "uniswap_v3", "curve_exchange", etc.
  function_name: string;
  token_in: TokenRef;
  amount_in: Decimal; // always Decimal, never float
  token_out: TokenRef;
  amount_out: Decimal;
  recipient: string;
  route: RouteHop[];
  slippage_actual: Decimal; // computed by Math Service
  lp_fees: Decimal;
  price_impact: Decimal;
}
```

**System prompt outline:**

```
You are a DeFi calldata decoder specialized in token swaps. Decode the
provided transaction calldata and event logs into structured swap data.

RULES:
1. Use the fetch_abi tool first. If ABI exists, use it. If not, try 4byte lookup.
2. All decimal values must be output as strings (never floats) — the Math
   Service will handle arithmetic.
3. For multi-hop routes, enumerate every pool in the path.
4. If you cannot decode with confidence ≥ 0.80, output decode_confidence < 0.80
   and let the orchestrator decide whether to escalate.
5. Do NOT compute amounts — extract them from calldata/logs as raw hex,
   then use call_math_service to convert to decimal with correct decimals.
```

**Tool calls available:** `fetch_abi`, `lookup_4byte_selector`, `get_token_metadata`, `call_math_service`

---

### 2.6 Attribution Agent

**Purpose:** Synthesize multi-provider attribution for an address or cluster. Queries all installed BYOK attribution providers, reconciles disagreements, and produces a unified attribution BeliefAtom with confidence. Uses the Attribution Synthesizer SLM.

**Default model tier:** Tier B (DeepSeek V4 Pro) — elevated to Tier C when providers sharply disagree

**Inputs:**

```typescript
interface AttributionAgentTask {
  type: 'attribute_address';
  address: string;
  chain: string;
  include_personal_attributions: boolean;
  include_osint: boolean;
  required_confidence: number;
}
```

**Outputs:**

```typescript
interface AttributionAgentResult {
  attribution: UnifiedAttribution | null;
  provider_responses: ProviderAttributionResponse[];
  disagreements: AttributionDisagreement[];
  personal_attributions: PersonalAttribution[];
}

interface UnifiedAttribution {
  label: string;
  entity_type: EntityType;
  confidence: number;
  confidence_breakdown: ConfidenceComponent[];
  tier: 'T1' | 'T2' | 'T3'; // T2 = provider-attested, T3 = inferred
  provenance: ProvenanceRecord[];
  pinned_snapshot_ids: string[]; // one per contributing provider
  // NEVER promoted to court_grade without investigator signoff — D1 lock
}

interface AttributionDisagreement {
  provider_a: string;
  provider_b: string;
  label_a: string;
  label_b: string;
  severity: 'minor' | 'significant' | 'contradictory';
  recommendation: string;
}
```

**System prompt outline:**

```
You are a blockchain attribution synthesizer. Given multiple provider
responses for the same address, synthesize a unified attribution.

SYNTHESIS RULES:
1. Higher-confidence providers receive more weight (weights are configurable
   per agency provider install).
2. When providers agree: confidence is boosted (multi-source corroboration).
3. When providers disagree on entity label: output a disagreement record
   and set confidence ≤ 0.65. Never pick one arbitrarily.
4. NEVER assert an entity label that no provider has provided.
5. Personal attributions (subpoena-confirmed) override commercial provider
   labels but must be cited with their basis.
6. All attribution outputs must include provenance to the pinned snapshot.
   Format: attribution.[provider_name].[entity_label].[snapshot_id]
7. You CANNOT promote to court_grade. That requires investigator signoff.
```

**Tool calls available:** `query_attribution_providers`, `get_personal_attributions`, `call_math_service` (for confidence computation), `invoke_osint_agent`

---

### 2.7 OSINT Agent

**Purpose:** Open-source intelligence gathering — search blockchain explorers, social media, Telegram, public forums, OSINT databases, and news for entities associated with case addresses.

**Default model tier:** Tier B (DeepSeek V4 Pro or Claude Sonnet 4.6)

**Inputs:**

```typescript
interface OSINTAgentTask {
  type: 'gather_osint';
  targets: OSINTTarget[];
  providers: string[]; // installed BYOK OSINT providers
  depth: 'shallow' | 'standard' | 'deep';
  include_dark_web: boolean; // requires specific BYOK provider
}
```

**Outputs:** Structured entity reports per target, with BeliefAtoms for each confirmed fact, all at T3 confidence (OSINT = probabilistic) unless confirmed via subpoena.

**System prompt outline:**

```
You are a blockchain forensics OSINT analyst. For each target, gather
publicly available intelligence without making legal conclusions.

RULES:
1. Report only what you find. Absence of information is "no result found."
2. All entity attributions from OSINT are T3 — they require corroboration
   before court-grade use.
3. Do not access any source that would violate privacy laws for the case
   jurisdiction.
4. Cite every finding with its source URL and retrieval timestamp.
5. Distinguish between the target entity self-reporting (T2-adjacent) vs.
   third-party claims (T3).
```

---

### 2.8 Accounting Agent

**Purpose:** Compute taint values, fee breakdowns, and value flows at any point along a trace path under one or more accounting methodologies. **The LLM in this agent formats results only — all arithmetic runs in the Math Service.** Per v0.2 B6 and v1.0 Principle 2.

**Default model tier:** Tier A (Qwen 3.5 8B — formatting only, no reasoning required)

**Inputs:**

```typescript
interface AccountingAgentTask {
  type: 'compute_taint' | 'compute_fees' | 'compute_value_flow';
  path_id: string;
  at_node: string | null; // null = full path
  methodologies: AccountingMethodology[];
  fiat_currency: string; // ISO 4217 code
  price_snapshot_id: string;
}
```

**Outputs:**

```typescript
interface AccountingAgentResult {
  results_by_methodology: Record<AccountingMethodology, TaintResult>;
  formatted_summary: string; // LLM-formatted for report insertion
  math_service_call_log: MathServiceCall[]; // every computation, reproducible
}
```

**Key invariant:** The `formatted_summary` is the ONLY LLM output. All numbers come from `math_service_call_log`. Verifier checks that every number in `formatted_summary` appears verbatim in `math_service_call_log`. Any mismatch → Verifier fails the output.

---

### 2.9 Narrative Agent

**Purpose:** Draft court-grade plain-language text: transaction summaries, path segment narratives, executive summaries, case handoff documents. Every output is gated by the Verifier before delivery.

**Default model tier:** Tier C (Claude Opus 4.6) — the highest-stakes generative task in the system

**Inputs:**

```typescript
interface NarrativeAgentTask {
  type: 'draft_narrative';
  narrative_type:
    | 'tx_summary'
    | 'path_segment'
    | 'case_section'
    | 'executive_summary'
    | 'handoff_doc';
  context_ref: string; // case_id, path_id, tx_hash, etc.
  belief_context: BeliefContextSlice; // all relevant atoms
  tone: 'court_grade' | 'investigative' | 'executive';
  methodology: AccountingMethodology | null;
  max_words: number;
}
```

**Outputs:**

```typescript
interface NarrativeAgentResult {
  draft_text: string; // raw draft from LLM
  citation_tokens: CitationToken[]; // all citations embedded
  verifier_status: 'passed' | 'failed' | 'partial';
  verifier_flagged_sentences: FlaggedSentence[];
  math_values_used: MathServiceRef[]; // every number must reference Math Service
}
```

**System prompt outline:**

```
You are a blockchain forensics expert writer drafting court-grade reports.
Every sentence you write must:
1. Cite a specific BeliefAtom or T0 source using the citation token format:
   [CITE:atom_id] or [CITE:tx_hash:field_name]
2. NEVER include a number unless you first called call_math_service and are
   citing its output. Format: [MATH:math_call_id:value]
3. NEVER mention entity names without citing an attribution:
   Format: [ATTR:attribution_snapshot_id:label]
4. Use passive voice for AI-derived conclusions: "analysis indicates" not
   "the defendant did"
5. Include the methodology disclosure whenever describing taint values:
   "Under FIFO methodology, [MATH:...] was traceable."
6. Flag sentences you cannot ground with [NEEDS_HUMAN_REVIEW].

The Verifier will reject any sentence without valid citation tokens.
Write with the precision of a technical expert, not the speculation of an
inference engine.
```

**Verifier gate:** Every output from the Narrative Agent is sent to the Verifier Agent before the investigator sees it. See Part 8 for Verifier details.

---

### 2.10 Watcher Agent

**Purpose:** Evaluate persistent alert rules against incoming blockchain events. Fires when a watched address receives funds, when taint reaches a terminus, or when a user-defined rule condition is met.

**Default model tier:** Tier A (rule evaluation — LLM only involved in alert notification drafting)

**Architecture note:** The Watcher Agent is mostly rule-based (T1). The LLM component generates human-readable alert messages, not the evaluation logic itself.

```python
# core evaluation is deterministic
def evaluate_watcher_rule(rule: WatcherRule, event: BlockchainEvent) -> bool:
    """Deterministic rule evaluation — no LLM involved."""
    return WatcherRuleEvaluator(rule).evaluate(event)

# LLM only drafts the notification message
def draft_alert_message(
    rule: WatcherRule,
    event: BlockchainEvent,
    belief_context: BeliefContextSlice,
) -> AlertMessage:
    """LLM drafts the alert notification. Verifier gates it."""
    ...
```

---

### 2.11 Critic Agent

**Purpose:** Run adversarial review of every BeliefAtom emitted by other agents. Issues Challenges that block court-grade promotion until resolved. See Part 7 for full specification.

**Default model tier:** Tier C (Claude Opus 4.6) — adversarial reasoning requires frontier capability

---

### 2.12 Suggestion Agent

**Purpose:** Generate ranked investigative path suggestions given the current Belief State. "What should I look at next?" surfaced as the Suggestion sidebar in the UI.

**Default model tier:** Tier B (DeepSeek V4 Pro or Claude Sonnet 4.6)

**Inputs:**

```typescript
interface SuggestionAgentTask {
  type: 'generate_suggestions';
  case_id: string;
  focus: string | null;
  exclude_already_explored: boolean;
  max_suggestions: number;
}
```

**Outputs:**

```typescript
interface SuggestionAgentResult {
  suggestions: InvestigativeSuggestion[];
}

interface InvestigativeSuggestion {
  suggestion_text: string; // one-sentence human-readable suggestion
  rationale: string; // why this is recommended
  action_type: 'trace_forward' | 'trace_backward' | 'attribute' | 'subpoena' | 'osint';
  target_ref: string;
  expected_confidence_gain: number;
  estimated_cost_usd: number;
  priority: number; // 1-5
  critic_reviewed: boolean; // Critic must review before showing to investigator
}
```

**System prompt outline:**

```
You are a senior blockchain forensics investigator advising on next steps.
Given the current Belief State:
1. Identify gaps: What is unknown that would strengthen the case?
2. Identify high-value next steps: Which untraced paths have highest value?
3. Identify termini: Which paths are close to reaching attributed endpoints?
4. For each suggestion, estimate confidence gain and cost.
5. Do NOT suggest anything that would cross the F41 anti-feature lines:
   no predictive policing, no demographic correlation, no dragnet features.
   Every suggestion must be specific and tied to existing evidence.
6. Cite the BeliefAtoms your suggestion is based on.
```

---

### 2.13 Verifier Agent

**Purpose:** Check every AI-generated sentence against its citation tokens. Gate reports before investigator delivery. See Part 8 for full specification.

**Default model tier:** Tier A (Qwen 3.5 8B with Verifier SLM LoRA) — small specialist

---

### 2.14 Inspector Specialists

**Purpose:** The Transaction Inspector uses several sub-specialists in parallel. This is the highest-touch AI surface (v0.5 F8 / "the demo moment").

**Architecture:** The Inspector is not a single agent call — it's a parallel fan-out:

```python
async def run_inspector(
    tx_hash: str,
    chain: str,
    case_id: str,
    config: InspectorConfig,
) -> TransactionAnalysis:
    """
    Inspector fan-out. All sections run in parallel where possible.
    Streaming is enabled: each section delivers independently.
    """

    # Section 1-2: Deterministic (no LLM needed)
    tx_data_task = asyncio.create_task(fetch_tx_data(tx_hash, chain))
    structured_facts_task = asyncio.create_task(build_structured_facts(tx_hash, chain))

    # Section 3: Decoded action (Tier A SLM)
    decoded_action_task = asyncio.create_task(
        invoke_swap_agent(tx_hash, chain)  # or bridge_agent, or raw decoder
    )

    # Section 4: Counterparty intelligence (Tier B)
    attribution_tasks = []  # fan out per address involved

    # Section 5: Case context (deterministic, Belief State query)
    case_context_task = asyncio.create_task(
        get_tx_case_context(tx_hash, case_id)
    )

    # Section 6: Obfuscation findings (rule-based + Tier A ML)
    obfuscation_task = asyncio.create_task(
        run_obfuscation_detectors(tx_hash, chain, case_id)
    )

    # Section 1: Plain-language summary (Tier B/C — Narrative Agent)
    # Runs AFTER other sections complete (needs their output as context)

    # Section 7: Critic notes (Tier C — parallel with all above)
    critic_task = asyncio.create_task(
        invoke_critic_agent(tx_hash, chain, case_id)
    )

    # Gather and assemble
    results = await asyncio.gather(
        tx_data_task, structured_facts_task, decoded_action_task,
        case_context_task, obfuscation_task, critic_task,
        *attribution_tasks,
        return_exceptions=True,
    )

    # Draft summary once all facts are known
    narrative_task = await invoke_narrative_agent(
        narrative_type="tx_summary",
        context=assemble_inspector_context(results),
    )

    return assemble_transaction_analysis(results, narrative_task)
```

---

### 2.15 Extraction Agent

**Purpose:** Extract structured data from case documents (subpoena returns, bank statements, court orders). Uses the Entity Extractor SLM and Subpoena Format Parser specialists.

**Default model tier:** Tier A (Phi-4 14B with Entity Extractor LoRA + format-specific adapters)

**Inputs:** CaseDocument with OCR/layout from the document intelligence pipeline

**System prompt outline:**

```
You are a forensic document analyst. Extract structured evidence from the
provided document.

EXTRACTION RULES:
1. Extract ONLY what is explicitly stated. Never infer values.
2. For every extracted value, record: exact text, page number, bounding box.
3. Numeric values must be extracted as strings — Math Service handles
   arithmetic.
4. For subpoena returns: use the format-specific playbook for this exchange
   (Binance / Coinbase / Kraken / etc.) to identify field positions.
5. Flag any fields you could not extract with confidence < 0.7.
6. Output ExtractedEntity objects — one per item.
```

---

## Part 3 — Model Routing

### 3.1 The routing decision

The capability router's LLM module resolves each agent call to a specific model via a three-step decision:

```python
# packages/capability-router/src/llm_router.py

@dataclass
class RoutingDecision:
    model_id: str
    provider_id: str
    tier: Literal["A", "B", "C"]
    reason: str
    estimated_cost_usd: float

def resolve_model_for_agent(
    agent_role: str,
    task: AgentTask,
    config: AgencyLLMConfig,
    cost_tracker: CostTracker,
    case_id: str,
) -> RoutingDecision:
    """
    Three-step model routing decision:
    1. Start from the agent's default tier (locked in AGENT_TIER_MAP)
    2. Check promotion signals — does the task warrant a higher tier?
    3. Check demotion constraints — budget, toggles, cost preference
    4. Resolve to specific model from the agency's installed models
    """

    # Step 1: Default tier
    default_tier = AGENT_TIER_MAP[agent_role]

    # Step 2: Promotion signals
    resolved_tier = default_tier
    promotion_reason = None

    if should_promote_to_tier_c(agent_role, task):
        resolved_tier = "C"
        promotion_reason = get_promotion_reason(agent_role, task)
    elif should_promote_to_tier_b(agent_role, task):
        resolved_tier = "B" if default_tier == "A" else default_tier
        promotion_reason = get_promotion_reason(agent_role, task)

    # Step 3: Demotion constraints
    budget_remaining = cost_tracker.remaining(case_id)
    tier_ceiling = config.tier_ceiling  # agency-level constraint

    # Honor tier ceiling (agency may restrict all calls to Tier A for cost)
    resolved_tier = min_tier(resolved_tier, tier_ceiling)

    # Budget pressure: if < $1 remaining and task is non-critical, demote
    if budget_remaining < 1.00 and task.priority != "high":
        resolved_tier = min_tier(resolved_tier, "B")

    # AI toggle: if role is off, return None (caller handles non-AI fallback)
    if not config.ai_toggle.is_enabled_for_role(agent_role):
        return None

    # Resolve to specific model
    model = config.installed_models.best_for_tier(
        tier=resolved_tier,
        role=agent_role,
        capabilities_required=AGENT_REQUIRED_CAPABILITIES[agent_role],
    )

    return RoutingDecision(
        model_id=model.id,
        provider_id=model.provider_id,
        tier=resolved_tier,
        reason=promotion_reason or f"default tier for {agent_role}",
        estimated_cost_usd=estimate_call_cost(model, task),
    )
```

### 3.2 Promotion rules (when to escalate tier)

```python
# packages/capability-router/src/promotion_rules.py

TIER_C_PROMOTION_SIGNALS = {
    "tracer": [
        lambda task, ctx: ctx.open_challenges_count > 3,
        lambda task, ctx: "mixer" in ctx.recent_atom_predicates,
        lambda task, ctx: task.confidence_floor > 0.90,
        lambda task, ctx: ctx.hop_depth > 15,
        lambda task, ctx: "bridge_heuristic" in ctx.recent_atom_tiers,
    ],
    "attribution": [
        lambda task, ctx: ctx.provider_disagreement_severity == "contradictory",
        lambda task, ctx: ctx.is_high_value_target,  # > $1M in case
        lambda task, ctx: task.required_confidence > 0.90,
    ],
    "narrative": [
        lambda task, ctx: task.tone == "court_grade",
        lambda task, ctx: task.narrative_type == "case_section",
    ],
    "suggestion": [
        lambda task, ctx: ctx.case_complexity_score > 0.8,
        lambda task, ctx: ctx.open_challenges_count > 5,
    ],
}

TIER_B_PROMOTION_SIGNALS = {
    "intake": [
        lambda task, ctx: task.document_length > 50_000,
        lambda task, ctx: task.document_type in ["court_order", "mlat"],
    ],
    "swap": [
        lambda task, ctx: ctx.abi_source == "unknown",
        lambda task, ctx: "mev" in task.flags,
    ],
    "bridge": [
        lambda task, ctx: ctx.match_method == "timing_heuristic",
        lambda task, ctx: ctx.alternative_candidates_count > 3,
    ],
}

def should_promote_to_tier_c(
    agent_role: str,
    task: AgentTask,
    context: RoutingContext,
) -> bool:
    signals = TIER_C_PROMOTION_SIGNALS.get(agent_role, [])
    return any(signal(task, context) for signal in signals)
```

### 3.3 Default tier map (locked from v0.9)

```python
AGENT_TIER_MAP: dict[str, Literal["A", "B", "C"]] = {
    "orchestrator": "C",
    "critic": "C",
    "narrative": "C",
    "tracer": "B",        # promotes to C for hard branches
    "attribution": "B",   # promotes to C for contradictions
    "osint": "B",
    "suggestion": "B",
    "bridge": "A",        # Bridge Correlator SLM
    "swap": "A",          # Token Swap Specialist SLM
    "intake": "A",        # Entity Extractor SLM
    "scope": "A",
    "accounting": "A",    # formatting only; math in Math Service
    "watcher": "A",       # rule evaluation; LLM formats alerts only
    "verifier": "A",      # Verifier SLM
    "extraction": "A",    # Entity Extractor + Subpoena Parser SLMs
    "inspector_summary": "B",  # plain-language summary
    "inspector_critic": "C",   # Critic reviews Inspector
}
```

### 3.4 Budget enforcement

Budget is enforced at three levels:

1. **Per-agent call:** `AgentBudget.max_cost_usd` is checked before each call; the orchestrator pre-estimates cost using the model's published rate and expected token count.
2. **Per-case:** `CostTracker.remaining(case_id)` is checked before each orchestrator turn. When < 20% remains, the orchestrator receives a budget warning in its context and starts preferring Tier A/B calls.
3. **Per-agency-monthly:** `AgencyLLMInstall.budget` caps monthly spend. When the cap is within 10%, the capability router hard-demotes all non-critical calls to the lowest available tier.

```python
# Estimate tokens before calling — prevents cost surprises
def estimate_call_cost(model: ModelDefinition, task: AgentTask) -> float:
    estimated_input_tokens = estimate_prompt_tokens(task)
    estimated_output_tokens = estimate_completion_tokens(task)
    return (
        (estimated_input_tokens / 1_000_000) * model.input_cost_per_million
        + (estimated_output_tokens / 1_000_000) * model.output_cost_per_million
    )
```

---

## Part 4 — Specialist SLM Fine-Tuning Pipeline

### 4.1 Overview

Eight specialist fine-tunes are planned. Each is a LoRA/QLoRA adapter trained on top of a base SLM. Training runs entirely in `tools/fine-tune/` and produces adapter artifacts that are versioned and deployed via the model registry.

**Stability note:** The base model picks (Phi-4 14B, Qwen 3.5 8B) are the most likely to need revision — model generations move fast. The training data construction approach and evaluation metrics are stable. Design against the approach, not the model name.

### 4.2 Training infrastructure

```
tools/fine-tune/
  specialists/
    calldata_decoder/
      dataset/            # training data construction scripts
      config/             # LoRA config YAML
      evaluate/           # evaluation scripts
      artifacts/          # produced adapters (git LFS)
    token_swap/
    bridge_correlator/
    entity_extractor/
    subpoena_parser/
    obfuscation_detector/
    attribution_synthesizer/
    verifier/
  common/
    data_pipeline.py      # shared dataset construction utilities
    lora_trainer.py       # HuggingFace PEFT + Unsloth wrapper
    evaluator.py          # shared evaluation harness
    registry_push.py      # push trained adapters to model registry
                          # (uploads .safetensors to Supabase Storage on SaaS Blind;
                          #  uploads to MinIO/local filesystem on On-Prem)
```

**Artifact storage (SaaS Blind v1):**
Training datasets and produced LoRA adapter `.safetensors` files are stored in **Supabase Storage**, bucket `fine-tune-artifacts`. Path convention:

```
fine-tune-artifacts/{specialist_name}/{base_model}/{run_id}/adapter_model.safetensors
fine-tune-artifacts/{specialist_name}/{base_model}/{run_id}/adapter_config.json
fine-tune-artifacts/{specialist_name}/{base_model}/{run_id}/training_dataset.jsonl
```

`registry_push.py` uploads the adapter to Supabase Storage, then writes a record to the `model_registry` table in Supabase Postgres:

```python
# tools/fine-tune/common/registry_push.py (SaaS Blind path)

import os
from supabase import create_client

def push_adapter_to_registry(
    specialist_name: str,
    base_model: str,
    run_id: str,
    adapter_path: str,
    eval_results: dict,
    storage_backend: StorageBackend,   # abstract interface — same call for MinIO
) -> str:
    """
    1. Upload adapter_model.safetensors to storage backend
    2. Write registry record to model_registry table
    Returns: registry_record_id
    """
    storage_key = f"{specialist_name}/{base_model}/{run_id}/adapter_model.safetensors"
    storage_url = storage_backend.upload(
        bucket="fine-tune-artifacts",
        key=storage_key,
        file_path=adapter_path,
    )

    # Write model_registry record (Supabase Postgres on SaaS Blind)
    record = {
        "specialist_name": specialist_name,
        "base_model": base_model,
        "run_id": run_id,
        "storage_url": storage_url,
        "eval_results": eval_results,
        "released_at": None,   # null until CLRB sign-off where required
    }
    # On-Prem: same call, different SUPABASE_URL points to customer Postgres
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    result = supabase.table("model_registry").insert(record).execute()
    return result.data[0]["id"]
```

**On-Prem:** The abstract `StorageBackend` interface is unchanged. On-Prem uses the same `registry_push.py` script with `MinIOStorageBackend` — adapters land in the customer's MinIO bucket; the `model_registry` table is in the customer's own Postgres. No code change; only the `SUPABASE_URL` / `STORAGE_BACKEND` environment variables differ.

### 4.3 Specialist 1: Calldata Decoder SLM

**Task:** Decode arbitrary EVM contract calldata into a structured action description.

**Training data source:**

- Public blockchain data: all verified contracts on Etherscan / Sourcify with their ABIs (≈ 4M verified contracts as of 2026)
- Known function selector database: 4byte.directory (≈ 900k function signatures)
- Historical decoded transactions: Dune Analytics public datasets, Allium public data
- Synthetic: generate calldata for known ABIs with random valid arguments

**Dataset construction:**

```python
# tools/fine-tune/specialists/calldata_decoder/dataset/build.py

def build_calldata_decoder_dataset() -> list[TrainingExample]:
    """
    Input: raw calldata hex string + optional contract address + chain
    Output: structured DecodedAction JSON

    Positive examples: calldata with known ABI, decoded ground truth
    Hard negatives: calldata with partial ABI, multiple selector matches
    """
    examples = []

    # Source 1: Etherscan verified ABIs + historical txs
    for contract in load_verified_contracts():
        abi = contract.abi
        for tx in load_txs_to_contract(contract.address, limit=100):
            try:
                decoded = decode_calldata(tx.input, abi)
                examples.append(TrainingExample(
                    input={"calldata": tx.input, "contract": contract.address},
                    output=decoded.to_json(),
                    source="etherscan_verified",
                    confidence=1.0,
                ))
            except DecodingError:
                pass

    # Source 2: Synthetic examples from ABI schemas
    for protocol_abi in KNOWN_PROTOCOL_ABIS:
        examples.extend(generate_synthetic_examples(protocol_abi, count=500))

    return examples
```

**Base model:** Phi-4 14B (MIT license)

**LoRA config:**

```yaml
# tools/fine-tune/specialists/calldata_decoder/config/lora.yaml
base_model: microsoft/phi-4
lora_r: 16
lora_alpha: 32
lora_dropout: 0.05
target_modules: ['q_proj', 'v_proj', 'k_proj', 'o_proj']
training:
  num_epochs: 3
  batch_size: 8
  learning_rate: 2e-4
  warmup_steps: 100
  max_seq_length: 2048
  use_unsloth: true # 2x speedup on single GPU
  gradient_checkpointing: true
  bf16: true
dataset:
  train_split: 0.9
  val_split: 0.1
  expected_examples: 100_000
```

**Evaluation metrics:**

- Field-level exact match for function_name, token addresses, amounts (as strings)
- Protocol classification accuracy (Uniswap V3 vs. V2 vs. Curve, etc.)
- Partial-ABI robustness: accuracy when only 50% of ABI is known

**Release criteria:**

- Field-level F1 ≥ 0.95 on holdout set of verified ABIs
- Partial-ABI accuracy ≥ 0.80
- Zero hallucinated token addresses not present in input
- Passes regression against the 50 canonical test transactions in the ground-truth set

---

### 4.4 Specialist 2: Token Swap Specialist

**Task:** Decode Uniswap/Curve/etc. router calldata specifically into the structured DecodedSwap schema, including multi-hop routes, slippage, fees.

**Training data:** Historical swap events from Uniswap V2/V3/V4, Curve, Balancer, 1inch, Paraswap, CoW, Raydium, Orca. Training format: calldata + event logs → DecodedSwap JSON. Target ≈ 500k examples across protocols.

**Base model:** Phi-4 14B (router calldata is complex enough to warrant the larger base)

**Key training signal:** Token path reconstruction — the hardest part of swap decoding is unrolling multi-hop encoded paths.

**Evaluation metrics:**

- Route reconstruction accuracy (exact hop sequence match): ≥ 0.97
- Amount extraction accuracy (correct decimal conversion): 1.00
- Slippage computation accuracy (vs. Math Service ground truth): 1.00
- Protocol coverage: all top-20 DEX protocols by volume

**Release criteria:** All above metrics on a 10k holdout set covering edge cases (multi-hop, aggregator routes, partial fills).

---

### 4.5 Specialist 3: Bridge Correlator SLM

**Task:** Given a source-side bridge event, match it to the destination-side event using message IDs and/or amount-timing correlation.

**Training data:**

- Historical bridge messages from LayerZero (all chains, public relayer data)
- CCTP message attestations (public Circle attestation API history)
- Wormhole VAAs (public Guardian network history)
- Across V3 deposit/fill pairs (public subgraph data)
- Negative examples: non-matching deposits of the same amount within the time window

**Base model:** Qwen 3.5 8B (high throughput; bridge correlation is repetitive)

**Training emphasis:** Hard negatives are critical — many false correlations arise from same-amount deposits in busy time windows. Oversample them.

**Evaluation metrics:**

- Message-ID match recall: ≥ 0.99
- Timing-heuristic precision: ≥ 0.90 (false correlations are costly)
- Multi-bridge (same funds through N bridges) chain reconstruction: ≥ 0.85
- False-positive rate on "same amount, different sender" negatives: < 0.05

---

### 4.6 Specialist 4: Entity Extractor SLM

**Task:** Extract structured entities (addresses, tx hashes, names, amounts, dates, account numbers) from forensic documents — subpoena returns, bank statements, victim narratives, court orders.

**Training data:**

- Public court filings from PACER (criminal crypto cases): ≈ 5k documents
- Synthetic subpoena returns generated from real exchange return format templates
- SEC enforcement action PDFs (public record): ≈ 2k documents
- Labeled extraction pairs from the ground-truth flywheel (contributed, anonymized)
- Public hack post-mortems (Rekt News, Security researchers' writeups): ≈ 1k documents

**Base model:** Phi-4 14B (document understanding is reasoning-heavy)

**Key design choice:** Training data includes bounding-box information so the model can output source location (page + bbox) for every extraction — mandatory for the Verifier's source-check.

**Evaluation metrics:**

- Token-level extraction F1: ≥ 0.97 (precision and recall balanced)
- Hallucinated extractions rate: < 0.001 (zero tolerance)
- Bounding-box accuracy (IoU ≥ 0.8): ≥ 0.95
- Cross-entity co-reference resolution (multiple mentions of same entity): ≥ 0.90

---

### 4.7 Specialist 5: Subpoena Format Parser

**Task:** Parse exchange-specific subpoena return formats into structured KYC/account data.

**Training data:** One adapter per major exchange. Exchange-specific synthetic returns modeled on the documented format of each exchange's subpoena response template. Target: 50k examples per exchange (Binance, Coinbase, Kraken, Bybit, OKX, Gate.io, KuCoin, Crypto.com, Gemini).

**Base model:** Qwen 3.5 8B

**Architecture:** This is a set of tiny format-specific adapters, not one large model. Each adapter is < 50MB.

**Evaluation:** Exact-match on every structured field for a holdout set of synthetic returns. Zero tolerance for missing mandatory fields (address, account_id, KYC_name).

---

### 4.8 Specialist 6: Obfuscation Pattern Detector

**Task:** Classify a transaction sub-graph as containing one of the known obfuscation patterns (peel chain, chain hop, token swap obfuscation, mixer entry/exit, CoinJoin, layered split-and-merge, etc.).

**Training data:**

- Labeled peel chains from public post-mortems and prior cases
- Known mixer usage patterns (Tornado Cash deposit/withdrawal correlations — public data)
- Synthetic adversarial examples generated with known ground truth
- Negative examples (not-obfuscation): normal user behavior from Etherscan/Blockchair

**Base model:** Qwen 3.5 8B

**Training format:** Sub-graph features → obfuscation_type + confidence + evidence_flags

**Evaluation metrics:**

- Per-pattern F1 ≥ 0.90
- False positive rate per pattern ≤ published F41 targets (peel chain < 0.03, mixer < 0.005)
- Novel obfuscation pattern robustness: tested against curated "unknown" examples

**Release criteria:** FPR must be verified against the F41 published targets before any release. The CLRB reviews FPR data for ML-based detectors.

---

### 4.9 Specialist 7: Attribution Synthesizer

**Task:** Given multi-provider attribution responses for the same address, synthesize a unified attribution with calibrated confidence.

**Training data:**

- Multi-provider attribution ground truth: addresses where ground truth is known (exchange deposit confirmed by subpoena, hacker addresses from post-mortems, OFAC SDN addresses)
- Provider response pairs: {Chainalysis: X, TRM: Y, ground_truth: Z} — train to predict Z and calibrated confidence
- Disagreement resolution examples: cases where providers disagreed and human investigator resolved

**Base model:** Qwen 3.5 8B

**Key training signal:** Calibration — the model must output well-calibrated confidence scores, not just accurate labels. Train with proper scoring rules.

**Evaluation metrics:**

- Attribution accuracy ≥ 0.97
- Confidence calibration (ECE ≤ 0.05)
- Disagreement detection recall ≥ 0.95

---

### 4.10 Specialist 8: Verifier SLM

**Task:** Check that every sentence in a draft output has valid citation tokens pointing to real BeliefAtoms or T0 sources. Flag sentences that lack grounding.

**Training data:**

- Synthetic: generate (draft, citation_tokens, verdict) triples
  - Positive examples: well-cited drafts
  - Negative examples: drafts with missing citations, hallucinated values, wrong citations
- Ground-truth pairs from the Narrative Agent's outputs + human review labels

**Base model:** Qwen 3.5 8B (fast, cheap, binary classification per sentence)

**Training format:** Per-sentence binary classification: "grounded" | "ungrounded" + failure reason

**Evaluation metrics:**

- Precision on "grounded" classification ≥ 0.99 (never pass an ungrounded sentence)
- Recall on "ungrounded" detection ≥ 0.95 (rare false negatives acceptable; false positives block investigator unnecessarily)
- Math-value check accuracy: detect when a number in text doesn't match Math Service output

**Release criteria:** Precision ≥ 0.99 is a hard gate. A Verifier that passes hallucinated content is worse than no Verifier.

---

## Part 5 — RAG Architecture

### 5.0 Storage and infrastructure for RAG (SaaS Blind v1)

**SaaS Blind v1:** pgvector runs inside **Supabase Postgres** — no separate vector store service is needed in Phase 0. The `rag` schema inside the Supabase project holds all four index tables.

**Embedding model:**

- SaaS Blind default: **Voyage AI** (`voyage-3` or equivalent, 1536-dimensional) via BYOK API key
- On-Prem alternative: **BGE-M3 self-hosted** (768-dimensional); same chunking pipeline, different model endpoint

**Client binding:**

- In SaaS Blind, `pgvector_search()` in `retriever.py` wraps the **`supabase-py`** client (or the Fastify API layer uses the JS Supabase client) against the `rag.*` tables.
- In On-Prem, `pgvector_search()` wraps a direct **`asyncpg`** connection with pgvector native operators.
- The `pgvector_search()` signature is identical in both deployments — callers never know which backend is used.

**Row-Level Security (RLS):** All `rag.*` tables enforce tenant isolation:

```sql
-- RLS policy on all rag schema tables (SaaS Blind only)
CREATE POLICY rag_agency_isolation ON rag.typology_index
  USING (agency_id = (auth.jwt()->>'agency_id')::uuid);
-- Same policy applied to methodology_index, jurisdiction_rules_index, prior_cases_index
```

This prevents cross-tenant retrieval bleed: an agent running in agency A's context cannot retrieve chunks indexed for agency B.

**On-Prem:** Unchanged. pgvector runs as a Postgres extension in the customer's own Postgres instance (no Supabase). MinIO or local filesystem handles any artifact storage. RLS is replaced by application-layer `WHERE agency_id = $1` filters.

---

### 5.1 The domain-grounded retrieval indexes

ChainSight's RAG layer is not general-purpose semantic search. It provides domain-specific grounding for the agents that need it. Per v0.9 Part 6 point 9 and the v1.0 stack: "Custom thin wrapper over pgvector. Not LlamaIndex."

**Four primary indexes:**

```typescript
// packages/agents/src/rag/indexes.ts

// Index 1: Typology Index
// Content: Blockchain crime typologies from FATF, Egmont Group, FinCEN,
//          Europol IOCTA, public case studies
// Chunking: 300-token semantic chunks; one chunk = one typology pattern
// Use: Narrative Agent cites established typologies; Suggestion Agent recommends
interface TypologyIndex {
  chunk_id: string;
  typology_name: string; // "peel_chain", "structuring", "layering_via_defi"
  source: string; // "FATF_2023_crypto_red_flags", "FinCEN_SAR_guidance"
  description: string;
  indicators: string[];
  embedding: number[]; // vector(1536) in Supabase pgvector (Voyage AI); vector(768) for BGE on On-Prem
  agency_id: string; // tenant isolation column; RLS policy scoped to this
  metadata: ChunkMetadata;
}

// Index 2: Methodology Index
// Content: Accounting methodology descriptions, court acceptance history,
//          jurisdiction-specific guidance, Daubert analysis
// Chunking: 400-token chunks, one methodology per major chunk
interface MethodologyIndex {
  chunk_id: string;
  methodology: AccountingMethodology;
  jurisdiction: string;
  source: string; // "D'Aloia_2024", "US_DOJ_forensic_manual"
  description: string;
  court_citations: string[]; // cases where this methodology was accepted
  embedding: number[]; // vector(1536) Voyage AI / vector(768) BGE
  agency_id: string;
}

// Index 3: Jurisdiction Rules Index
// Content: Jurisdiction-specific rules for crypto investigations,
//          legal standards, reporting requirements
// Chunking: 300-token chunks, organized by jurisdiction + topic
interface JurisdictionRulesIndex {
  chunk_id: string;
  jurisdiction: string;
  rule_type: string; // "evidence_standard", "chain_custody", "daubert"
  source: string;
  content: string;
  embedding: number[]; // vector(1536) Voyage AI / vector(768) BGE
  agency_id: string;
}

// Index 4: Prior Cases Index
// Content: Public hack post-mortems, public SEC enforcement actions,
//          published case studies with known resolution
// Chunking: 500-token chunks; one chunk = one case finding
interface PriorCasesIndex {
  chunk_id: string;
  case_name: string;
  case_type: string; // "exchange_hack", "ransomware", "pig_butchering"
  year: number;
  findings: string;
  ground_truth_outcome: string;
  embedding: number[]; // vector(1536) Voyage AI / vector(768) BGE
  agency_id: string;
}
```

### 5.2 Chunking strategy

```python
# packages/agents/src/rag/chunker.py

class ForensicsDocumentChunker:
    """
    Domain-aware chunking. Not naive fixed-window.

    Rules:
    1. Never split within a procedural step (numbered items stay together)
    2. Typology patterns: one chunk = one complete pattern description
    3. Case outcomes: always chunk to include outcome + evidence chain
    4. Overlap: 50-token sliding overlap between adjacent chunks
    5. Maximum chunk size: 512 tokens (fits in Voyage AI context)
    """

    def chunk_typology_document(self, doc: Document) -> list[Chunk]:
        # Detect pattern boundaries (numbered sections, headers)
        # Keep each pattern intact
        # Attach metadata: source, typology_name, date
        ...

    def chunk_case_document(self, doc: Document) -> list[Chunk]:
        # Keep cause → method → evidence → outcome chains intact
        # Never split an evidence chain across chunks
        ...

    def chunk_methodology_document(self, doc: Document) -> list[Chunk]:
        # Keep calculation examples intact
        # Keep court citations with their context
        ...
```

### 5.3 Retrieval strategy

Each agent that uses RAG follows a structured retrieval protocol:

```python
# packages/agents/src/rag/retriever.py

def retrieve_for_agent(
    agent_role: str,
    query: str,
    indexes: list[str],
    k: int = 5,
    rerank: bool = True,
) -> list[RetrievedChunk]:
    """
    Two-stage retrieval:
    1. Embedding similarity search (fast, broad)
    2. Cross-encoder rerank (accurate, on top-k*3)

    For forensics: precision matters more than recall.
    The grounding-check loop (below) catches any irrelevant chunks.
    """

    # Stage 1: Vector similarity
    query_embedding = embed(query, model=EMBEDDING_MODEL)
    candidates = []
    for index_name in indexes:
        results = pgvector_search(
            index=index_name,
            query_embedding=query_embedding,
            k=k * 3,  # over-retrieve for reranking
        )
        candidates.extend(results)

    if not rerank:
        return candidates[:k]

    # Stage 2: Cross-encoder rerank
    scored = []
    for chunk in candidates:
        score = cross_encoder_score(query, chunk.content)
        scored.append((score, chunk))

    scored.sort(reverse=True)
    return [chunk for _, chunk in scored[:k]]
```

### 5.4 Grounding-check loop

After retrieval, every chunk used in a prompt goes through a grounding-check before the agent output is accepted:

```python
# packages/agents/src/rag/grounding_check.py

def grounding_check(
    retrieved_chunks: list[RetrievedChunk],
    agent_output: str,
    claim_extractor: ClaimExtractor,
) -> GroundingCheckResult:
    """
    For each factual claim in the output:
    1. Extract the citation token
    2. Verify the cited chunk exists and contains the claimed information
    3. For typology claims: ensure the typology name matches the chunk
    4. For methodology claims: ensure the method description is accurate

    If any claim fails grounding: fail the check, flag for Verifier.
    """
    claims = claim_extractor.extract(agent_output)

    results = []
    for claim in claims:
        if not claim.has_citation_token:
            results.append(GroundingFailure(claim=claim, reason="missing_citation"))
            continue

        cited_chunk = find_chunk(retrieved_chunks, claim.citation_token)
        if cited_chunk is None:
            results.append(GroundingFailure(claim=claim, reason="chunk_not_retrieved"))
            continue

        if not supports_claim(cited_chunk, claim):
            results.append(GroundingFailure(claim=claim, reason="chunk_does_not_support_claim"))
            continue

        results.append(GroundingSuccess(claim=claim, chunk=cited_chunk))

    return GroundingCheckResult(
        passed=all(isinstance(r, GroundingSuccess) for r in results),
        results=results,
    )
```

### 5.5 Citation token format

Per v0.2 B6 mandate, every factual claim in AI outputs uses a structured citation token:

```
[CITE:atom:{atom_id}]               — cites a specific BeliefAtom
[CITE:tx:{tx_hash}:{field}]         — cites a specific transaction field
[CITE:doc:{doc_id}:{page}:{bbox}]   — cites a document at page + bounding box
[CITE:rag:{chunk_id}]               — cites a RAG chunk
[CITE:math:{math_call_id}]          — cites a Math Service result
[CITE:attr:{snapshot_id}:{label}]   — cites a pinned attribution snapshot
```

The Verifier resolves every citation token. Any unresolvable token is a grounding failure.

---

## Part 6 — Hallucination Mitigation Stack

The ten techniques from v0.9 Part 6, with concrete implementation for each.

### 6.1 Technique 1: Mandatory Grounding

**Implementation:** Every agent system prompt contains the citation token requirement. The Verifier rejects any output without citation tokens. This is enforced in the agent protocol at the `AgentOutput` validation layer:

```python
# packages/agents/src/validation.py

def validate_agent_output(output: AgentOutput) -> ValidationResult:
    """
    Called before every AgentOutput is written to BeliefState or returned
    to the orchestrator.
    """

    # Check 1: Any generative text must have citation tokens
    if output.has_generative_text():
        citation_check = verify_citation_tokens(output.generative_text)
        if not citation_check.passed:
            return ValidationResult(
                valid=False,
                error_code="missing_citation_tokens",
                details=citation_check.failures,
            )

    # Check 2: Every BeliefAtom emission must have provenance
    for atom in output.belief_atoms_emitted:
        if not atom.provenance:
            return ValidationResult(valid=False, error_code="atom_missing_provenance")

    # Check 3: Confidence must be within [0, 1]
    if not 0.0 <= output.output_confidence <= 1.0:
        return ValidationResult(valid=False, error_code="invalid_confidence")

    return ValidationResult(valid=True)
```

### 6.2 Technique 2: Math Service Ownership of All Numbers

**Implementation:** Every agent's system prompt contains the hard rule: "Never compute numeric values yourself." Any numeric value in an agent output that is not tagged with a `[MATH:math_call_id]` citation token is flagged by the Verifier as an ungrounded number.

The Math Service exposes a gRPC interface (per v1.0 Part 3) and is the single source of truth for:

- Taint calculations (all methodologies)
- Fee computations
- Fiat conversions (using pinned price snapshots)
- Token decimal normalization
- Confidence compound math
- Statistical aggregations

```python
# apps/math/src/service.py — illustrative

class MathService:
    """Python FastAPI service. Uses decimal.Decimal throughout — never float."""

    def compute_taint(self, request: TaintRequest) -> TaintResult:
        """All taint math. Returns exact Decimal values."""
        ...

    def compound_confidence(self, request: ConfidenceRequest) -> ConfidenceResult:
        """Compound confidence across hops. Returns Decimal."""
        ...

    def convert_fiat(self, request: FiatConversionRequest) -> FiatResult:
        """Uses pinned price snapshot. Returns Decimal with snapshot_id."""
        ...

    def compute_hop_confidence_decay(self, request: HopConfidenceRequest) -> ConfidenceResult:
        """Per-hop confidence decay formula. See Part 10."""
        ...
```

### 6.3 Technique 3: Attribution Dereference

**Implementation:** Every entity label in any agent output must dereference to a `PersonalAttribution` or a pinned provider snapshot row. No free-text entity names are permitted in court-grade outputs.

The Verifier checks citation tokens of the form `[ATTR:snapshot_id:label]`:

```python
def verify_attribution_citation(token: AttributionCitationToken) -> bool:
    snapshot = db.get_attribution_snapshot(token.snapshot_id)
    if snapshot is None:
        return False  # snapshot not found
    if token.label not in snapshot.labels:
        return False  # label not in snapshot
    if snapshot.expired_at is not None and snapshot.expired_at < now():
        return False  # snapshot expired (must refresh for non-court-grade uses)
    return True
```

### 6.4 Technique 4: Parallel Critic Agent

See Part 7 for full Critic specification. The key implementation point: the Critic is fired **asynchronously** in the orchestrator loop (see Part 1.3 `fire_critic_async`) immediately after every `belief_atoms_emitted` batch. Challenges appear in the orchestrator's next context build.

### 6.5 Technique 5: Verifier on Every Generative Output

See Part 8 for full Verifier specification. Every call to the Narrative Agent, Inspector summary, Suggestion Agent, and any other text-generating agent is gated through the Verifier before the output reaches the investigator.

### 6.6 Technique 6: Self-Consistency Checks

**Implementation:** For high-stakes decisions (bridge correlation, complex attribution), the orchestrator can request parallel runs with different sampling seeds and compare:

```python
# packages/agents/src/consistency_check.py

async def consistency_check(
    agent: Agent,
    task: AgentTask,
    n_samples: int = 3,
    agreement_threshold: float = 0.8,
) -> ConsistencyCheckResult:
    """
    Run the same task N times (with temperature > 0) and check for agreement.
    Used for: bridge correlation, attribution synthesis, narrative key claims.
    NOT used for: deterministic extraction (no benefit), cheap Tier A calls (cost).
    """
    results = await asyncio.gather(*[
        agent.run(task, seed=i) for i in range(n_samples)
    ])

    agreement_score = compute_semantic_agreement(results)

    if agreement_score < agreement_threshold:
        return ConsistencyCheckResult(
            consistent=False,
            disagreement_details=extract_disagreements(results),
            recommended_action="escalate_to_tier_c",
        )

    return ConsistencyCheckResult(
        consistent=True,
        consensus_output=majority_vote(results),
        agreement_score=agreement_score,
    )
```

### 6.7 Technique 7: Confidence Scoring at Every Step

See Part 10 for the full confidence calculus. At the implementation level: every `BeliefAtomEmission` carries a confidence value computed by the Math Service's `compound_confidence` function, not estimated by the LLM.

### 6.8 Technique 8: Atomic Claim Verification

**Implementation:** Before a narrative draft is assembled, the Narrative Agent's output is decomposed into atomic claims and each claim is verified independently:

```python
# packages/agents/src/atomic_claim_verifier.py

def verify_atomic_claims(
    draft: str,
    belief_context: BeliefContextSlice,
    math_service: MathServiceClient,
) -> AtomicClaimVerificationResult:
    """
    Decompose a narrative draft into atomic claims.
    Verify each independently against BeliefState + Math Service.
    Return any failed claims for Verifier to flag.
    """

    # Decompose into atomic claims (one fact per claim)
    claims = decompose_into_atomic_claims(draft)

    results = []
    for claim in claims:
        if claim.is_numeric:
            # Numeric claim: must match Math Service output
            math_check = verify_against_math_service(claim, math_service)
            results.append(math_check)
        elif claim.is_attribution:
            # Attribution claim: must dereference to pinned snapshot
            attr_check = verify_attribution(claim, belief_context)
            results.append(attr_check)
        else:
            # Factual claim: must cite a BeliefAtom
            atom_check = verify_against_belief_state(claim, belief_context)
            results.append(atom_check)

    return AtomicClaimVerificationResult(
        all_verified=all(r.verified for r in results),
        failed_claims=[r for r in results if not r.verified],
    )
```

### 6.9 Technique 9: Domain-Grounded RAG

Per Part 5 above. Every agent that produces court-grade outputs uses the retrieval indexes to ground claims in established typologies, methodologies, and prior cases.

### 6.10 Technique 10: Continuous Regression

Per Part 9 (Evaluation Harness). Nightly regression against the ground-truth flywheel; any model swap or fine-tune that regresses headline metrics blocks deploy.

---

## Part 7 — The Critic Agent in Detail

### 7.1 Architectural position: peer, not post-process

The Critic is a peer agent running in parallel with (not after) every investigation specialist. Per v0.2 B5: the AI argues with itself before the investigator sees a conclusion.

In the orchestrator loop, the Critic is fired asynchronously on every batch of emitted BeliefAtoms. The investigator never sees an unreviewed atom — the Critic's verdict (no issues, open challenges) appears in the Inspector's Section 7 and in the case's Challenge sidebar.

### 7.2 Critic invocation

```python
# packages/agents/src/critic.py

CRITIC_SYSTEM_PROMPT = """
You are the ChainSight Adversarial Critic. Your job is to challenge every
conclusion the investigation has reached, looking for:
1. Alternative explanations the tracer didn't consider
2. Low-quality provenance (single-source attribution, heuristic-only conclusions)
3. Logical gaps in the chain of reasoning
4. Known false-positive patterns for this type of evidence
5. Base-rate implausibility (is this conclusion reasonable without anchoring?)
6. Internal inconsistencies across multiple BeliefAtoms
7. Adversarial robustness: what would a defense attorney attack?

Your output is a list of Challenges. A Challenge is NOT a rejection — it is
a specific, falsifiable objection that requires a response before the atom
can reach court_grade status.

For each atom you review:
- Score it on five axes (see below)
- If any axis score < 0.7, emit a Challenge
- If a hard-block condition is met, emit a HardChallenge (blocks entirely)

HARD-BLOCK CONDITIONS (emit HardChallenge):
- Numeric claim without Math Service citation
- Attribution without pinned snapshot reference
- T3 atom being relied upon as sole basis for court_grade promotion
- Confidence > 0.95 on a heuristic-only (T1/T3) derivation chain

You use temperature 0.9 (higher than other agents) to maximize adversarial
creativity. Your model defaults to Tier C because you must catch what lower-tier
models miss.
"""

CRITIC_SCORING_AXES = [
    "provenance_quality",        # 0.0-1.0: how strong is the source chain?
    "alternative_explanation",   # 0.0-1.0: 1.0 = no good alternative; 0.0 = many
    "base_rate_plausibility",    # 0.0-1.0: is this common or unusual?
    "internal_consistency",      # 0.0-1.0: consistent with other atoms?
    "adversarial_robustness",    # 0.0-1.0: survives defense counsel's attack?
]

async def run_critic(
    atoms: list[BeliefAtom],
    case_id: str,
    config: CriticConfig,
    belief_client: BeliefStateClient,
) -> CriticResult:
    """
    Runs in parallel with the orchestrator loop.
    Called immediately after each batch of BeliefAtoms is emitted.
    """

    client = anthropic.Anthropic()
    model = config.model_router.resolve_for_role("critic", config)

    # Build the critic's context: the atoms to review + case context
    context = build_critic_context(atoms, case_id, belief_client)

    response = client.messages.create(
        model=model.id,
        max_tokens=2000,
        system=CRITIC_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"""
Review the following BeliefAtoms for the investigation case {case_id}.

BeliefAtoms to review:
{format_atoms_for_critic(atoms)}

Case context:
{context.summary}

Prior open challenges (do not duplicate):
{format_challenges(context.open_challenges)}

For each atom, provide:
1. Axis scores (provenance_quality, alternative_explanation, base_rate_plausibility,
   internal_consistency, adversarial_robustness)
2. Any Challenges (if axis score < 0.7)
3. Any HardChallenges (if hard-block conditions met)
4. Overall recommendation: no_issues | soft_challenges | hard_block

Output as JSON matching the CriticResult schema.
"""
        }],
    )

    critic_result = parse_critic_response(response.content[0].text)

    # Write challenges to the Belief State
    for challenge in critic_result.challenges:
        belief_client.write_challenge(case_id, challenge)

    return critic_result
```

### 7.3 The Challenge object

```typescript
// packages/belief-state/src/challenge.ts

interface Challenge {
  id: string; // UUID
  case_id: string;
  target_atom_id: string; // the atom being challenged
  challenge_type: 'soft' | 'hard';

  // Scoring
  axis_scores: Record<string, number>; // five axes
  overall_score: number; // mean of axes

  // The challenge content
  objection: string; // specific, falsifiable objection
  alternative_explanation: string | null; // alternative the critic sees
  recommended_resolution: string; // what would resolve this challenge

  // Adversarial patterns checked
  patterns_checked: string[]; // e.g. "coinjoin_false_positive", "bridge_front_running"
  known_fp_pattern_hit: boolean;

  // Lifecycle
  status: 'open' | 'resolved' | 'dismissed' | 'escalated';
  resolution: ChallengeResolution | null;
  created_at: string;
  created_by: 'critic_agent';
  resolved_at: string | null;
  resolved_by: string | null;
}

interface ChallengeResolution {
  method: 'additional_evidence' | 'methodology_change' | 'retraction' | 'dismissed_with_rationale';
  rationale: string;
  supporting_evidence: string[];
  resolved_by: string; // investigator or orchestrator
}
```

### 7.4 Challenge flow into Belief State

A hard challenge blocks the atom from being promoted to `court_grade`. A soft challenge appears in the Inspector's Section 7 and in the case's Challenge sidebar without blocking. The investigator can:

- **Resolve with evidence:** provide additional evidence that addresses the challenge
- **Dismiss with rationale:** document why the challenge doesn't apply
- **Escalate:** send to the Orchestrator + Tier C for deeper analysis

Court-grade promotion requires zero open hard challenges and all soft challenges either resolved or documented.

### 7.5 Adversarial pattern library

The Critic is initialized with a library of known false-positive patterns that it checks against every applicable atom:

```python
CRITIC_ADVERSARIAL_PATTERNS = {
    "coinjoin_false_positive": {
        "description": "CIH applied to a CoinJoin transaction incorrectly merges unrelated clusters",
        "check": lambda atom: atom.tier == "T1" and atom.derivation_method == "cih" and
                              is_likely_coinjoin(atom.evidence_tx),
        "severity": "hard",
    },
    "bridge_amount_collision": {
        "description": "Multiple bridge deposits of same amount in same time window; correlation may be wrong",
        "check": lambda atom: atom.predicate == "bridge_correlated" and
                              atom.match_method == "timing_heuristic",
        "severity": "soft",
    },
    "peel_chain_false_positive": {
        "description": "Detected peel chain pattern may be legitimate payment batching",
        "check": lambda atom: atom.predicate == "obfuscation_detected" and
                              atom.finding_type == "peel_chain",
        "severity": "soft",
    },
    "mixer_adjacent_innocent": {
        "description": "Address has received funds that passed through mixer, not necessarily mixer user",
        "check": lambda atom: "mixer_adjacent" in atom.tags,
        "severity": "soft",
    },
    "exchange_omnibus_commingling": {
        "description": "Taint through an exchange omnibus address may reflect commingling with innocent users",
        "check": lambda atom: atom.predicate == "received_taint_from" and
                              is_likely_exchange_omnibus(atom.subject_ref),
        "severity": "hard",
    },
}
```

---

## Part 8 — The Verifier Agent in Detail

### 8.1 Role and position

The Verifier is the last gate before any AI-generated text reaches the investigator. It is a small specialist SLM (Qwen 3.5 8B with Verifier LoRA) that runs citation-token enforcement: every sentence in a draft must have a valid, resolvable citation token, or it is flagged for human authorship.

The Verifier does not rewrite. It only flags. The investigator sees flagged sentences clearly, writes them manually, and the Verifier re-checks only the replaced sentences.

### 8.2 Verifier invocation

```python
# packages/agents/src/verifier.py

VERIFIER_SYSTEM_PROMPT = """
You are the ChainSight Verifier. Your only job is to check that every
factual sentence in the provided draft cites a valid source.

GROUNDING RULES:
1. Every sentence containing a fact (name, address, amount, date,
   classification) MUST contain at least one citation token.
2. Citation token formats:
   [CITE:atom:{id}]        — BeliefAtom
   [CITE:tx:{hash}:{field}] — transaction field
   [CITE:doc:{id}:{page}]  — document
   [CITE:rag:{chunk_id}]   — RAG chunk
   [CITE:math:{call_id}]   — Math Service result
   [ATTR:{snapshot}:{label}] — attribution snapshot
3. A sentence like "The funds moved to Binance" is UNGROUNDED unless it has
   [ATTR:...] for "Binance" AND [CITE:atom:...] for the fund movement.
4. A sentence like "0.5 ETH" is UNGROUNDED unless it has [CITE:math:...].
5. Introductory phrases ("This investigation examined...") are GROUNDED by default.
6. Citation tokens must reference resources in the provided context.
   You cannot verify external resources.

For each sentence: return { sentence_index, grounded: bool, reason: str }.
If a sentence is grounded, reason = "ok".
If ungrounded, reason = specific failure type.
"""

def run_verifier(
    draft: str,
    belief_context: BeliefContextSlice,
    math_calls: list[MathServiceCall],
    doc_context: list[DocumentRef],
    config: VerifierConfig,
) -> VerifierResult:
    """
    Sentence-level verification.
    Returns passed sentences and flagged sentences.
    """

    sentences = split_into_sentences(draft)

    # Resolve all citation tokens in the draft against available context
    available_resources = {
        "atoms": {a.id: a for a in belief_context.atoms},
        "math_calls": {m.id: m for m in math_calls},
        "docs": {d.id: d for d in doc_context},
    }

    # Run the Verifier SLM
    client = get_slm_client(config.verifier_model)

    response = client.generate(
        prompt=build_verifier_prompt(sentences, available_resources),
        max_tokens=500,
        temperature=0.0,   # Verifier must be deterministic
    )

    verdicts = parse_verifier_response(response)

    return VerifierResult(
        passed_sentences=[s for s, v in zip(sentences, verdicts) if v.grounded],
        flagged_sentences=[
            FlaggedSentence(
                sentence=s,
                sentence_index=v.sentence_index,
                reason=v.reason,
                replacement_guidance="Please write this sentence manually, citing a specific source.",
            )
            for s, v in zip(sentences, verdicts) if not v.grounded
        ],
        overall_pass=all(v.grounded for v in verdicts),
        grounding_rate=sum(1 for v in verdicts if v.grounded) / len(verdicts),
    )
```

### 8.3 How Verifier gates report drafts

The investigator flow when Verifier finds issues:

1. Narrative Agent produces draft
2. Verifier runs → 3 sentences flagged
3. Investigator sees: full draft with flagged sentences highlighted in yellow and marked `⚠ needs citation`
4. Investigator can: (a) write a replacement sentence, (b) edit the AI draft to add citations, (c) mark as "human-authored" (bypasses Verifier for that sentence but records the human override)
5. On save, Verifier re-checks only the changed sentences
6. Final report: every sentence either (a) passed Verifier or (b) is marked `[HUMAN-AUTHORED]` in the audit log

### 8.4 Atomic claim decomposition

For complex sentences, the Verifier first decomposes before checking:

```python
def decompose_complex_sentence(sentence: str) -> list[AtomicClaim]:
    """
    "On August 12, address 0xabc transferred 1.5 ETH to the Binance hot wallet"
    → three atomic claims:
      1. date assertion: August 12
      2. transfer assertion: 0xabc → 1.5 ETH
      3. attribution assertion: Binance hot wallet
    Each claim must be grounded independently.
    """
    ...
```

---

## Part 9 — Evaluation Harness

### 9.1 The ground-truth flywheel architecture

Per v0.2 B7, the evaluation harness is part of the codebase, not an afterthought:

```
tools/eval/
  ground_truth/
    public_hacks/       # canonical test cases from public incidents
      bybit_2025/
      ronin_2022/
      wormhole_2022/
      nomad_2022/
      ftx_2022/
      bitfinex_2016/
      poly_network_2021/
      euler_2023/
      tornado_sanctions/
    synthetic/          # generated adversarial scenarios
      peel_chain_known_endpoint/
      coinjoin_with_known_resolution/
      bridge_spoofing/
      mixer_temporal_correlation/
    closed_cases/       # investigator-validated, anonymized
      case_001/
      case_002/
      ...
  harness/
    regression_runner.py
    metrics.py
    report_generator.py
  ci/
    nightly_regression.yml    # GitHub Actions workflow
    model_swap_validation.yml # triggered on model config change
```

### 9.2 Public hacks as canonical test cases

Each public hack is a canonical test case with:

- **Seed IOCs:** the known attacker/victim addresses
- **Expected trace path:** the documented fund flow
- **Expected attributions:** known exchange deposits confirmed by the incident
- **Expected obfuscation patterns:** documented mixing/bridging from post-mortems
- **Ground-truth outcome:** documented recovery/seizure result

```python
# tools/eval/ground_truth/public_hacks/bybit_2025/case.py

BYBIT_2025_CASE = GroundTruthCase(
    name="Bybit 2025 Hack",
    seed_iocs=[
        IOC(value="0x...", chain="ethereum", type="attacker_address"),
        # ... from public post-mortem
    ],
    expected_path_edges=[
        PathEdge(from_addr="0x...", to_addr="0x...", chain="ethereum"),
        # ... full documented path
    ],
    expected_attributions=[
        Attribution(address="0x...", label="Binance hot wallet"),
        # ... from public post-mortem
    ],
    expected_obfuscation_patterns=["chain_hop", "token_swap_obfuscation"],
    ground_truth_outcome="~$1.4B moved via layered cross-chain hops; significant portion frozen",
    source_url="https://rekt.news/bybit-rekt/",
)
```

### 9.3 Nightly regression CI

The regression CI runs on **GitHub Actions** using a **self-hosted runner** (sensitive workloads — matches the v1.0 Part 3 DevOps pick; eval harness may touch real case data paths). Results are written to `tools/eval/results/` and also inserted into **Supabase Postgres** (`eval_run_results` table) so the ops dashboard has live visibility into metric drift.

```yaml
# tools/eval/ci/nightly_regression.yml

name: Nightly Regression
on:
  schedule:
    - cron: '0 3 * * *' # 3 AM UTC
  workflow_dispatch: # manual trigger

jobs:
  regression:
    runs-on: self-hosted # self-hosted GitHub Actions runner (sensitive workload)
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
    steps:
      - uses: actions/checkout@v4

      - name: Run full ground-truth harness
        run: |
          python tools/eval/harness/regression_runner.py \
            --ground-truth-dir tools/eval/ground_truth \
            --config tools/eval/harness/config.yaml \
            --output tools/eval/results/$(date +%Y%m%d).json

      - name: Check against metric targets
        run: |
          python tools/eval/harness/check_regression.py \
            --results tools/eval/results/$(date +%Y%m%d).json \
            --baseline tools/eval/results/baseline.json \
            --fail-on-regression 0.005  # 0.5% regression threshold

      - name: Persist results to Supabase
        if: always()
        run: |
          python tools/eval/harness/persist_results.py \
            --results tools/eval/results/$(date +%Y%m%d).json
          # Inserts into eval_run_results table in Supabase Postgres
          # Schema: eval_run_results(run_id, run_date, metrics jsonb,
          #          regression_detected bool, baseline_delta jsonb)

      - name: Post results to Slack
        if: always()
        run: python tools/eval/harness/notify.py
```

The model swap validation workflow (`model_swap_validation.yml`) also runs on GitHub Actions (self-hosted) and follows the same `persist_results.py` path — both workflows write to `eval_run_results`.

**Supabase Postgres tables for the AI/eval layer (SaaS Blind v1):**

| Table              | Content                                                   | Written by                 |
| ------------------ | --------------------------------------------------------- | -------------------------- |
| `agent_calls`      | Every `AgentCall` record (Part 12 cost telemetry)         | API layer / BullMQ workers |
| `model_cards`      | `ModelCard` records per agent call (Reproducibility Pack) | Agent protocol layer       |
| `eval_run_results` | Nightly regression + model swap results                   | GitHub Actions CI          |
| `model_registry`   | Fine-tuned adapter records (Part 4)                       | `registry_push.py`         |

**Fly.io / self-hosted inference note (SaaS Blind):**
For SaaS Blind **Phase 0**, no vLLM or Ollama instance is deployed on Fly.io. Phase 0 uses BYOK frontier APIs exclusively (Claude Opus 4.6 via Anthropic API, DeepSeek V4 Pro via API). Fly.io hosting of vLLM/Ollama inference is a **Phase 2+ option** for SaaS Blind, when self-hosted Tier A specialists become cost-justified by case volume. On-Prem is unchanged: customer runs vLLM or Ollama on their own GPU hardware from day one.

### 9.4 The seven headline metrics (v0.2 B7)

```python
# tools/eval/harness/metrics.py

HEADLINE_METRICS = {
    "trace_recall": MetricDefinition(
        description="% of ground-truth path edges recovered",
        target=0.95,
        threshold=0.005,   # fail if regression > 0.5%
        compute=lambda results: compute_recall(
            predicted=results.recovered_edges,
            ground_truth=results.expected_edges,
        ),
    ),
    "trace_precision": MetricDefinition(
        description="% of recovered edges that are correct",
        target=0.98,
        threshold=0.005,
        compute=lambda results: compute_precision(
            predicted=results.recovered_edges,
            ground_truth=results.expected_edges,
        ),
    ),
    "attribution_accuracy": MetricDefinition(
        description="% entity labels correct vs. ground truth",
        target=0.97,
        threshold=0.005,
        compute=lambda results: compute_attribution_accuracy(results),
    ),
    "reproducibility": MetricDefinition(
        description="Identical output on replay",
        target=1.000,
        threshold=0.0,     # any regression = fail
        compute=lambda results: compute_replay_identity(results),
    ),
    "methodology_consistency": MetricDefinition(
        description="Identical math across two runs of same method",
        target=1.000,
        threshold=0.0,
        compute=lambda results: compute_methodology_consistency(results),
    ),
    "court_grade_rate": MetricDefinition(
        description="% atoms qualifying for court_grade flag",
        target=None,       # tracked, not targeted
        threshold=None,
        compute=lambda results: results.court_grade_atoms / results.total_atoms,
    ),
    "critic_catch_rate": MetricDefinition(
        description="% of seeded errors the Critic flags",
        target=0.90,
        threshold=0.005,
        compute=lambda results: compute_critic_catch_rate(results),
    ),
}
```

### 9.5 Model swap validation

When the agency changes a model assignment (e.g., swaps Claude Opus 4.6 for Claude Opus 4.7), a model swap validation run is triggered:

```python
# tools/eval/harness/model_swap_validation.py

def validate_model_swap(
    prior_model: ModelDefinition,
    new_model: ModelDefinition,
    role: str,
    test_cases: list[GroundTruthCase],
) -> ModelSwapValidation:
    """
    Run a subset of ground-truth cases with both models.
    Report: does the new model regress on any headline metric?
    Block deploy if regression > threshold.
    """

    prior_results = run_cases(prior_model, test_cases, role=role)
    new_results = run_cases(new_model, test_cases, role=role)

    regressions = []
    for metric_name, metric in HEADLINE_METRICS.items():
        if metric.threshold is None:
            continue
        delta = metric.compute(new_results) - metric.compute(prior_results)
        if delta < -metric.threshold:
            regressions.append(MetricRegression(
                metric=metric_name,
                prior=metric.compute(prior_results),
                new=metric.compute(new_results),
                delta=delta,
                threshold=metric.threshold,
            ))

    return ModelSwapValidation(
        approved=len(regressions) == 0,
        regressions=regressions,
        new_model_metrics={m: metric.compute(new_results) for m, metric in HEADLINE_METRICS.items()},
    )
```

---

## Part 10 — Confidence Calculus

### 10.1 The core formula

Per v0.2 B4: compound confidence correctly. Not just multiplication.

```python
# apps/math/src/confidence.py

from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from dataclasses import dataclass

CONFIDENCE_FLOOR = Decimal("0.60")  # per B4 hard floor

HopEvidenceClass = Literal["T0", "T1", "T2", "T3"]

@dataclass
class HopConfidence:
    p_correct: Decimal           # raw probability [0, 1]
    evidence_class: HopEvidenceClass
    method: str                  # "utxo_direct", "cih", "attribution", "bridge_msg_id", etc.
    independent_sources: int     # number of independent corroborating sources

@dataclass
class PathConfidence:
    cumulative_p: Decimal
    lower_bound: Decimal         # 95th percentile lower bound
    upper_bound: Decimal
    weakest_hop: int
    weakest_hop_p: Decimal
    below_floor: bool            # True if cumulative < 0.60

def compound_hop_confidence(hops: list[HopConfidence]) -> PathConfidence:
    """
    Compound confidence across hops, method-aware.

    The naive product (p1 * p2 * ... * pN) understates confidence
    when hops use independent evidence and overstates when they share
    the same weak evidence base.

    Method-aware combination rules:
    - T0 (UTXO direct / Transfer log): multiplicative independence —
      p_compound = product(p_i)
    - T1 (CIH / known rule): multiplicative with clustering penalty —
      p_compound = product(p_i) * clustering_confidence_factor
    - T2 (attribution): gated by source agreement —
      p_compound reduced by (1 - attribution_agreement_score)
    - T3 (ML/LLM inference): Bayesian update from prior —
      treated as evidence-of-quality rather than direct probability
    """

    if not hops:
        return PathConfidence(
            cumulative_p=Decimal("1.0"),
            lower_bound=Decimal("1.0"),
            upper_bound=Decimal("1.0"),
            weakest_hop=0,
            weakest_hop_p=Decimal("1.0"),
            below_floor=False,
        )

    # Compound by method
    compound_p = Decimal("1.0")
    for hop in hops:
        if hop.evidence_class == "T0":
            # Direct on-chain proof: multiplicative
            compound_p *= hop.p_correct

        elif hop.evidence_class == "T1":
            # Heuristic rule: multiplicative with small penalty for rule uncertainty
            rule_uncertainty = Decimal("0.02")  # 2% for rule version risk
            compound_p *= (hop.p_correct - rule_uncertainty)

        elif hop.evidence_class == "T2":
            # Attribution: depends on source agreement
            source_agreement = compute_source_agreement(hop)
            # Multi-source corroboration boosts; single source decays
            if hop.independent_sources >= 3:
                boost = Decimal("1.02")
                compound_p *= min(hop.p_correct * boost, Decimal("1.0"))
            elif hop.independent_sources == 2:
                compound_p *= hop.p_correct
            else:
                # Single source: apply agreement penalty
                compound_p *= hop.p_correct * source_agreement

        elif hop.evidence_class == "T3":
            # ML/LLM inference: more conservative decay
            t3_penalty = Decimal("0.85")  # 15% penalty for AI uncertainty
            compound_p *= hop.p_correct * t3_penalty

    # Compute uncertainty bounds using Wilson interval approximation
    n_effective = compute_effective_samples(hops)
    margin = compute_confidence_margin(compound_p, n_effective)
    lower = max(Decimal("0.0"), compound_p - margin)
    upper = min(Decimal("1.0"), compound_p + margin)

    # Find weakest hop
    weakest_idx = min(range(len(hops)), key=lambda i: hops[i].p_correct)

    # Apply hard floor
    below_floor = compound_p < CONFIDENCE_FLOOR

    return PathConfidence(
        cumulative_p=compound_p.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        lower_bound=lower.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        upper_bound=upper.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        weakest_hop=weakest_idx,
        weakest_hop_p=hops[weakest_idx].p_correct,
        below_floor=below_floor,
    )


def per_hop_confidence(
    tx_hash: str,
    evidence_class: HopEvidenceClass,
    method: str,
    independent_sources: int,
    base_p: Decimal,
) -> HopConfidence:
    """
    Compute confidence for a single hop.

    Base confidence by evidence class and method:
    - T0, Transfer log (EVM): 0.99
    - T0, UTXO direct spend: 0.999
    - T1, CIH standard: 0.92
    - T1, CIH with CoinJoin risk: 0.75
    - T1, Change detection optimal: 0.85
    - T1, Bridge message_id: 0.97
    - T1, Bridge timing heuristic: 0.65
    - T2, Multi-source attribution (n≥3): 0.95
    - T2, Single-source attribution: 0.80
    - T3, ML obfuscation detection: 0.75
    - T3, LLM inference: 0.65

    Callers provide base_p from the above table; this function applies
    additional adjustments (e.g., number of independent sources).
    """
    return HopConfidence(
        p_correct=base_p,
        evidence_class=evidence_class,
        method=method,
        independent_sources=independent_sources,
    )
```

### 10.2 Confidence visualization

The confidence calculation feeds directly into the canvas rendering. Every edge in the trace graph has a visual confidence indicator:

- ≥ 0.95: solid, full-color edge
- 0.85–0.95: slightly desaturated
- 0.70–0.85: more desaturated
- 0.60–0.70: dashed edge (near the floor)
- < 0.60: "investigative lead" section, not shown as a primary finding

### 10.3 Hard floor enforcement

```python
# packages/belief-state/src/promotion.py

def can_promote_to_court_grade(atom: BeliefAtom) -> PromotionCheck:
    """
    Checks all conditions required before an atom can reach court_grade status.
    The hard confidence floor is enforced here.
    """
    checks = []

    # Hard floor: cumulative confidence ≥ 0.60
    if atom.confidence < float(CONFIDENCE_FLOOR):
        checks.append(PromotionBlock(
            reason="confidence_below_floor",
            detail=f"Confidence {atom.confidence:.3f} < {CONFIDENCE_FLOOR} floor",
            blocking=True,
        ))

    # T3 cannot be sole basis
    if atom.tier == "T3" and not has_corroborating_T0_T1_T2(atom):
        checks.append(PromotionBlock(
            reason="t3_sole_basis",
            detail="T3 atom requires corroboration from T0/T1/T2",
            blocking=True,
        ))

    # Must have investigator signoff_id (D1 lock)
    if atom.predicate in ATTRIBUTION_PREDICATES and not atom.signoff_id:
        checks.append(PromotionBlock(
            reason="missing_signoff",
            detail="Court-grade attributions require investigator signoff (D1 lock)",
            blocking=True,
        ))

    # No open hard challenges
    if has_open_hard_challenges(atom):
        checks.append(PromotionBlock(
            reason="open_hard_challenges",
            detail="Resolve all open hard challenges before court-grade promotion",
            blocking=True,
        ))

    return PromotionCheck(
        approved=not any(c.blocking for c in checks),
        blocks=checks,
    )
```

---

## Part 11 — AI Toggle Implementation

### 11.1 The four-level hierarchy

Per v0.9 Part 4: AI can be disabled at four granularities. This is enforced at the capability router level — not just the UI.

```typescript
// packages/capability-router/src/ai_toggle.ts

interface AIToggleState {
  agency_global: boolean; // Level 1: the master switch
  role_toggles: Record<string, boolean>; // Level 2: per-agent-role
  case_override: boolean | null; // Level 3: per-case override (null = use agency default)
  require_action_confirmation: Record<string, boolean>; // Level 4: per high-impact action
}

// The toggle state is resolved at each agent invocation
function resolveToggleForCall(
  agentRole: string,
  caseId: string,
  actionType: string,
  toggleState: AIToggleState,
): ToggleResolution {
  // Level 1: Agency global
  if (!toggleState.agency_global) {
    return { enabled: false, reason: 'agency_ai_disabled' };
  }

  // Level 3: Case override (takes precedence over role toggles)
  if (toggleState.case_override !== null) {
    if (!toggleState.case_override) {
      return { enabled: false, reason: 'case_ai_disabled' };
    }
  }

  // Level 2: Role toggle
  const roleEnabled = toggleState.role_toggles[agentRole] ?? true;
  if (!roleEnabled) {
    return { enabled: false, reason: `role_${agentRole}_disabled` };
  }

  // Level 4: Action confirmation required
  if (toggleState.require_action_confirmation[actionType]) {
    return {
      enabled: true,
      requires_confirmation: true,
      confirmation_prompt: buildConfirmationPrompt(agentRole, actionType),
    };
  }

  return { enabled: true };
}
```

### 11.2 Non-AI fallback behaviors

When AI is off (at any level), the platform must still function. Per v0.9 Part 4.1:

```typescript
// packages/agents/src/fallbacks.ts

// Maps each agent role to its non-AI fallback behavior
const NON_AI_FALLBACKS: Record<string, FallbackBehavior> = {
  orchestrator: {
    behavior: 'manual_investigation_mode',
    description: 'Investigators trace manually hop-by-hop; no autonomous tracing',
    ui_message: 'AI assistance disabled. Use the manual trace controls.',
    available_features: ['manual_hop_expand', 'belief_state_read', 'math_service'],
  },
  narrative: {
    behavior: 'structured_template',
    description: 'Structured fill-in template with placeholder sections',
    ui_message: 'AI drafting disabled. Complete the structured report template.',
    available_features: ['template_fill', 'belief_state_citations'],
  },
  suggestion: {
    behavior: 'hidden',
    description: 'Suggestion sidebar is hidden; no empty placeholder shown',
    ui_message: null, // no message; just hide the sidebar
    available_features: [],
  },
  critic: {
    behavior: 'human_review_prompt',
    description: 'Challenges are surfaced as raw signals for human review',
    ui_message: 'AI Critic disabled. Manual review of all conclusions recommended.',
    available_features: ['manual_challenge_entry'],
  },
  attribution: {
    behavior: 'provider_only',
    description: 'Show raw provider attribution without synthesis',
    ui_message: 'AI attribution synthesis disabled. Showing raw provider responses.',
    available_features: ['provider_attribution_display', 'personal_attribution'],
  },
  verifier: {
    behavior: 'skip_with_warning',
    description: 'Drafts are unverified; shown with prominent warning',
    ui_message: '⚠ Verifier disabled. This draft has not been citation-checked.',
    available_features: [],
  },
  inspector_summary: {
    behavior: 'sections_1_2_only',
    description: 'Inspector shows structured facts only; no plain-language summary',
    ui_message: 'AI summary unavailable (disabled); see structured facts below.',
    available_features: ['structured_facts', 'decoded_action_deterministic'],
  },
  extraction: {
    behavior: 'manual_review_queue',
    description: 'Documents uploaded to manual review queue without AI extraction',
    ui_message: 'AI extraction disabled. Review extracted fields manually.',
    available_features: ['document_viewer', 'manual_entity_entry'],
  },
};
```

### 11.3 Always-human actions (regardless of toggle)

Per v0.9 Part 4.2 — these cannot be AI-driven at any toggle state:

```python
ALWAYS_HUMAN_ACTIONS = frozenset([
    "court_grade_attribution_promotion",   # requires signoff_id (D1 lock)
    "freeze_request_submission",           # requires supervisor approval per F27
    "seizure_recommendation",              # requires supervisor approval
    "public_attribution_disclosure",       # explicit human action required
    "final_report_signoff",               # investigator signature required
    "path_finalization",                  # investigator finalizes
])

def check_always_human(action_type: str) -> None:
    """Raises if action_type is in ALWAYS_HUMAN_ACTIONS."""
    if action_type in ALWAYS_HUMAN_ACTIONS:
        raise AlwaysHumanActionError(
            f"Action '{action_type}' is always human-only. "
            f"AI cannot execute this regardless of toggle state. (F41/D1 lock)"
        )
```

---

## Part 12 — Cost Telemetry

### 12.1 The cost tracking data model

**Persistence (SaaS Blind v1):** `AgentCall` records are written to the `agent_calls` table in **Supabase Postgres**. `ModelCard` records (used in Reproducibility Packs) are written to the `model_cards` table. Both tables are keyed by `agency_id` and RLS-isolated per tenant. On-Prem: same tables in the customer's own Postgres.

```typescript
// packages/shared-types/src/cost_telemetry.ts

interface AgentCall {
  id: string;
  case_id: string;
  agent_name: string;
  model_card_id: string;
  provider_id: string;

  // Token counts
  input_tokens: number;
  output_tokens: number;

  // Cost
  cost_usd: number; // 0 for self-hosted models
  cost_local_electricity_kwh: number | null; // for self-hosted, estimate

  // Attribution
  orchestrator_run_id: string;
  task_type: string;

  // Timing
  ts: string; // ISO 8601
  duration_ms: number;

  // Success
  status: 'success' | 'failed' | 'skipped_ai_off';
}

// Cost rollups (computed nightly, stored for dashboard)
interface CostRollup {
  period: 'day' | 'week' | 'month';
  period_start: string;
  agency_id: string;

  by_role: Record<string, number>; // cost per agent role
  by_case: Record<string, number>; // cost per case
  by_provider: Record<string, number>; // cost per LLM provider
  by_tier: Record<'A' | 'B' | 'C', number>; // cost per tier

  total_external_cost_usd: number;
  total_local_electricity_cost_usd: number; // estimate

  // Comparison
  what_all_frontier_would_have_cost: number; // hypothetical
  savings_from_tier_strategy: number;
}
```

### 12.2 The pre-call cost estimator

Per v0.9 Part 3.4 and the Refresh button cost estimate UX (v0.6 F9.5), every expensive operation shows a cost estimate before execution:

```python
# packages/cost/src/estimator.py

def estimate_operation_cost(
    operation: OperationType,
    inputs: dict,
    model_config: AgencyLLMConfig,
    cache_state: CacheState,
) -> CostEstimate:
    """
    Called before any operation that will incur meaningful LLM cost.
    Used by:
    - The Refresh button UX
    - The "Run autonomous trace" confirmation dialog
    - The "Draft report" action
    - The Scope Agent (cost estimation is its primary output)
    """

    # Enumerate expected agent calls for this operation
    expected_calls = enumerate_expected_calls(operation, inputs)

    total_cost = Decimal("0.00")
    breakdown = []

    for call in expected_calls:
        model = model_config.resolve_model(call.agent_role)

        # Skip if AI is toggled off for this role
        if not model_config.ai_toggle.is_enabled_for_role(call.agent_role):
            continue

        est_input_tokens = estimate_input_tokens(call)
        est_output_tokens = estimate_output_tokens(call)

        # Adjust for cache hits (cached calls don't re-run LLMs)
        cache_hit_probability = cache_state.estimate_hit_rate(call)
        effective_probability = Decimal(str(1.0 - cache_hit_probability))

        call_cost = (
            (Decimal(str(est_input_tokens)) / Decimal("1000000")) * model.input_cost_per_million
            + (Decimal(str(est_output_tokens)) / Decimal("1000000")) * model.output_cost_per_million
        ) * effective_probability

        total_cost += call_cost
        breakdown.append(CallCostEstimate(
            agent_role=call.agent_role,
            model_id=model.id,
            estimated_cost_usd=float(call_cost),
        ))

    return CostEstimate(
        total_usd=float(total_cost),
        breakdown=breakdown,
        disclaimer="Estimate assumes average token counts; actual cost may vary ±30%",
    )
```

### 12.3 LLM cost telemetry in the Provider Marketplace UI

The Model Configuration UI (v0.9 Part 3.4) shows the cost dashboard:

```
LLM COST — JUNE 2026

  Anthropic (Claude Opus 4.6)       $1,847.30  (Orchestrator 53%, Critic 33%, Narrative 14%)
  DeepSeek API (V4 Pro)              $124.80   (Tracer 70%, Attribution 20%, Inspector 10%)
  Local Qwen 3.5 8B (own GPUs)        $0.00   (electricity ~$80 est.)
  Local Phi-4 14B (own GPUs)          $0.00   (electricity ~$120 est.)
  ──────────────────────────────────────────
  TOTAL EXTERNAL                  $1,972.10
  ESTIMATED LOCAL (electricity)      $200.00

  Would cost with all-frontier:   $19,720.00
  Savings from tier strategy:     $17,747.90 (90%)

  By case this month:
    Case A (Operation Bluebird)    $1,847.20 (complex, many Critic calls)
    Case B (Op. Stardust)           $412.30
    Case C (Op. Mockingbird)        $208.40
```

---

## Part 13 — Anti-Feature Enforcement

### 13.1 The F41 commitments in code

Per v0.8 F41: anti-feature commitments are in the CI test suite. A build check fails if any anti-feature code path appears.

```python
# tools/ci/anti_feature_checks.py

"""
Anti-feature enforcement CI suite.
These tests fail the build if any prohibited feature is introduced.
Run on every PR and on main branch.
"""

import ast
import re
from pathlib import Path

ANTI_FEATURE_PATTERNS = [

    # 1. No predictive policing: no code that evaluates suspicion without
    #    a documented investigative predicate
    AntiFeaturePattern(
        name="predictive_policing",
        description="Address/entity suspicion scoring without case context",
        code_patterns=[
            r"suspicion_score",
            r"risk_score.*without.*case",
            r"flagged_without_predicate",
        ],
        exempt_files=["tests/", "docs/"],
    ),

    # 2. No demographic correlation
    AntiFeaturePattern(
        name="demographic_correlation",
        description="Any correlation of transaction patterns with demographic, geographic, or political signals",
        code_patterns=[
            r"demographic",
            r"ethnicity",
            r"political.*affiliation",
            r"zip_code.*risk",
            r"neighborhood.*score",
        ],
        exempt_files=["tests/", "docs/"],
    ),

    # 3. No mass surveillance modes: watchers require case_id
    AntiFeaturePattern(
        name="mass_surveillance",
        description="Watcher rules without a case_id context",
        code_patterns=[
            r"watcher_rule.*case_id.*None",
            r"monitor_all_addresses",
            r"jurisdiction_wide_watch",
        ],
        exempt_files=["tests/"],
    ),

    # 4. No untargeted dragnet
    AntiFeaturePattern(
        name="dragnet_features",
        description="Queries or scans without specific IOC targets",
        code_patterns=[
            r"scan_all_addresses",
            r"trace_without_ioc",
            r"bulk_attribution_no_case",
        ],
        exempt_files=["tests/"],
    ),

    # 5. No AI-only court-grade promotion (D1 lock enforcement)
    AntiFeaturePattern(
        name="ai_court_grade_promotion",
        description="BeliefAtom promoted to court_grade without signoff_id",
        check_function=check_no_unsigned_court_grade_promotion,
    ),

    # 6. No numbers from LLM (Math Service ownership)
    AntiFeaturePattern(
        name="llm_arithmetic",
        description="Numeric values in agent outputs not tagged with MATH citation",
        check_function=check_no_untagged_numbers_in_agent_prompts,
    ),
]

def run_anti_feature_checks(repo_root: Path) -> AntiFeatureCheckResult:
    """Run all anti-feature checks. Returns results with pass/fail per pattern."""
    results = []
    for pattern in ANTI_FEATURE_PATTERNS:
        result = run_pattern_check(pattern, repo_root)
        results.append(result)

    return AntiFeatureCheckResult(
        passed=all(r.passed for r in results),
        results=results,
    )
```

### 13.2 The CI gate

```yaml
# .github/workflows/anti_feature_check.yml

name: Anti-Feature Enforcement
on: [push, pull_request]

jobs:
  anti_feature:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run anti-feature checks
        run: python tools/ci/anti_feature_checks.py --root .
        # This step fails the build if any anti-feature pattern is found
```

### 13.3 Methodology disclaimer injection

Per v0.8 F41, every report must include the methodology disclaimer. This is enforced in the Report model:

```python
# packages/agents/src/narrative.py

METHODOLOGY_DISCLAIMER = """
The analysis in this report was produced using the ChainSight platform's
heuristic and machine-learning techniques as documented in the Methodology
Disclosure section. These techniques are probabilistic and subject to known
false-positive rates as publicly reported. The conclusions in this report
are technical findings, not legal conclusions. The decision to act on these
findings — including freeze requests, seizure recommendations, or charging
decisions — is the responsibility of the human investigators, prosecutors,
and adjudicators involved, not the platform.
"""

def build_report(path: TracePath, config: ReportConfig) -> Report:
    """Every report builder injects the methodology disclaimer."""

    # Validate that the disclaimer is present
    # (anti-feature check also verifies this at code level)
    assert METHODOLOGY_DISCLAIMER in config.required_sections, \
        "Methodology disclaimer is mandatory in all reports (F41)"

    ...
```

### 13.4 CLRB integration

Per v0.8 F41, the Civil-Liberties Review Board (CLRB) reviews high-impact features. The CI pipeline flags features that require CLRB review:

```python
CLRB_REVIEW_REQUIRED_FOR = [
    "attribution_promotion_to_court_grade",
    "watcher_rule_new_capability",
    "ml_based_obfuscation_detector_release",
    "new_clustering_heuristic",
    "new_osint_provider_integration",
    "any_feature_scoring_addresses_without_case_context",
]

def check_clrb_required(feature_manifest: FeatureManifest) -> bool:
    """Returns True if this feature requires CLRB review before release."""
    return any(
        tag in feature_manifest.capability_tags
        for tag in CLRB_REVIEW_REQUIRED_FOR
    )
```

---

## Part 14 — Phase 0 Implementation Plan (AI/ML Work, Weeks 1-8)

This matches the v1.0 engineering doc Part 4 build sequence, adding the AI/ML-specific work items.

### Week 1-2: AI Foundation

**Infrastructure context for Phase 0 (SaaS Blind):** Supabase is the Postgres + pgvector host for Phase 0. Fly.io hosts the Fastify API and BullMQ workers. Self-hosted model inference (Ollama for dev, vLLM for prod) does **not** run on Fly.io in Phase 0 — all LLM calls go to BYOK frontier APIs (Claude Opus 4.6, DeepSeek V4 Pro). Fly.io GPU machines for vLLM/Ollama are a Phase 2+ option. Tables `agent_calls`, `model_cards`, `eval_run_results`, and `model_registry` are created in the Supabase Postgres schema during Week 1 migration.

**AI work alongside the monorepo + auth foundation:**

- Wire the Anthropic SDK (+ OpenAI SDK stub): `packages/agents/src/clients/anthropic.ts`, `openai.ts`
- Implement the model registry data model: `LLMProviderDefinition`, `ModelDefinition`, `AgencyLLMInstall` (per v0.9 Part 3.2)
- Implement the `AIToggleState` and `resolveToggleForCall()` function (Part 11)
- Implement the `AgentBudget` and `CostTracker` stub (Part 12.2)
- Stub the `ModelRouter` with the `AGENT_TIER_MAP` hard-coded defaults
- Write the `AgentInput` / `AgentOutput` / `BeliefAtomEmission` TypeScript interfaces
- Stand up the Belief State Service v0: Supabase Postgres table schema + `write_atom()` + `query()` helpers
- Implement `validate_agent_output()` — the mandatory citation token and provenance checks
- Create `rag` schema in Supabase; stand up the four pgvector index tables with RLS policies (Section 5.0)

**Deliverable:** A test harness where a single Claude Opus API call flows through the agent protocol, emits a BeliefAtom, and is validated.

### Week 3-4: Capability Router LLM Extension + First Inspector Call

**AI work alongside the Capability Router + Etherscan integration:**

- Extend the Capability Router with LLM provider resolution
- Wire the Model Configuration UI stub: per-role model assignment matrix (read from `AgencyLLMInstall`)
- Implement one real agent: the **Inspector Summary** agent (Narrative Agent with `tx_summary` task type)
- Wire the single Inspector LLM call: Claude Opus 4.6 → plain-language transaction summary
- Implement the **Verifier Agent v0**: basic citation-token enforcement on the Inspector summary
- Stub the Math Service gRPC client: `compute_value_at_block` endpoint
- Implement the `CostTracker.record()` + basic telemetry logging to `AgentCall` table
- AI toggle: per-agency global switch UI element + `resolveToggleForCall()` enforced in the Inspector call

**Deliverable:** The transaction Inspector shows a plain-language summary. The Verifier checks it. The cost is recorded. The agency can toggle AI off and see the fallback behavior.

### Week 5-6: Orchestrator Skeleton + BeliefAtom Protocol

**AI work alongside the graph canvas + Inspector skeleton:**

- Implement the **Orchestrator loop** (Part 1.3): multi-turn Anthropic SDK conversation with tool dispatch
- Wire three tool calls to the Orchestrator: `invoke_tracer_agent`, `call_math_service`, `invoke_attribution_agent` (stubs)
- Implement the **Tracer Agent v0**: single-hop forward trace on Ethereum, emitting `discovered_edge` BeliefAtoms
- Implement the **Scope Agent**: estimate tx count before running the trace
- Implement the **Budget enforcement**: pre-call cost estimate + budget check before each orchestrator turn
- Implement `fire_critic_async()` stub: dispatches Critic but returns immediately (Critic v0 is a no-op)
- Implement the pre-call cost estimator (Part 12.2) for the "Run autonomous trace" confirmation dialog

**Deliverable:** Single-hop autonomous trace: paste an address → orchestrator invokes Tracer → graph canvas shows discovered neighbor → cost recorded → BeliefAtoms emitted.

### Week 7-8: Reproducibility + Verifier + AI Off Mode

**AI work alongside Reproducibility Pack + chain-of-custody:**

- Add `ModelCard` to the Reproducibility Pack: capture model ID, prompt template hash, sampling params for every agent call
- Implement Reproducibility Pack agent section: `AgentCall[]` + `BeliefAtom[]` snapshot
- Verify that replay of a Pack produces identical BeliefAtom IDs (deterministic agent protocol)
- Implement the **Verifier Agent v1**: Qwen 3.5 8B via local Ollama (for dev); production wired to vLLM
- Wire Verifier into the Inspector summary pipeline: summary is held until Verifier passes
- Implement full **AI-off mode**: every agent falls back to its `NON_AI_FALLBACKS` behavior when toggled off
- Implement the AI-off UX: correct messages per fallback type; no silent degradation
- Set up `tools/eval/` scaffold: ground-truth directory structure + one canonical test case (Ronin Bridge 2022)
- Implement the regression runner stub: `regression_runner.py` runs the Ronin case end-to-end

**Phase 0 AI/ML deliverable:**
End-to-end: paste a tx hash → Inspector populates → AI summary (Verifier-gated) → Orchestrator traces one hop → BeliefAtoms emitted → Reproducibility Pack captures model card → replay produces identical output → AI can be toggled off cleanly.

---

## Part 15 — Open Questions

These are specific items that need founder/architect decisions before the corresponding code is written. They are ordered by urgency relative to the Phase 0-1 build sequence.

### Q-AI-1: Orchestrator turn limit calibration

**Question:** The orchestrator loop has `max_orchestrator_turns = 40` as a default. What's the right number for typical case complexity?

**Why it matters:** Too low = incomplete traces; too high = runaway cost on edge-case investigations.

**Recommendation:** Start at 20 for Phase 0, instrument turn-count distribution over the first 10 cases, calibrate from real data. The limit should also be configurable per case.

### Q-AI-2: Verifier tolerance threshold

**Question:** If the Verifier finds that 80% of sentences are grounded but 20% are flagged, does the draft still get shown to the investigator? At what grounding rate does the draft get suppressed entirely?

**Why it matters:** A draft with many flagged sentences may be more confusing than no draft at all. But a strict 100% threshold is impractical for complex narratives.

**Recommendation:** Default: show draft if grounding_rate ≥ 0.70, with clear flagging of ungrounded sentences. Below 0.70, show only the grounded sentences and a summary of what's missing.

### Q-AI-3: Critic temperature setting

**Question:** The Critic uses temperature 0.9 for adversarial creativity. Is this right, or should it vary by atom tier?

**Why it matters:** T0 atoms probably don't need adversarial creativity (the evidence is on-chain and deterministic). T3 atoms benefit from maximum skepticism.

**Recommendation:** Tier-dependent temperature: T0/T1 atoms → 0.5 (moderate); T2 atoms → 0.7; T3 atoms → 0.9.

### Q-AI-4: Cross-agency attribution federation timing

**Question:** The Personal Attribution federation (v0.6 Feature 11, sharing level "external") uses privacy-preserving primitives across agency tenants. This is a Phase 4 feature, but the data model needs to be compatible from Phase 0. Is there a design constraint from a pilot customer that accelerates this?

**Why it matters:** If the first pilot customer is a task force with two agencies, cross-agency sharing becomes a Phase 0/1 blocker, not a Phase 4 feature.

**Recommendation:** If the pilot customer is multi-agency, build the org-level sharing (visibility: "shared_with_org") in Phase 0 and design the federation data model but defer the cryptographic federation protocol to Phase 2.

### Q-AI-5: Self-consistency check cadence

**Question:** Self-consistency checks (N=3 parallel runs, Part 6.6) add cost for high-stakes decisions. Should they be on-by-default or opt-in?

**Why it matters:** 3x the cost on bridge correlations and complex attributions could be significant for high-volume cases.

**Recommendation:** Off-by-default; on by default only when confidence < 0.75 or when the task is explicitly marked `required_confidence ≥ 0.90`. Configurable per agency.

### Q-AI-6: Specialist SLM fine-tuning timing

**Question:** The Phase 0 build uses Claude Opus / DeepSeek V4 Pro for all tasks (no fine-tuned SLMs). Fine-tuning starts in Phase 1. How many real cases do we need closed before there's enough training data to warrant fine-tuning the specialist SLMs?

**Why it matters:** Premature fine-tuning on too little data may degrade, not improve, performance.

**Recommendation:** Begin with public data only (no case data needed for the Calldata Decoder and Bridge Correlator). Plan the first fine-tune run at ≥ 1,000 verified public examples per specialist. Case data can supplement starting Phase 2 via the ground-truth flywheel.

### Q-AI-7: On-prem Tier C model for sovereign deployments

**Question:** For on-prem sovereign deployments, Tier C defaults to DeepSeek V4 Pro Max or Llama 4 70B. Some federal customers may be uncomfortable with DeepSeek (Chinese provenance per v0.9 Risk 5). What's the default for classified/federal on-prem?

**Why it matters:** The model configuration UI must show a clear recommendation for federal customers; the wrong default could create a sale-blocker.

**Recommendation:** For federal deployments, default Tier C to Llama 4 70B (Meta, US provenance) or customer's own hosted model. Label DeepSeek clearly with its provenance. Let the agency choose.

### Q-AI-8: Critic challenge auto-resolution

**Question:** When the orchestrator (Tier C) responds to a Critic challenge with additional evidence, can it auto-resolve the challenge? Or does every challenge require human review?

**Why it matters:** Auto-resolution by the orchestrator keeps the trace flowing; requiring human review for every challenge would block fully autonomous traces.

**Recommendation:** Soft challenges can be auto-resolved by the orchestrator if it provides additional corroborating evidence that raises the atom's confidence above 0.80 AND addresses the specific objection. Hard challenges always require human review. Auto-resolutions are logged and visibly marked.

### Q-AI-9: Inspector auto-save behavior for AI analysis

**Question:** The v0.5 F8.5 spec says Inspector analyses are ephemeral (24h) unless explicitly saved. But if the Critic emits a challenge on an Inspector analysis, that challenge needs to persist. Should Critic challenges force an Inspector analysis save?

**Why it matters:** If a Critic challenge exists but the analysis expires, the chain of reasoning for the challenge is lost.

**Recommendation:** Any Inspector analysis that generates at least one Critic challenge is auto-saved to the case. The challenge retention policy follows the case, not the analysis TTL.

### Q-AI-10: Phase 0 LLM provider for the hosted SaaS demo

**Question:** Phase 0 SaaS Blind runs with the developer's own Claude Opus 4.6 API key. For demos to pilot customers, should the platform use the developer's key or require the customer to bring their BYOK key from day one?

**Why it matters:** BYOK from day one is the right posture architecturally (no vendor exposure to case data), but requiring a pilot customer to sign up for an Anthropic API key before the demo adds friction.

**Recommendation:** Ship Phase 0 with a demo-mode flag: if `DEMO_MODE=true`, use the developer's Claude API key but show a banner: "Demo mode: using developer API key. Your BYOK key will be required for production use." In production, BYOK is always required; the developer key is never used for customer case data.

---

## Appendix A — Model Card Schema (per v0.9 Part 8.1)

```typescript
// packages/shared-types/src/model_card.ts

interface ModelCard {
  id: string;
  model_id: string; // e.g. "claude-opus-4-6"
  provider_id: string;
  model_version: string;
  prompt_template_hash: string; // SHA-256 of the exact system prompt used
  sampling_params: SamplingParams;

  // Provenance anchor
  deployed_at: string;
  frozen_at: string | null; // set when used in a court_grade BeliefAtom

  // For reproducibility
  api_version: string; // Anthropic API version
  sdk_version: string; // anthropic npm version
}

interface SamplingParams {
  temperature: number;
  top_p: number | null;
  max_tokens: number;
  seed: number | null; // set for deterministic replay where possible
  stop_sequences: string[];
}
```

---

## Appendix B — The Nine Critical Principles (AI/ML Layer Reminders)

For reference alongside v1.0 Part 9 platform principles:

1. **The Belief State is the only agent memory.** No agent persists state across calls except via BeliefAtoms.

2. **The Math Service owns every number.** Agents never compute. Not even simple addition. Every `[MATH:...]` citation is a Math Service call.

3. **Citation tokens are mandatory, not optional.** No generative output is valid without them. The Verifier enforces this before the investigator sees anything.

4. **The Critic runs in parallel, not after.** Fire it asynchronously on every batch of emitted atoms. Do not batch "review everything at the end."

5. **Tier A handles the volume.** Do not default to Tier C when Tier A is sufficient. The cost difference is 100x; the quality difference for repetitive extraction tasks is negligible.

6. **Model cards are frozen at court-grade signoff.** Once an investigator signs off on a court-grade BeliefAtom, the model card is immutable. Reproducibility Pack replays the exact model.

7. **Budget is enforced before the call, not after.** Pre-estimate every call. Never surprise the investigator with unexpected cost.

8. **AI toggles are enforced at the router, not just the UI.** The non-AI fallback must actually work — it is the product for agencies that disable AI.

9. **The hard confidence floor is 0.60.** Below it, results go to "investigative leads," never to primary findings. The Math Service enforces this; agents cannot override it.

---

_End of ChainSight v1.0 AI/ML Engineering Design_

_Document produced: June 2026. Discipline: AI/ML Engineering (Discipline Agent #2)._
_Cross-references: v0.9 AI/LLM Strategy, v0.2 Accuracy Spine (B1-B8), v1.0 Engineering (canonical), v0.5 F8 Transaction Inspector, v0.8 F41 Anti-Feature Commitments._
