"""HTTP smoke tests using FastAPI's TestClient."""

from __future__ import annotations

from fastapi.testclient import TestClient

from chainsight_math.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "chainsight-math"


def test_compute_value_at_block_eth() -> None:
    r = client.post(
        "/v1/compute_value_at_block",
        json={
            "chain": "eth",
            "amount_minor": "1000000000000000000",
            "block_height": 21_000_000,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["value_fiat"] == "3500.00"
    assert len(body["recipe_hash"]) == 64


def test_compute_value_at_block_rejects_floats() -> None:
    r = client.post(
        "/v1/compute_value_at_block",
        json={"chain": "eth", "amount_minor": "1.5", "block_height": 1},
    )
    assert r.status_code == 400
    body = r.json()
    assert body["code"] == "invalid_input"


def test_compute_fee_in_fiat_eth() -> None:
    r = client.post(
        "/v1/compute_fee_in_fiat",
        json={
            "chain": "eth",
            "gas_used": 21000,
            "gas_price_minor": "20000000000",
            "block_height": 21_000_000,
        },
    )
    assert r.status_code == 200
    assert r.json()["fee_fiat"] == "1.47"


def test_apply_fifo_to_hop() -> None:
    r = client.post(
        "/v1/apply_fifo_to_hop",
        json={
            "chain": "eth",
            "subject_address": "eth:0xabc",
            "block_height_at": 100,
            "existing_lots": [
                {"lot_id": "a", "acquired_minor": "100", "acquired_at_block": 10, "source_tx_hash": "0xa", "taint_fraction": "0"},
                {"lot_id": "b", "acquired_minor": "200", "acquired_at_block": 20, "source_tx_hash": "0xb", "taint_fraction": "0.5"},
            ],
            "outflow_minor": "150",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total_attributed_minor"] == "150"
    assert body["selections"][0]["lot_id"] == "a"
    assert body["selections"][1]["taint_contributed_minor"] == "25"


def test_compute_confidence_round_trip() -> None:
    r = client.post(
        "/v1/compute_confidence",
        json={
            "basis_tier": "T0",
            "provider_corroboration_count": 2,
            "sanctions_match": True,
        },
    )
    assert r.status_code == 200
    body = r.json()
    # 0.50 base + 0.04 corro + 0.05 sanctions = 0.59
    assert abs(body["value"] - 0.59) < 1e-9
    assert len(body["recipe_hash"]) == 64


def test_batch_price_lookup() -> None:
    r = client.post(
        "/v1/batch_price_lookup",
        json={"chains": ["eth", "btc"]},
    )
    assert r.status_code == 200
    snaps = r.json()["snapshots"]
    assert snaps["eth"]["price_usd"] == "3500.00"
    assert snaps["btc"]["price_usd"] == "65000.00"


def test_decode_action_known_selector() -> None:
    r = client.post(
        "/v1/decode_action",
        json={
            "chain": "eth",
            "tx_hash": "0xdeadbeef",
            "selector": "0xa9059cbb",
            "contract": "0xUSDT",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["action_kind"] == "token_transfer"
    assert body["signature"] == "transfer(address,uint256)"
