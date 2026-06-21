"""FastAPI entry point for the Math Service.

Phase 1 Week 2: HTTP/1.1 JSON transport over FastAPI. Spec §4.2 calls for
gRPC; the transport swap is a Week-3 task once we have the recipe-hash
contract proven over the wire. All endpoints emit a `recipe_hash` so a
later gRPC migration is purely a transport change.

Endpoints (v1):
  GET  /health
  POST /v1/compute_value_at_block
  POST /v1/compute_fee_in_fiat
  POST /v1/batch_price_lookup
  POST /v1/apply_fifo_to_hop
  POST /v1/apply_lifo_to_hop
  POST /v1/apply_proportional_to_hop
  POST /v1/compute_confidence
  POST /v1/decode_action
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .confidence import ConfidenceInputs, compute_confidence
from .decode import decode_action
from .methodology import (
    Lot,
    apply_fifo_to_hop,
    apply_lifo_to_hop,
    apply_proportional_to_hop,
)
from .prices import PLACEHOLDER_PRICES_USD, PriceSnapshot, placeholder_snapshot
from .values import compute_fee_in_fiat, compute_value_at_block

SERVICE_VERSION = "0.2.0"


app = FastAPI(
    title="ChainSight Math Service",
    version=SERVICE_VERSION,
    description="Deterministic decimal-precision math. Every number the system produces.",
)


# ───────────────────────────────────────────────────────────────────────────
# Middleware: trace_id propagation + access log
# ───────────────────────────────────────────────────────────────────────────


@app.middleware("http")
async def trace_middleware(request: Request, call_next: Any) -> Any:
    trace_id = request.headers.get("x-trace-id") or uuid.uuid4().hex[:16]
    actor_id = request.headers.get("x-actor-id", "-")
    started = time.monotonic()
    response = await call_next(request)
    duration_ms = int((time.monotonic() - started) * 1000)
    response.headers["x-trace-id"] = trace_id
    # Structured log line for the Fly drain. Tab-separated keeps grep simple.
    print(
        f"trace_id={trace_id}\tactor={actor_id}\troute={request.url.path}\t"
        f"status={response.status_code}\tdur_ms={duration_ms}",
        flush=True,
    )
    return response


# ───────────────────────────────────────────────────────────────────────────
# Health
# ───────────────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="chainsight-math", version=SERVICE_VERSION)


# ───────────────────────────────────────────────────────────────────────────
# Shared models
# ───────────────────────────────────────────────────────────────────────────


class PriceSnapshotIn(BaseModel):
    source: str
    price_usd: str
    snapshot_time: str
    provider_request_id: str

    def to_snapshot(self) -> PriceSnapshot:
        return PriceSnapshot(
            source=self.source,
            price_usd=self.price_usd,
            snapshot_time=self.snapshot_time,
            provider_request_id=self.provider_request_id,
        )


# ───────────────────────────────────────────────────────────────────────────
# /v1/compute_value_at_block
# ───────────────────────────────────────────────────────────────────────────


class ComputeValueAtBlockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chain: str
    amount_minor: str
    block_height: int
    fiat: str = "USD"
    price_hint: PriceSnapshotIn | None = None


class ComputeValueAtBlockOut(BaseModel):
    value_native_minor: str
    value_native_major: str
    value_fiat: str
    fiat_currency: str
    price_used: str
    price_source: str
    snapshot_time: str
    provider_request_id: str
    recipe_hash: str


@app.post("/v1/compute_value_at_block", response_model=ComputeValueAtBlockOut)
async def value_at_block(req: ComputeValueAtBlockIn) -> ComputeValueAtBlockOut:
    try:
        result = compute_value_at_block(
            chain=req.chain,
            amount_minor=req.amount_minor,
            block_height=req.block_height,
            fiat=req.fiat,
            price_hint=req.price_hint.to_snapshot() if req.price_hint else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ComputeValueAtBlockOut(**result.__dict__)


# ───────────────────────────────────────────────────────────────────────────
# /v1/compute_fee_in_fiat
# ───────────────────────────────────────────────────────────────────────────


class ComputeFeeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chain: str
    block_height: int
    gas_used: int | None = None
    gas_price_minor: str | None = None
    fee_native_minor: str | None = None
    fiat: str = "USD"
    price_hint: PriceSnapshotIn | None = None


class ComputeFeeOut(BaseModel):
    fee_native_minor: str
    fee_native_major: str
    fee_fiat: str
    fiat_currency: str
    recipe_hash: str


@app.post("/v1/compute_fee_in_fiat", response_model=ComputeFeeOut)
async def fee_in_fiat(req: ComputeFeeIn) -> ComputeFeeOut:
    try:
        result = compute_fee_in_fiat(
            chain=req.chain,
            gas_used=req.gas_used,
            gas_price_minor=req.gas_price_minor,
            fee_native_minor=req.fee_native_minor,
            block_height=req.block_height,
            fiat=req.fiat,
            price_hint=req.price_hint.to_snapshot() if req.price_hint else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ComputeFeeOut(**result.__dict__)


# ───────────────────────────────────────────────────────────────────────────
# /v1/batch_price_lookup — returns placeholder snapshots for known chains
# ───────────────────────────────────────────────────────────────────────────


class BatchPriceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chains: list[str]


class BatchPriceOut(BaseModel):
    snapshots: dict[str, PriceSnapshotIn]


@app.post("/v1/batch_price_lookup", response_model=BatchPriceOut)
async def batch_price(req: BatchPriceIn) -> BatchPriceOut:
    out: dict[str, PriceSnapshotIn] = {}
    for chain in req.chains:
        if chain not in PLACEHOLDER_PRICES_USD:
            raise HTTPException(status_code=400, detail=f"unknown chain {chain}")
        snap = placeholder_snapshot(chain)
        out[chain] = PriceSnapshotIn(
            source=snap.source,
            price_usd=snap.price_usd,
            snapshot_time=snap.snapshot_time,
            provider_request_id=snap.provider_request_id,
        )
    return BatchPriceOut(snapshots=out)


# ───────────────────────────────────────────────────────────────────────────
# /v1/apply_{fifo,lifo,proportional}_to_hop
# ───────────────────────────────────────────────────────────────────────────


class LotIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lot_id: str
    acquired_minor: str
    acquired_at_block: int
    source_tx_hash: str
    taint_fraction: str = "0"

    def to_lot(self) -> Lot:
        return Lot(
            lot_id=self.lot_id,
            acquired_minor=self.acquired_minor,
            acquired_at_block=self.acquired_at_block,
            source_tx_hash=self.source_tx_hash,
            taint_fraction=self.taint_fraction,
        )


class ApplyMethodologyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chain: str
    subject_address: str
    block_height_at: int
    existing_lots: list[LotIn]
    incoming_lots: list[LotIn] = Field(default_factory=list)
    outflow_minor: str


class MethodologySelectionOut(BaseModel):
    lot_id: str
    amount_consumed_minor: str
    taint_contributed_minor: str


class ApplyMethodologyOut(BaseModel):
    selections: list[MethodologySelectionOut]
    total_attributed_minor: str
    total_taint_minor: str
    remaining_outflow_minor: str
    recipe_hash: str


def _run_methodology(method: Literal["fifo", "lifo", "proportional"], req: ApplyMethodologyIn) -> ApplyMethodologyOut:
    fns = {
        "fifo": apply_fifo_to_hop,
        "lifo": apply_lifo_to_hop,
        "proportional": apply_proportional_to_hop,
    }
    try:
        result = fns[method](
            chain=req.chain,
            subject_address=req.subject_address,
            block_height_at=req.block_height_at,
            existing_lots=[lot.to_lot() for lot in req.existing_lots],
            incoming_lots=[lot.to_lot() for lot in req.incoming_lots],
            outflow_minor=req.outflow_minor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ApplyMethodologyOut(
        selections=[MethodologySelectionOut(**s.__dict__) for s in result.selections],
        total_attributed_minor=result.total_attributed_minor,
        total_taint_minor=result.total_taint_minor,
        remaining_outflow_minor=result.remaining_outflow_minor,
        recipe_hash=result.recipe_hash,
    )


@app.post("/v1/apply_fifo_to_hop", response_model=ApplyMethodologyOut)
async def apply_fifo(req: ApplyMethodologyIn) -> ApplyMethodologyOut:
    return _run_methodology("fifo", req)


@app.post("/v1/apply_lifo_to_hop", response_model=ApplyMethodologyOut)
async def apply_lifo(req: ApplyMethodologyIn) -> ApplyMethodologyOut:
    return _run_methodology("lifo", req)


@app.post("/v1/apply_proportional_to_hop", response_model=ApplyMethodologyOut)
async def apply_proportional(req: ApplyMethodologyIn) -> ApplyMethodologyOut:
    return _run_methodology("proportional", req)


# ───────────────────────────────────────────────────────────────────────────
# /v1/compute_confidence
# ───────────────────────────────────────────────────────────────────────────


class ConfidenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    basis_tier: Literal["T0", "T2", "T3"]
    provider_corroboration_count: int = 0
    sanctions_match: bool = False
    obfuscation_penalty: float = 0.0
    age_decay: float = 0.0


class ConfidenceOut(BaseModel):
    value: float
    inputs: ConfidenceIn
    recipe_hash: str


@app.post("/v1/compute_confidence", response_model=ConfidenceOut)
async def confidence(req: ConfidenceIn) -> ConfidenceOut:
    result = compute_confidence(
        ConfidenceInputs(
            basis_tier=req.basis_tier,
            provider_corroboration_count=req.provider_corroboration_count,
            sanctions_match=req.sanctions_match,
            obfuscation_penalty=req.obfuscation_penalty,
            age_decay=req.age_decay,
        )
    )
    return ConfidenceOut(value=result.value, inputs=req, recipe_hash=result.recipe_hash)


# ───────────────────────────────────────────────────────────────────────────
# /v1/decode_action
# ───────────────────────────────────────────────────────────────────────────


class DecodeActionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chain: str
    tx_hash: str
    selector: str | None = None
    contract: str | None = None
    raw_input: str | None = None


class DecodeActionOut(BaseModel):
    chain: str
    tx_hash: str
    selector: str | None
    signature: str | None
    action_kind: str
    confidence: str
    decoded: dict[str, Any]
    recipe_hash: str


@app.post("/v1/decode_action", response_model=DecodeActionOut)
async def decode(req: DecodeActionIn) -> DecodeActionOut:
    result = decode_action(
        chain=req.chain,
        tx_hash=req.tx_hash,
        selector=req.selector,
        contract=req.contract,
        raw_input=req.raw_input,
    )
    return DecodeActionOut(**result.__dict__)


# ───────────────────────────────────────────────────────────────────────────
# Error handler envelope
# ───────────────────────────────────────────────────────────────────────────


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": "invalid_input" if exc.status_code == 400 else "internal",
            "message": str(exc.detail),
        },
    )


# ───────────────────────────────────────────────────────────────────────────
# Entry point
# ───────────────────────────────────────────────────────────────────────────


def main() -> None:
    import uvicorn

    port = int(os.environ.get("PORT", "8081"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
