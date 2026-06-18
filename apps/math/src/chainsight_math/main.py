"""FastAPI entry point for the Math Service.

Phase 0 Week 1 skeleton: health endpoint + one math primitive (compute_value_at_block).
Real gRPC interface lands Week 2-3 once the gRPC client package is set up.
"""
from __future__ import annotations

import os
from decimal import Decimal, getcontext
from fastapi import FastAPI
from pydantic import BaseModel

# Decimal precision matters for fiat conversion + token math.
# 50 digits is comfortably above what any blockchain value needs.
getcontext().prec = 50

app = FastAPI(
    title="ChainSight Math Service",
    version="0.1.0",
    description="Deterministic decimal-precision math. LLMs never type numbers.",
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class ValueAtBlockRequest(BaseModel):
    chain: str
    block_height: int
    token_address: str | None = None
    amount_native: str  # passed as string for arbitrary precision


class ValueAtBlockResponse(BaseModel):
    chain: str
    block_height: int
    amount_native: str
    amount_fiat_usd: str
    method: str
    rule_version: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="chainsight-math", version="0.1.0")


@app.post("/v1/compute_value_at_block", response_model=ValueAtBlockResponse)
async def compute_value_at_block(req: ValueAtBlockRequest) -> ValueAtBlockResponse:
    """Phase 0 stub: returns a deterministic placeholder.

    Phase 1: pulls price from a pinned market-data provider snapshot,
    multiplies by Decimal amount, returns with rule_version pin for
    reproducibility.
    """
    amount = Decimal(req.amount_native)
    # Placeholder fiat — Phase 1 wires real price feed.
    placeholder_price = Decimal("1.00")
    fiat = amount * placeholder_price
    return ValueAtBlockResponse(
        chain=req.chain,
        block_height=req.block_height,
        amount_native=str(amount),
        amount_fiat_usd=str(fiat),
        method="placeholder-v0",
        rule_version="2026.06.18.phase0",
    )


def main() -> None:
    import uvicorn

    port = int(os.environ.get("PORT", "8081"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
