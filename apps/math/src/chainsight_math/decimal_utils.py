"""Decimal helpers.

The Math Service forbids `float` in the hot path. All cryptocurrency values
are integer minor units passed as decimal strings; all fiat conversions go
through `Decimal` with `getcontext().prec` set high enough for any chain.
"""

from __future__ import annotations

from decimal import Decimal, getcontext
from typing import Final

# 78 digits covers 2^256 in decimal (largest EVM uint). Higher than spec §0.3
# but cheap; keeps us safe for any future wide-chain math.
getcontext().prec = 78

# Number of native-minor-unit digits per chain. wei for ETH (18), satoshi for
# BTC (8), lamport for SOL (9), TRC for TRON (6 on USDT-TRC20 but native TRX
# is 6 too). The Math Service treats the input `amount_minor` as already-
# scaled integer minor; we only need decimals to render major-unit display.
NATIVE_DECIMALS: Final[dict[str, int]] = {
    "eth": 18,
    "btc": 8,
    "sol": 9,
    "tron": 6,
    "polygon": 18,
    "arbitrum": 18,
    "base": 18,
}


def native_minor_to_major(minor: str, chain: str) -> Decimal:
    """Convert integer minor units to major-unit Decimal."""
    if chain not in NATIVE_DECIMALS:
        raise ValueError(f"unknown chain: {chain}")
    if not minor.lstrip("-").isdigit():
        raise ValueError(f"amount must be an integer string: {minor!r}")
    return Decimal(minor) / (Decimal(10) ** NATIVE_DECIMALS[chain])


def fiat_round(value: Decimal, places: int = 2) -> str:
    """Quantize to `places` decimal places and return as string."""
    quantum = Decimal(10) ** -places
    return str(value.quantize(quantum))


def format_native(minor: str, chain: str, places: int = 8) -> str:
    """Render minor-units as a major-unit string with at most `places` decimals."""
    major = native_minor_to_major(minor, chain)
    quantum = Decimal(10) ** -places
    return str(major.quantize(quantum).normalize())
