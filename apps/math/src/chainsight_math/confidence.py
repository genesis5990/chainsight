"""Confidence math.

PARITY CONTRACT: this implementation must produce byte-identical output to
the TS stub in packages/belief-state/src/math-stub.ts. Once the API is
swapped to call this service, the stub becomes a deterministic fallback for
local-dev only.

Spec §4.5.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from .recipe import compute_recipe_hash

CODE_VERSION = "confidence@v1.0.0"

BasisTier = Literal["T0", "T2", "T3"]


@dataclass(frozen=True)
class ConfidenceInputs:
    basis_tier: BasisTier
    provider_corroboration_count: int = 0
    sanctions_match: bool = False
    obfuscation_penalty: float = 0.0   # 0..1
    age_decay: float = 0.0             # 0..1


@dataclass(frozen=True)
class ConfidenceResult:
    value: float
    inputs: ConfidenceInputs
    recipe_hash: str

    def to_dict(self) -> dict[str, object]:
        return {
            "value": self.value,
            "inputs": {
                "basis_tier": self.inputs.basis_tier,
                "provider_corroboration_count": self.inputs.provider_corroboration_count,
                "sanctions_match": self.inputs.sanctions_match,
                "obfuscation_penalty": self.inputs.obfuscation_penalty,
                "age_decay": self.inputs.age_decay,
            },
            "recipe_hash": self.recipe_hash,
        }


# Weights mirror packages/belief-state/src/math-stub.ts exactly.
# Any change here must bump CODE_VERSION.
_WEIGHTS = {
    "basis": {"T0": Decimal("0.50"), "T2": Decimal("0.30"), "T3": Decimal("0.10")},
    "corroboration_step": Decimal("0.02"),
    "corroboration_cap": Decimal("0.10"),
    "sanctions": Decimal("0.05"),
    "obfuscation": Decimal("-0.10"),
    "age_decay": Decimal("-0.05"),
}


def compute_confidence(inputs: ConfidenceInputs) -> ConfidenceResult:
    base = _WEIGHTS["basis"][inputs.basis_tier]
    corro = min(
        _WEIGHTS["corroboration_cap"],
        Decimal(inputs.provider_corroboration_count) * _WEIGHTS["corroboration_step"],
    )
    sanct = _WEIGHTS["sanctions"] if inputs.sanctions_match else Decimal(0)
    obf = _WEIGHTS["obfuscation"] * Decimal(str(inputs.obfuscation_penalty))
    age = _WEIGHTS["age_decay"] * Decimal(str(inputs.age_decay))

    raw = base + corro + sanct + obf + age
    clamped = max(Decimal(0), min(Decimal(1), raw))
    # IEEE-754 float for transport; full Decimal precision is in the recipe inputs.
    value = float(clamped)

    recipe = compute_recipe_hash(
        "confidence",
        CODE_VERSION,
        {
            "basis_tier": inputs.basis_tier,
            "provider_corroboration_count": inputs.provider_corroboration_count,
            "sanctions_match": inputs.sanctions_match,
            "obfuscation_penalty": str(inputs.obfuscation_penalty),
            "age_decay": str(inputs.age_decay),
        },
    )
    return ConfidenceResult(value=value, inputs=inputs, recipe_hash=recipe)
