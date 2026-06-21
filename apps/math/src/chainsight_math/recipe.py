"""Canonical JSON + BLAKE3 recipe_hash.

The recipe_hash is the determinism fingerprint: every Math RPC produces a
hash over (formula_name, code_version, canonical_json(inputs)). Two calls
with the same recipe_hash MUST produce byte-identical outputs.

Spec: docs/chainsight_v1_1_technical_core_spec.md §4.3.
"""

from __future__ import annotations

from typing import Any

from blake3 import blake3

# Pinned via code_version so a hash-algo swap is a deliberate, traceable
# event rather than a silent invalidation of every existing recipe_hash.
HASH_ALGO_VERSION = "blake3-256@v1"


def canonical_json_dumps(value: Any) -> str:
    """Stable, deterministic JSON serialization.

    Rules (mirror packages/belief-state/src/hash.ts):
      * Objects: keys sorted, undefined dropped.
      * Arrays: order preserved (semantic).
      * Numbers: emitted via `repr` only after coercing to int/float;
        callers MUST pass Decimal/str for any value that requires precision.
      * Strings/bool/null pass through json.dumps.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # Floats are intentionally rejected to keep determinism strict.
        # Callers should pass `str(Decimal(...))` instead.
        raise TypeError("floats are not allowed in canonical_json_dumps; use str/Decimal")
    if isinstance(value, str):
        return _json_string(value)
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical_json_dumps(v) for v in value) + "]"
    if isinstance(value, dict):
        parts: list[str] = []
        for k in sorted(value.keys()):
            v = value[k]
            if v is None:
                # null is preserved (matches TS impl)
                pass
            parts.append(_json_string(k) + ":" + canonical_json_dumps(v))
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"unsupported type for canonical_json_dumps: {type(value).__name__}")


def _json_string(s: str) -> str:
    """RFC 8259 JSON string encoding (subset used by JSON.stringify).

    Note: we don't escape non-ASCII characters — both sides emit UTF-8 and
    BLAKE3/BLAKE2b operates on bytes. This matches the TS implementation in
    packages/belief-state/src/hash.ts.
    """
    out = ['"']
    for ch in s:
        cp = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif cp < 0x20:
            out.append(f"\\u{cp:04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def compute_recipe_hash(formula_name: str, code_version: str, inputs: Any) -> str:
    """Compute the canonical 64-hex recipe hash.

    The hash domain-separates by formula name so two formulas with the same
    inputs cannot collide on hash.
    """
    payload = {
        "formula": formula_name,
        "version": code_version,
        "algo": HASH_ALGO_VERSION,
        "inputs": inputs,
    }
    serialized = canonical_json_dumps(payload).encode("utf-8")
    return blake3(serialized).hexdigest()  # default 32 bytes → 64 hex chars
