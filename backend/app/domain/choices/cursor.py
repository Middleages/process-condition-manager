"""Opaque, version-bearing keyset cursor for ChoiceOption pages."""

import base64
import binascii
import json
from dataclasses import dataclass

from app.domain.choices.rules import normalize_choice_code
from app.domain.errors import RuleViolationError


@dataclass(frozen=True, slots=True)
class ChoiceCursor:
    version: int
    sort_order: int
    code: str


def encode_choice_cursor(cursor: ChoiceCursor) -> str:
    payload = json.dumps(
        {"v": cursor.version, "o": cursor.sort_order, "c": cursor.code},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_choice_cursor(raw: str) -> ChoiceCursor:
    try:
        if not raw or any(
            not (character.isascii() and (character.isalnum() or character in "_-"))
            for character in raw
        ):
            raise ValueError
        padding = "=" * (-len(raw) % 4)
        decoded = base64.b64decode(raw + padding, altchars=b"-_", validate=True)
        payload = json.loads(decoded)
        if not isinstance(payload, dict) or set(payload) != {"v", "o", "c"}:
            raise ValueError
        version = payload["v"]
        sort_order = payload["o"]
        code = payload["c"]
        if (
            isinstance(version, bool)
            or not isinstance(version, int)
            or version < 1
            or isinstance(sort_order, bool)
            or not isinstance(sort_order, int)
            or not isinstance(code, str)
            or normalize_choice_code(code, 128) != code
        ):
            raise ValueError
        return ChoiceCursor(version=version, sort_order=sort_order, code=code)
    except (
        binascii.Error,
        json.JSONDecodeError,
        RuleViolationError,
        TypeError,
        UnicodeDecodeError,
        ValueError,
    ):
        raise RuleViolationError(
            "선택지 페이지 커서가 잘못되었다", code="invalid_cursor"
        ) from None
