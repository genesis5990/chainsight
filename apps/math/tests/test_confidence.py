"""Confidence formula tests (parity with packages/belief-state/src/math-stub.ts)."""

from __future__ import annotations

from chainsight_math.confidence import ConfidenceInputs, compute_confidence


def test_t0_minimum() -> None:
    r = compute_confidence(ConfidenceInputs(basis_tier="T0"))
    # Base T0 = 0.50
    assert r.value == 0.5


def test_t0_with_full_corroboration_and_sanctions() -> None:
    r = compute_confidence(
        ConfidenceInputs(
            basis_tier="T0",
            provider_corroboration_count=10,  # capped at 5
            sanctions_match=True,
        )
    )
    # 0.50 + 0.10 (cap) + 0.05 = 0.65
    assert r.value == 0.65


def test_t3_with_obfuscation_penalty() -> None:
    r = compute_confidence(
        ConfidenceInputs(basis_tier="T3", obfuscation_penalty=1.0)
    )
    # 0.10 + 0 - 0.10 = 0.00
    assert r.value == 0.0


def test_clamped_to_unit_range() -> None:
    r = compute_confidence(
        ConfidenceInputs(basis_tier="T3", obfuscation_penalty=5.0, age_decay=5.0)
    )
    assert 0 <= r.value <= 1


def test_recipe_hash_stable() -> None:
    r1 = compute_confidence(ConfidenceInputs(basis_tier="T2", provider_corroboration_count=3))
    r2 = compute_confidence(ConfidenceInputs(basis_tier="T2", provider_corroboration_count=3))
    assert r1.recipe_hash == r2.recipe_hash


def test_recipe_hash_changes_with_input() -> None:
    r1 = compute_confidence(ConfidenceInputs(basis_tier="T0"))
    r2 = compute_confidence(ConfidenceInputs(basis_tier="T2"))
    assert r1.recipe_hash != r2.recipe_hash
