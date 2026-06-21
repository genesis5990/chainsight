"""Tests for FIFO/LIFO/Proportional methodologies."""

from __future__ import annotations

from chainsight_math.methodology import (
    Lot,
    apply_fifo_to_hop,
    apply_lifo_to_hop,
    apply_proportional_to_hop,
)


def lot(lid: str, minor: str, block: int, taint: str = "0") -> Lot:
    return Lot(
        lot_id=lid,
        acquired_minor=minor,
        acquired_at_block=block,
        source_tx_hash=f"0x{lid}",
        taint_fraction=taint,
    )


def test_fifo_full_consumption_oldest_first() -> None:
    r = apply_fifo_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[
            lot("a", "100", 10),
            lot("b", "200", 20),
            lot("c", "300", 30),
        ],
        incoming_lots=None,
        outflow_minor="250",
    )
    # 100 from lot a, 150 from lot b
    assert [s.lot_id for s in r.selections] == ["a", "b"]
    assert r.selections[0].amount_consumed_minor == "100"
    assert r.selections[1].amount_consumed_minor == "150"
    assert r.total_attributed_minor == "250"
    assert r.remaining_outflow_minor == "0"


def test_fifo_taint_propagation() -> None:
    r = apply_fifo_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[
            lot("clean", "100", 10, taint="0"),
            lot("dirty", "100", 20, taint="1"),
            lot("half", "100", 30, taint="0.5"),
        ],
        incoming_lots=None,
        outflow_minor="250",
    )
    # 100 clean (taint 0), 100 dirty (taint 100), 50 half (taint 25)
    assert r.selections[0].taint_contributed_minor == "0"
    assert r.selections[1].taint_contributed_minor == "100"
    assert r.selections[2].taint_contributed_minor == "25"
    assert r.total_taint_minor == "125"


def test_fifo_outflow_exceeds_pool() -> None:
    r = apply_fifo_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[lot("a", "100", 10)],
        incoming_lots=None,
        outflow_minor="500",
    )
    assert r.total_attributed_minor == "100"
    assert r.remaining_outflow_minor == "400"


def test_fifo_incoming_lots_appended() -> None:
    r = apply_fifo_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[lot("a", "50", 10)],
        incoming_lots=[lot("b", "100", 99)],
        outflow_minor="100",
    )
    # existing lot a (50) consumed first, then 50 from incoming b
    assert [s.lot_id for s in r.selections] == ["a", "b"]
    assert r.selections[1].amount_consumed_minor == "50"


def test_fifo_deterministic() -> None:
    args = dict(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[lot("a", "100", 10), lot("b", "200", 20)],
        incoming_lots=None,
        outflow_minor="150",
    )
    r1 = apply_fifo_to_hop(**args)
    r2 = apply_fifo_to_hop(**args)
    assert r1.recipe_hash == r2.recipe_hash


def test_lifo_newest_first() -> None:
    # c (300) fully covers 250 outflow → only c is selected.
    r = apply_lifo_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[
            lot("a", "100", 10),
            lot("b", "200", 20),
            lot("c", "300", 30),
        ],
        incoming_lots=None,
        outflow_minor="250",
    )
    assert [s.lot_id for s in r.selections] == ["c"]
    assert r.selections[0].amount_consumed_minor == "250"


def test_lifo_spans_multiple_lots() -> None:
    # outflow exceeds newest → walks backward.
    r = apply_lifo_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[
            lot("a", "100", 10),
            lot("b", "200", 20),
            lot("c", "300", 30),
        ],
        incoming_lots=None,
        outflow_minor="450",
    )
    assert [s.lot_id for s in r.selections] == ["c", "b"]
    assert r.selections[0].amount_consumed_minor == "300"
    assert r.selections[1].amount_consumed_minor == "150"


def test_proportional_balanced() -> None:
    r = apply_proportional_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[
            lot("a", "100", 10),
            lot("b", "100", 20),
        ],
        incoming_lots=None,
        outflow_minor="100",
    )
    # 50/50 split
    assert r.total_attributed_minor == "100"
    amounts = {s.lot_id: int(s.amount_consumed_minor) for s in r.selections}
    assert amounts == {"a": 50, "b": 50}


def test_proportional_uneven_with_rounding_to_largest() -> None:
    r = apply_proportional_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[
            lot("a", "10", 10),
            lot("b", "20", 20),
            lot("c", "70", 30),
        ],
        incoming_lots=None,
        outflow_minor="100",
    )
    # Pure proportions: 10/100*100=10, 20/100*100=20, 70/100*100=70. Total 100.
    assert r.total_attributed_minor == "100"
    by_id = {s.lot_id: int(s.amount_consumed_minor) for s in r.selections}
    assert by_id == {"a": 10, "b": 20, "c": 70}


def test_proportional_empty_pool() -> None:
    r = apply_proportional_to_hop(
        chain="eth",
        subject_address="eth:0xabc",
        block_height_at=100,
        existing_lots=[lot("a", "0", 10)],
        incoming_lots=None,
        outflow_minor="100",
    )
    assert r.total_attributed_minor == "0"
    assert r.remaining_outflow_minor == "100"
