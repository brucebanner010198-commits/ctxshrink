"""TOON round-trip and fail-closed tests."""

from __future__ import annotations

import json

import pytest

from ctxshrink.toon import toon_decode, toon_encode


def _roundtrip_ok(original_json: str) -> bool:
    encoded = toon_encode(original_json)
    if encoded is None:
        return False
    decoded = toon_decode(encoded)
    if decoded is None:
        return False
    return json.loads(decoded) == json.loads(original_json)


ROUNDTRIP_CASES = [
    '{"hikes":[{"id":1,"name":"Blue Lake","distanceKm":7.5,"sunny":true},'
    '{"id":2,"name":"Ridge","distanceKm":9.2,"sunny":false},'
    '{"id":3,"name":"Loop","distanceKm":5.1,"sunny":true}],'
    '"friends":["ana","luis","sam"],"meta":{"season":"spring_2025"}}',
    '{"values":["a,b","true","123",""," leading"]}',
    '[{"id":1,"ok":true},{"id":2,"ok":false}]',
    '{"nested":{"tags":["x","y"],"empty":{}}}',
    "42",
    '"hello"',
    '":"',
    "[1,2,3]",
    '{"name":"first","items":[]}',
    "[]",
    "{}",
    "null",
    "true",
    "false",
    "[true,false,null]",
    '{"a":1,"b":[{"x":"v1","y":2},{"x":"v2","y":3}]}',
    '{"quoted-looking":"true","numeric-looking":"123","has_space":"a b"}',
    '{"unicode":"caf\\u00e9"}',
    '[1.5,2.25,-3,0,-0.0,1e3,1.2e-4]',
]


@pytest.mark.parametrize("original", ROUNDTRIP_CASES)
def test_roundtrip(original: str) -> None:
    assert _roundtrip_ok(original)


def test_encode_produces_tabular_header_for_uniform_object_arrays() -> None:
    data = json.dumps(
        {
            "hikes": [
                {"id": 1, "name": "a", "distanceKm": 1.0, "sunny": True},
                {"id": 2, "name": "b", "distanceKm": 2.0, "sunny": False},
            ]
        }
    )
    out = toon_encode(data)
    assert out is not None
    assert "hikes[2]{distanceKm,id,name,sunny}:" in out


def test_encode_is_smaller_than_json_for_tabular_data() -> None:
    data = json.dumps({"rows": [{"id": i, "name": "item%d" % i} for i in range(20)]})
    out = toon_encode(data)
    assert out is not None
    assert len(out) < len(data)


def test_encode_keys_are_sorted() -> None:
    out = toon_encode('{"zebra":1,"apple":2,"mango":3}')
    assert out is not None
    assert out.index("apple") < out.index("mango") < out.index("zebra")


def test_decode_rejects_impossible_row_count() -> None:
    assert toon_decode("rows[1000000000]{id}:\n  1") is None


def test_decode_rejects_duplicate_tabular_keys() -> None:
    assert toon_decode("rows[1]{id,id}:\n  1,2") is None


def test_decode_rejects_duplicate_object_keys() -> None:
    assert toon_decode("name: first\nname: second") is None


def test_encode_rejects_duplicate_json_keys() -> None:
    for bad in ['{"id":0,"id":""}', '{"rows":[{"id":0,"id":""}]}', '{"outer":{"id":0,"id":""}}']:
        assert toon_encode(bad) is None


def test_encode_rejects_nan_and_infinity() -> None:
    assert toon_encode("NaN") is None
    assert toon_encode("Infinity") is None
    assert toon_encode('{"x": NaN}') is None


def test_decode_rejects_malformed_indentation() -> None:
    assert toon_decode("name: value\n foo: bar") is None  # odd indent (1 space)


def test_decode_rejects_blank_lines() -> None:
    assert toon_decode("name: value\n\nother: value") is None


def test_encode_invalid_json_returns_none() -> None:
    assert toon_encode("{not valid json") is None


def test_decode_invalid_toon_returns_none() -> None:
    assert toon_decode("") is None
    assert toon_decode("   ") is None


def test_string_needing_quotes_round_trips() -> None:
    for value in ["true", "false", "null", "123", "-5", "1.5e10", "", " leading", "trailing ",
                  "a,b", "a:b", 'has"quote', "[bracket", "{brace", "-dash"]:
        original = json.dumps({"v": value})
        assert _roundtrip_ok(original), "failed for %r" % value


def test_plain_string_stays_unquoted() -> None:
    out = toon_encode('{"name":"hello world"}')
    assert out is not None
    assert "name: hello world\n" in out


def test_encode_fails_closed_on_keys_it_cannot_represent() -> None:
    # TOON keys are `[A-Za-z_][A-Za-z0-9_.-]*`; a JSON object key with a
    # space, or any other character outside that set, has no TOON spelling.
    # The encoder must fail closed (None) rather than silently drop or mangle
    # the key.
    for bad_key_json in ['{"has space": 1}', '{"has:colon": 1}', '{"1leading": 1}', '{"": 1}']:
        assert toon_encode(bad_key_json) is None