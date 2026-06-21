"""Methodology math: FIFO / LIFO / proportional lot accounting for taint tracing.

Spec §4.4. Phase 1 ships FIFO; LIFO and Proportional follow with the same
selection-vector API once we have pilot data on real cases.

The output is the *selection vector* — exactly which lots contributed what
amount to the outflow, and what fraction was tainted. Investigators can
inspect this to see why a downstream node carries the taint it does.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

from .recipe import compute_recipe_hash

FIFO_CODE_VERSION = "apply_fifo_to_hop@v1.0.0"
LIFO_CODE_VERSION = "apply_lifo_to_hop@v1.0.0"
PROP_CODE_VERSION = "apply_proportional_to_hop@v1.0.0"

Methodology = Literal["fifo", "lifo", "proportional"]


@dataclass(frozen=True)
class Lot:
    lot_id: str
    acquired_minor: str            # integer string
    acquired_at_block: int
    source_tx_hash: str
    taint_fraction: str = "0"      # decimal string 0..1

    def to_dict(self) -> dict[str, str | int]:
        return {
            "lot_id": self.lot_id,
            "acquired_minor": self.acquired_minor,
            "acquired_at_block": self.acquired_at_block,
            "source_tx_hash": self.source_tx_hash,
            "taint_fraction": self.taint_fraction,
        }


@dataclass(frozen=True)
class MethodologySelection:
    lot_id: str
    amount_consumed_minor: str
    taint_contributed_minor: str


@dataclass(frozen=True)
class MethodologyResult:
    selections: list[MethodologySelection] = field(default_factory=list)
    total_attributed_minor: str = "0"
    total_taint_minor: str = "0"
    remaining_outflow_minor: str = "0"
    recipe_hash: str = ""


def _validate(outflow_minor: str) -> int:
    if not outflow_minor.lstrip("-").isdigit():
        raise ValueError(f"outflow_minor must be integer string: {outflow_minor!r}")
    return int(outflow_minor)


def _quantize_taint(amount: Decimal) -> str:
    """Round taint to integer minor units (banker's rounding via Decimal)."""
    return str(int(amount.to_integral_value()))


def apply_fifo_to_hop(
    *,
    chain: str,
    subject_address: str,
    block_height_at: int,
    existing_lots: list[Lot],
    incoming_lots: list[Lot] | None,
    outflow_minor: str,
) -> MethodologyResult:
    """First-in-first-out: oldest lots consumed first.

    `existing_lots` MUST be supplied in acquisition order (lowest block first).
    `incoming_lots`, if any, are appended after existing — they were added at
    or just before this hop and become consumable for FIFO too.
    """
    target = _validate(outflow_minor)
    if target < 0:
        raise ValueError("outflow_minor cannot be negative")

    lots = [*existing_lots, *(incoming_lots or [])]

    selections: list[MethodologySelection] = []
    total_attr = 0
    total_taint = Decimal(0)

    for lot in lots:
        if target == 0:
            break
        avail = int(lot.acquired_minor)
        if avail <= 0:
            continue
        consume = min(avail, target)
        taint_frac = Decimal(lot.taint_fraction)
        taint_contrib = Decimal(consume) * taint_frac

        selections.append(
            MethodologySelection(
                lot_id=lot.lot_id,
                amount_consumed_minor=str(consume),
                taint_contributed_minor=_quantize_taint(taint_contrib),
            )
        )
        total_attr += consume
        total_taint += taint_contrib
        target -= consume

    inputs = {
        "methodology": "fifo",
        "chain": chain,
        "subject_address": subject_address,
        "block_height_at": block_height_at,
        "outflow_minor": outflow_minor,
        "existing_lots": [lot.to_dict() for lot in existing_lots],
        "incoming_lots": [lot.to_dict() for lot in (incoming_lots or [])],
    }
    recipe = compute_recipe_hash("apply_fifo_to_hop", FIFO_CODE_VERSION, inputs)

    return MethodologyResult(
        selections=selections,
        total_attributed_minor=str(total_attr),
        total_taint_minor=_quantize_taint(total_taint),
        remaining_outflow_minor=str(target),
        recipe_hash=recipe,
    )


def apply_lifo_to_hop(
    *,
    chain: str,
    subject_address: str,
    block_height_at: int,
    existing_lots: list[Lot],
    incoming_lots: list[Lot] | None,
    outflow_minor: str,
) -> MethodologyResult:
    """Last-in-first-out: newest lots consumed first.

    Reverses lot order before walking. Identical semantics otherwise.
    """
    target = _validate(outflow_minor)
    if target < 0:
        raise ValueError("outflow_minor cannot be negative")

    # Newest first: reverse incoming then existing.
    lots = [*reversed(incoming_lots or []), *reversed(existing_lots)]

    selections: list[MethodologySelection] = []
    total_attr = 0
    total_taint = Decimal(0)

    for lot in lots:
        if target == 0:
            break
        avail = int(lot.acquired_minor)
        if avail <= 0:
            continue
        consume = min(avail, target)
        taint_frac = Decimal(lot.taint_fraction)
        taint_contrib = Decimal(consume) * taint_frac
        selections.append(
            MethodologySelection(
                lot_id=lot.lot_id,
                amount_consumed_minor=str(consume),
                taint_contributed_minor=_quantize_taint(taint_contrib),
            )
        )
        total_attr += consume
        total_taint += taint_contrib
        target -= consume

    inputs = {
        "methodology": "lifo",
        "chain": chain,
        "subject_address": subject_address,
        "block_height_at": block_height_at,
        "outflow_minor": outflow_minor,
        "existing_lots": [lot.to_dict() for lot in existing_lots],
        "incoming_lots": [lot.to_dict() for lot in (incoming_lots or [])],
    }
    recipe = compute_recipe_hash("apply_lifo_to_hop", LIFO_CODE_VERSION, inputs)

    return MethodologyResult(
        selections=selections,
        total_attributed_minor=str(total_attr),
        total_taint_minor=_quantize_taint(total_taint),
        remaining_outflow_minor=str(target),
        recipe_hash=recipe,
    )


def apply_proportional_to_hop(
    *,
    chain: str,
    subject_address: str,
    block_height_at: int,
    existing_lots: list[Lot],
    incoming_lots: list[Lot] | None,
    outflow_minor: str,
) -> MethodologyResult:
    """Pro-rata across all available lots.

    Each lot contributes amount_consumed = outflow * (lot_balance / total_pool).
    Taint contribution scales accordingly. Rounding remainder is absorbed by
    the largest lot to keep totals integer-clean.
    """
    target = _validate(outflow_minor)
    if target < 0:
        raise ValueError("outflow_minor cannot be negative")

    lots = [*existing_lots, *(incoming_lots or [])]
    pool = sum((int(lot.acquired_minor) for lot in lots), 0)

    selections: list[MethodologySelection] = []
    total_attr = 0
    total_taint = Decimal(0)

    if pool == 0 or target == 0:
        inputs = {
            "methodology": "proportional",
            "chain": chain,
            "subject_address": subject_address,
            "block_height_at": block_height_at,
            "outflow_minor": outflow_minor,
            "existing_lots": [lot.to_dict() for lot in existing_lots],
            "incoming_lots": [lot.to_dict() for lot in (incoming_lots or [])],
        }
        recipe = compute_recipe_hash("apply_proportional_to_hop", PROP_CODE_VERSION, inputs)
        return MethodologyResult(
            selections=[],
            total_attributed_minor="0",
            total_taint_minor="0",
            remaining_outflow_minor=outflow_minor,
            recipe_hash=recipe,
        )

    # Largest lot accumulates rounding remainder.
    largest_idx = max(range(len(lots)), key=lambda i: int(lots[i].acquired_minor))

    for i, lot in enumerate(lots):
        avail = int(lot.acquired_minor)
        if avail <= 0:
            continue
        consume = (avail * target) // pool   # integer division
        taint_frac = Decimal(lot.taint_fraction)
        taint_contrib = Decimal(consume) * taint_frac
        selections.append(
            MethodologySelection(
                lot_id=lot.lot_id,
                amount_consumed_minor=str(consume),
                taint_contributed_minor=_quantize_taint(taint_contrib),
            )
        )
        total_attr += consume
        total_taint += taint_contrib

    # Apply rounding remainder to the largest-lot selection.
    remainder = target - total_attr
    if remainder > 0 and selections:
        # Find the selection corresponding to largest_idx
        target_lot_id = lots[largest_idx].lot_id
        adjusted: list[MethodologySelection] = []
        for sel in selections:
            if sel.lot_id == target_lot_id:
                taint_frac = Decimal(lots[largest_idx].taint_fraction)
                new_amount = int(sel.amount_consumed_minor) + remainder
                new_taint = Decimal(new_amount) * taint_frac
                total_taint = total_taint - Decimal(sel.taint_contributed_minor) + new_taint
                adjusted.append(
                    MethodologySelection(
                        lot_id=sel.lot_id,
                        amount_consumed_minor=str(new_amount),
                        taint_contributed_minor=_quantize_taint(new_taint),
                    )
                )
                total_attr += remainder
            else:
                adjusted.append(sel)
        selections = adjusted

    inputs = {
        "methodology": "proportional",
        "chain": chain,
        "subject_address": subject_address,
        "block_height_at": block_height_at,
        "outflow_minor": outflow_minor,
        "existing_lots": [lot.to_dict() for lot in existing_lots],
        "incoming_lots": [lot.to_dict() for lot in (incoming_lots or [])],
    }
    recipe = compute_recipe_hash("apply_proportional_to_hop", PROP_CODE_VERSION, inputs)

    return MethodologyResult(
        selections=selections,
        total_attributed_minor=str(total_attr),
        total_taint_minor=_quantize_taint(total_taint),
        remaining_outflow_minor=str(target - total_attr) if target - total_attr > 0 else "0",
        recipe_hash=recipe,
    )
