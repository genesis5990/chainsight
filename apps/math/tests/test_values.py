"""Tests for value + fee math."""

from __future__ import annotations

from chainsight_math.prices import PriceSnapshot
from chainsight_math.values import compute_fee_in_fiat, compute_value_at_block


def test_value_at_block_eth_with_placeholder() -> None:
    r = compute_value_at_block(
        chain="eth",
        amount_minor="1000000000000000000",  # 1 ETH
        block_height=21000000,
    )
    assert r.value_native_minor == "1000000000000000000"
    assert r.value_native_major == "1"
    assert r.value_fiat == "3500.00"
    assert r.price_source == "placeholder@v1"
    assert len(r.recipe_hash) == 64


def test_value_at_block_btc_minor_unit() -> None:
    r = compute_value_at_block(
        chain="btc",
        amount_minor="100000000",  # 1 BTC
        block_height=850000,
    )
    assert r.value_native_major == "1"
    assert r.value_fiat == "65000.00"


def test_value_at_block_deterministic_same_inputs_same_recipe() -> None:
    r1 = compute_value_at_block(
        chain="eth", amount_minor="1500000000000000000", block_height=21_000_000
    )
    r2 = compute_value_at_block(
        chain="eth", amount_minor="1500000000000000000", block_height=21_000_000
    )
    assert r1.recipe_hash == r2.recipe_hash
    assert r1.value_fiat == r2.value_fiat


def test_value_at_block_with_price_hint() -> None:
    hint = PriceSnapshot(
        source="kraken",
        price_usd="4000.00",
        snapshot_time="2026-05-01T00:00:00Z",
        provider_request_id="kraken-req-123",
    )
    r = compute_value_at_block(
        chain="eth",
        amount_minor="2000000000000000000",  # 2 ETH
        block_height=21_000_000,
        price_hint=hint,
    )
    assert r.value_fiat == "8000.00"
    assert r.price_source == "kraken"


def test_value_at_block_rejects_non_integer() -> None:
    import pytest

    with pytest.raises(ValueError):
        compute_value_at_block(chain="eth", amount_minor="1.5", block_height=1)


def test_fee_eth_gas_math() -> None:
    # 21_000 gas at 20 gwei = 420_000 gwei = 0.00042 ETH = 1.47 USD at $3500
    r = compute_fee_in_fiat(
        chain="eth",
        gas_used=21_000,
        gas_price_minor="20000000000",   # 20 gwei in wei
        fee_native_minor=None,
        block_height=21_000_000,
    )
    assert r.fee_native_minor == "420000000000000"
    assert r.fee_fiat == "1.47"


def test_fee_btc_via_native_minor() -> None:
    r = compute_fee_in_fiat(
        chain="btc",
        gas_used=None,
        gas_price_minor=None,
        fee_native_minor="5000",  # 5000 sat
        block_height=850_000,
    )
    # 5000 sat = 0.00005 BTC = 3.25 USD at $65000
    assert r.fee_fiat == "3.25"
