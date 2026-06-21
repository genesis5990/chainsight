"""Price-snapshot handling.

Spec §4.3: Math accepts a `PriceSnapshot` hint when supplied; otherwise it
fetches a price (Phase 2 wires the actual provider client; Phase 1 returns
a documented placeholder so the rest of the system can be exercised
end-to-end and the recipe_hash remains stable).

A price hint MUST round-trip identically — the recipe_hash includes the
full snapshot (source, price, snapshot_time, provider_request_id).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class PriceSnapshot:
    source: str                     # e.g. "coingecko", "kraken", "test-fixed-1usd"
    price_usd: str                  # decimal string, never float
    snapshot_time: str              # ISO 8601 UTC
    provider_request_id: str        # for audit; "internal" for placeholder

    def as_recipe_input(self) -> dict[str, str]:
        return {
            "source": self.source,
            "price_usd": self.price_usd,
            "snapshot_time": self.snapshot_time,
            "provider_request_id": self.provider_request_id,
        }


# Phase-1 placeholder: deterministic per-chain price. Real provider lookup
# lands when the chain-data pre-fetch path is wired.
PLACEHOLDER_PRICES_USD: dict[str, str] = {
    "eth": "3500.00",
    "btc": "65000.00",
    "sol": "150.00",
    "tron": "0.12",
    "polygon": "0.55",
    "arbitrum": "3500.00",   # ETH-priced L2
    "base": "3500.00",       # ETH-priced L2
}


def placeholder_snapshot(chain: str) -> PriceSnapshot:
    """Return a deterministic placeholder snapshot.

    The snapshot_time is fixed to a known anchor so two calls produce the
    same recipe_hash. When the real provider client lands, it MUST supply a
    real snapshot.
    """
    price = PLACEHOLDER_PRICES_USD.get(chain)
    if price is None:
        raise ValueError(f"no placeholder price for chain {chain}")
    return PriceSnapshot(
        source="placeholder@v1",
        price_usd=price,
        snapshot_time="2026-06-21T00:00:00Z",
        provider_request_id=f"placeholder:{chain}",
    )


def to_decimal(snapshot: PriceSnapshot) -> Decimal:
    return Decimal(snapshot.price_usd)
