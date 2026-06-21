"""Determinism + canonicalization tests for recipe.py."""

from __future__ import annotations

from chainsight_math.recipe import canonical_json_dumps, compute_recipe_hash


def test_canonical_json_sorts_keys() -> None:
    a = canonical_json_dumps({"b": 1, "a": 2, "c": 3})
    b = canonical_json_dumps({"c": 3, "a": 2, "b": 1})
    assert a == b == '{"a":2,"b":1,"c":3}'


def test_canonical_json_nested_objects_sorted_deeply() -> None:
    out = canonical_json_dumps({"x": {"b": 2, "a": 1}, "y": [3, 1, 2]})
    # Arrays preserve order; objects sort.
    assert out == '{"x":{"a":1,"b":2},"y":[3,1,2]}'


def test_canonical_json_rejects_floats() -> None:
    import pytest

    with pytest.raises(TypeError):
        canonical_json_dumps({"v": 1.5})


def test_canonical_json_strings_escape() -> None:
    assert canonical_json_dumps('a"b') == '"a\\"b"'
    assert canonical_json_dumps("a\nb") == '"a\\nb"'


def test_recipe_hash_stable() -> None:
    h1 = compute_recipe_hash("foo", "v1", {"a": 1, "b": "x"})
    h2 = compute_recipe_hash("foo", "v1", {"b": "x", "a": 1})
    assert h1 == h2
    assert len(h1) == 64  # 32 bytes hex


def test_recipe_hash_changes_with_version() -> None:
    h1 = compute_recipe_hash("foo", "v1", {"a": 1})
    h2 = compute_recipe_hash("foo", "v2", {"a": 1})
    assert h1 != h2


def test_recipe_hash_changes_with_formula() -> None:
    h1 = compute_recipe_hash("foo", "v1", {"a": 1})
    h2 = compute_recipe_hash("bar", "v1", {"a": 1})
    assert h1 != h2
