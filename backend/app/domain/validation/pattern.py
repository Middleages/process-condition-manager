"""Scanner and compiler for the bounded Python/JavaScript pattern subset."""

import re
from dataclasses import dataclass, field

from app.domain.errors import RuleViolationError

MAX_PATTERN_LENGTH = 256
MAX_ALTERNATIVES = 16
MAX_ATOMS_PER_ALTERNATIVE = 64
MAX_QUANTIFIED_ATOMS_PER_ALTERNATIVE = 16
MAX_REPETITION = 256
MAX_BRANCH_MATCH_LENGTH = 1_024

_ESCAPABLE_METACHARACTERS = frozenset(r".\^$*+?{}[]|()-")
_FORBIDDEN_UNESCAPED = frozenset("^$*+?{}()]")


@dataclass(frozen=True, slots=True)
class PortablePattern:
    source: str
    max_match_length: int
    _compiled: re.Pattern[str] = field(repr=False, compare=False)

    def fullmatch(self, value: str) -> bool:
        return len(value) <= self.max_match_length and self._compiled.fullmatch(value) is not None


@dataclass(frozen=True, slots=True)
class _AcceptedCharacters:
    intervals: tuple[tuple[int, int], ...]
    matches_any: bool = False

    def overlaps(self, other: "_AcceptedCharacters") -> bool:
        if self.matches_any or other.matches_any:
            return True
        return any(
            left_start <= right_end and right_start <= left_end
            for left_start, left_end in self.intervals
            for right_start, right_end in other.intervals
        )


_ANY_CHARACTER = _AcceptedCharacters((), matches_any=True)


def _invalid(diagnostic: str) -> RuleViolationError:
    return RuleViolationError(diagnostic, code="portable_pattern_invalid")


class _PatternScanner:
    def __init__(self, source: str) -> None:
        self.source = source
        self.index = 0

    def scan(self) -> int:
        branch_maxima: list[int] = []
        while True:
            branch_maxima.append(self._scan_branch())
            if self.index == len(self.source):
                break
            self.index += 1  # top-level alternation separator
            if len(branch_maxima) >= MAX_ALTERNATIVES:
                raise _invalid("portable pattern has too many alternatives")
        return max(branch_maxima)

    def _scan_branch(self) -> int:
        atom_count = 0
        quantified_count = 0
        maximum_length = 0
        previous_quantified = False
        previous_characters: _AcceptedCharacters | None = None

        while self.index < len(self.source) and self.source[self.index] != "|":
            characters = self._scan_atom()
            atom_count += 1
            if atom_count > MAX_ATOMS_PER_ALTERNATIVE:
                raise _invalid("portable pattern branch has too many atoms")

            maximum_repetition, quantified = self._scan_quantifier()
            if quantified:
                quantified_count += 1
                if quantified_count > MAX_QUANTIFIED_ATOMS_PER_ALTERNATIVE:
                    raise _invalid("portable pattern branch has too many quantified atoms")
                if (
                    previous_quantified
                    and previous_characters is not None
                    and previous_characters.overlaps(characters)
                ):
                    raise _invalid("adjacent quantified atoms accept overlapping characters")

            maximum_length += maximum_repetition
            if maximum_length > MAX_BRANCH_MATCH_LENGTH:
                raise _invalid("portable pattern branch maximum length is too large")
            previous_quantified = quantified
            previous_characters = characters

        if atom_count == 0:
            raise _invalid("portable pattern alternatives cannot be empty")
        return maximum_length

    def _scan_atom(self) -> _AcceptedCharacters:
        char = self.source[self.index]
        if char == ".":
            self.index += 1
            return _ANY_CHARACTER
        if char == "[":
            return self._scan_character_class()
        if char == "\\":
            literal = self._scan_escape()
            return _AcceptedCharacters(((ord(literal), ord(literal)),))
        if char in _FORBIDDEN_UNESCAPED:
            raise _invalid(f"unescaped metacharacter {char!r} is not portable")

        self.index += 1
        return _AcceptedCharacters(((ord(char), ord(char)),))

    def _scan_escape(self) -> str:
        self.index += 1
        if self.index == len(self.source):
            raise _invalid("portable pattern ends with an incomplete escape")
        escaped = self.source[self.index]
        if escaped not in _ESCAPABLE_METACHARACTERS:
            raise _invalid("only literal metacharacters may be escaped")
        self.index += 1
        return escaped

    def _scan_character_class(self) -> _AcceptedCharacters:
        self.index += 1
        items: list[tuple[str, bool]] = []
        while self.index < len(self.source) and self.source[self.index] != "]":
            char = self.source[self.index]
            if char == "\\":
                items.append((self._scan_escape(), True))
                continue
            if char == "[" or (char == "^" and not items):
                raise _invalid("nested or negated character classes are not portable")
            items.append((char, False))
            self.index += 1

        if self.index == len(self.source):
            raise _invalid("portable character class is not closed")
        self.index += 1
        if not items:
            raise _invalid("portable character classes cannot be empty")

        intervals: list[tuple[int, int]] = []
        item_index = 0
        while item_index < len(items):
            char, escaped = items[item_index]
            if (
                item_index + 2 < len(items)
                and items[item_index + 1] == ("-", False)
                and char != "-"
            ):
                end, _ = items[item_index + 2]
                if end == "-" or ord(char) > ord(end):
                    raise _invalid("portable character class contains a descending range")
                intervals.append((ord(char), ord(end)))
                item_index += 3
                continue
            if char == "-" and not escaped and item_index not in {0, len(items) - 1}:
                raise _invalid("portable character class contains a malformed range")
            intervals.append((ord(char), ord(char)))
            item_index += 1

        return _AcceptedCharacters(tuple(intervals))

    def _scan_quantifier(self) -> tuple[int, bool]:
        if self.index == len(self.source):
            return 1, False
        if self.source[self.index] == "?":
            self.index += 1
            return 1, True
        if self.source[self.index] != "{":
            return 1, False

        closing = self.source.find("}", self.index + 1)
        if closing == -1:
            raise _invalid("portable repetition is not closed")
        body = self.source[self.index + 1 : closing]
        parts = body.split(",")
        if len(parts) == 1 and parts[0].isascii() and parts[0].isdigit():
            lower = upper = int(parts[0])
        elif (
            len(parts) == 2
            and parts[0].isascii()
            and parts[0].isdigit()
            and parts[1].isascii()
            and parts[1].isdigit()
        ):
            lower, upper = (int(part) for part in parts)
        else:
            raise _invalid("portable repetition must be {m} or {m,n}")
        if lower > upper:
            raise _invalid("portable repetition bounds are descending")
        if upper > MAX_REPETITION:
            raise _invalid("portable repetition upper bound is too large")
        self.index = closing + 1
        return upper, True


def compile_portable_pattern(source: str) -> PortablePattern:
    """Validate a bounded pattern before entrusting it to the host regex engine."""
    if not source:
        raise _invalid("portable pattern cannot be empty")
    if len(source) > MAX_PATTERN_LENGTH:
        raise _invalid("portable pattern source is too long")

    max_match_length = _PatternScanner(source).scan()
    try:
        compiled = re.compile(source)
    except re.error as exc:  # scanner diagnostics should normally win
        raise _invalid(f"portable pattern could not be compiled: {exc.msg}") from exc
    return PortablePattern(
        source=source,
        max_match_length=max_match_length,
        _compiled=compiled,
    )
