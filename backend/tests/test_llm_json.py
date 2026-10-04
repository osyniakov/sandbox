from __future__ import annotations

import pytest

from app.llm_json import parse_json_object


def test_clean_json() -> None:
    assert parse_json_object('{"a": 1}') == {"a": 1}
    assert parse_json_object('  \n{"a": 1}\n ') == {"a": 1}


def test_json_fenced() -> None:
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_object('```JSON\n{"a": 1}\n```') == {"a": 1}


def test_plain_fenced() -> None:
    assert parse_json_object('```\n{"a": 1}\n```') == {"a": 1}


def test_fenced_with_surrounding_prose() -> None:
    assert parse_json_object('Here you go:\n```json\n{"a": 1}\n```\nHope it helps!') == {"a": 1}


def test_leading_prose() -> None:
    assert parse_json_object('Sure! Here is the result: {"a": 1}') == {"a": 1}


def test_trailing_prose_with_braces() -> None:
    assert parse_json_object('{"a": 1}\nNote: use {name} placeholders } here') == {"a": 1}


def test_nested_objects() -> None:
    assert parse_json_object('x {"a": {"b": {"c": [1, {"d": 2}]}}} y') == {
        "a": {"b": {"c": [1, {"d": 2}]}}
    }


@pytest.mark.parametrize("text", ["", "   \n\t "])
def test_empty_raises(text: str) -> None:
    with pytest.raises(ValueError, match="empty"):
        parse_json_object(text)


def test_array_raises() -> None:
    with pytest.raises(ValueError, match="list"):
        parse_json_object("[1, 2]")


def test_garbage_raises() -> None:
    with pytest.raises(ValueError):
        parse_json_object("not valid json {{{")
    with pytest.raises(ValueError):
        parse_json_object("no braces at all")
