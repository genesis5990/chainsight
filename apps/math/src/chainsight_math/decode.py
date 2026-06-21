"""Action decode helpers.

Phase 1 stub: returns a structured envelope for known selectors. Real ABI
decode via `web3.py` lands in Week 3 when the chain-data provider client
ships and Math can be passed the full tx + receipt.

Even in stub form we emit a recipe_hash so downstream Reproducibility Pack
verifier behavior is identical to Phase 2.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .recipe import compute_recipe_hash

CODE_VERSION = "decode_action@v1.0.0-stub"

# Well-known EVM function selectors (first 4 bytes of keccak256(signature))
KNOWN_SELECTORS: dict[str, str] = {
    "0xa9059cbb": "transfer(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0x42842e0e": "safeTransferFrom(address,address,uint256)",
    # Uniswap V2 router
    "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    "0x18cbafe5": "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
    "0x7ff36ab5": "swapExactETHForTokens(uint256,uint256,address[],address,uint256)",
}


@dataclass(frozen=True)
class DecodeResult:
    chain: str
    tx_hash: str
    selector: str | None
    signature: str | None
    action_kind: str
    confidence: str  # "structured" | "heuristic" | "unknown"
    decoded: dict[str, Any]
    recipe_hash: str


def decode_action(
    *,
    chain: str,
    tx_hash: str,
    selector: str | None,
    contract: str | None,
    raw_input: str | None,
) -> DecodeResult:
    """Phase-1 stub decode.

    For EVM chains: matches against the known-selector table. For non-EVM
    chains: returns unknown but emits a recipe_hash so a replay produces the
    same result.
    """
    selector_norm = (selector or "").lower() or None
    signature = KNOWN_SELECTORS.get(selector_norm) if selector_norm else None

    action_kind: str
    confidence: str
    decoded: dict[str, Any] = {}

    if signature and signature.startswith("transfer"):
        action_kind = "token_transfer"
        confidence = "structured"
        decoded = {"signature": signature, "contract": contract}
    elif signature and signature.startswith("approve"):
        action_kind = "token_approval"
        confidence = "structured"
        decoded = {"signature": signature, "contract": contract}
    elif signature and signature.startswith("swapExact"):
        action_kind = "dex_swap"
        confidence = "structured"
        decoded = {"signature": signature, "contract": contract}
    elif selector_norm:
        action_kind = "contract_call"
        confidence = "heuristic"
        decoded = {"selector": selector_norm, "contract": contract}
    else:
        action_kind = "native_transfer" if chain == "eth" else "unknown"
        confidence = "structured" if chain == "eth" else "unknown"

    inputs = {
        "chain": chain,
        "tx_hash": tx_hash,
        "selector": selector_norm,
        "contract": contract,
        "raw_input_present": raw_input is not None,
    }
    recipe = compute_recipe_hash("decode_action", CODE_VERSION, inputs)

    return DecodeResult(
        chain=chain,
        tx_hash=tx_hash,
        selector=selector_norm,
        signature=signature,
        action_kind=action_kind,
        confidence=confidence,
        decoded=decoded,
        recipe_hash=recipe,
    )
