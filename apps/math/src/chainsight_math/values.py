"""Value math: native minor units → fiat using a price snapshot.

This is the most-called Math RPC in the system. Every Inspector and Tracer
hop ends up here. Determinism is non-negotiable.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .decimal_utils import fiat_round, format_native, native_minor_to_major
from .prices import PriceSnapshot, placeholder_snapshot, to_decimal
from .recipe import compute_recipe_hash

CODE_VERSION = "compute_value_at_block@v1.0.0"


@dataclass(frozen=True)
class ValueAtBlockResult:
    value_native_minor: str
    value_native_major: str
    value_fiat: str
    fiat_currency: str
    price_used: str
    price_source: str
    snapshot_time: str
    provider_request_id: str
    recipe_hash: str


def compute_value_at_block(
    *,
    chain: str,
    amount_minor: str,
    block_height: int,
    fiat: str = "USD",
    price_hint: PriceSnapshot | None = None,
) -> ValueAtBlockResult:
    """Convert native minor units to fiat at a specific block.

    If `price_hint` is provided, it is used verbatim — this is the path
    Reproducibility Pack replays take. Otherwise we synthesize a placeholder.
    """
    if not amount_minor.lstrip("-").isdigit():
        raise ValueError(f"amount_minor must be an integer string: {amount_minor!r}")

    snapshot = price_hint if price_hint is not None else placeholder_snapshot(chain)
    price_dec = to_decimal(snapshot)
    major = native_minor_to_major(amount_minor, chain)
    fiat_value = major * price_dec

    inputs = {
        "chain": chain,
        "amount_minor": amount_minor,
        "block_height": block_height,
        "fiat": fiat,
        "price_snapshot": snapshot.as_recipe_input(),
    }
    recipe = compute_recipe_hash("compute_value_at_block", CODE_VERSION, inputs)

    return ValueAtBlockResult(
        value_native_minor=amount_minor,
        value_native_major=format_native(amount_minor, chain),
        value_fiat=fiat_round(fiat_value, places=2),
        fiat_currency=fiat,
        price_used=snapshot.price_usd,
        price_source=snapshot.source,
        snapshot_time=snapshot.snapshot_time,
        provider_request_id=snapshot.provider_request_id,
        recipe_hash=recipe,
    )


# ───────────────────────────────────────────────────────────────────────────
# Fee math
# ───────────────────────────────────────────────────────────────────────────

FEE_CODE_VERSION = "compute_fee_in_fiat@v1.0.0"


@dataclass(frozen=True)
class FeeResult:
    fee_native_minor: str
    fee_native_major: str
    fee_fiat: str
    fiat_currency: str
    recipe_hash: str


def compute_fee_in_fiat(
    *,
    chain: str,
    gas_used: int | None,
    gas_price_minor: str | None,
    fee_native_minor: str | None,
    block_height: int,
    fiat: str = "USD",
    price_hint: PriceSnapshot | None = None,
) -> FeeResult:
    """Compute the fiat-denominated transaction fee.

    Two callable shapes:
      * EVM: pass (gas_used, gas_price_minor); we compute fee = gas * price.
      * Non-EVM (BTC, SOL, TRON): pass `fee_native_minor` directly.
    """
    if fee_native_minor is None:
        if gas_used is None or gas_price_minor is None:
            raise ValueError(
                "must provide either fee_native_minor OR (gas_used + gas_price_minor)"
            )
        if not gas_price_minor.lstrip("-").isdigit():
            raise ValueError(f"gas_price_minor must be integer string: {gas_price_minor!r}")
        fee_native_minor = str(int(gas_used) * int(gas_price_minor))

    snapshot = price_hint if price_hint is not None else placeholder_snapshot(chain)
    price_dec = to_decimal(snapshot)
    major = native_minor_to_major(fee_native_minor, chain)
    fee_fiat = major * price_dec

    inputs = {
        "chain": chain,
        "gas_used": gas_used,
        "gas_price_minor": gas_price_minor,
        "fee_native_minor": fee_native_minor,
        "block_height": block_height,
        "fiat": fiat,
        "price_snapshot": snapshot.as_recipe_input(),
    }
    recipe = compute_recipe_hash("compute_fee_in_fiat", FEE_CODE_VERSION, inputs)

    return FeeResult(
        fee_native_minor=fee_native_minor,
        fee_native_major=format_native(fee_native_minor, chain),
        fee_fiat=str(Decimal(fee_fiat).quantize(Decimal("0.01"))),
        fiat_currency=fiat,
        recipe_hash=recipe,
    )
