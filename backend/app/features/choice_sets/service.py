"""Transactional orchestration for the ChoiceSet aggregate."""

from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, NotFoundError
from app.domain.choices.csv_import import ChoiceImportPlan, ChoiceImportRow
from app.domain.choices.cursor import ChoiceCursor, decode_choice_cursor, encode_choice_cursor
from app.domain.choices.rules import (
    normalize_choice_description,
    normalize_choice_label,
    normalize_choice_option,
    normalize_choice_set,
    validate_complete_order,
)
from app.domain.errors import RuleViolationError
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.choice_sets.schema import (
    ChoiceImportApplyOut,
    ChoiceImportIn,
    ChoiceImportPreviewOut,
    ChoiceImportRowOut,
    ChoiceOptionCreateIn,
    ChoiceOptionMutationOut,
    ChoiceOptionOrderIn,
    ChoiceOptionOut,
    ChoiceOptionPageOut,
    ChoiceOptionPatchIn,
    ChoiceSetCreateIn,
    ChoiceSetPatchIn,
    ChoiceSetSummaryOut,
)
from app.models.choice import ChoiceOption, ChoiceSet


class ChoiceSetService:
    def __init__(self, repo: ChoiceSetRepository) -> None:
        self.repo = repo

    async def list_sets(
        self, *, include_inactive: bool = False
    ) -> list[ChoiceSetSummaryOut]:
        return await self.repo.list_summaries(include_inactive=include_inactive)

    async def create_set(self, data: ChoiceSetCreateIn) -> ChoiceSetSummaryOut:
        code, display_name = normalize_choice_set(data.code, data.display_name)
        description = normalize_choice_description(data.description)
        if await self.repo.get_set_by_code(code) is not None:
            raise _set_exists(code)

        choice_set = ChoiceSet(
            code=code,
            display_name=display_name,
            description=description,
        )
        self.repo.add_set(choice_set)
        try:
            await self.repo.flush()
        except IntegrityError as exc:
            if not _is_integrity_violation(exc, "ix_choice_set_code", "choice_set.code"):
                raise
            await self.repo.session.rollback()
            raise _set_exists(code) from None
        return await self.repo.summary_by_id(choice_set.id)

    async def get_set(self, set_code: str) -> ChoiceSetSummaryOut:
        summary = await self.repo.summary_by_code(set_code)
        if summary is None:
            raise NotFoundError(f"선택지 집합을 찾을 수 없다: {set_code}")
        return summary

    async def patch_set(
        self, set_code: str, data: ChoiceSetPatchIn
    ) -> ChoiceSetSummaryOut:
        choice_set = await self._require_expected_version(set_code, data.expected_version)
        fields = data.model_fields_set
        if "display_name" in fields:
            if data.display_name is None:
                raise RuleViolationError("선택지 집합 이름을 null로 바꿀 수 없다")
            _, choice_set.display_name = normalize_choice_set(choice_set.code, data.display_name)
        if "description" in fields:
            choice_set.description = normalize_choice_description(data.description)
        if "is_active" in fields:
            if data.is_active is None:
                raise RuleViolationError("활성 상태를 null로 바꿀 수 없다")
            choice_set.is_active = data.is_active
        await self._bump(choice_set)
        return await self.repo.summary_by_id(choice_set.id)

    async def list_options(
        self,
        set_code: str,
        *,
        q: str | None = None,
        version: int | None = None,
        cursor: str | None = None,
        limit: int = 100,
        include_inactive: bool = False,
    ) -> ChoiceOptionPageOut:
        decoded = decode_choice_cursor(cursor) if cursor is not None else None
        if decoded is not None and version is not None and decoded.version != version:
            raise RuleViolationError(
                "커서 version과 요청 version이 다르다", code="invalid_cursor"
            )
        choice_set = await self.repo.get_set_for_update(set_code)
        if choice_set is None:
            raise NotFoundError(f"선택지 집합을 찾을 수 없다: {set_code}")
        expected = decoded.version if decoded is not None else version
        if expected is not None and choice_set.version != expected:
            await self._raise_version_conflict(choice_set, expected)

        items, has_more = await self.repo.list_options(
            choice_set.id,
            q=q,
            include_inactive=include_inactive,
            cursor=decoded,
            limit=limit,
        )
        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_choice_cursor(
                ChoiceCursor(
                    version=choice_set.version,
                    sort_order=last.sort_order,
                    code=last.code,
                )
            )
        return ChoiceOptionPageOut(
            set_code=choice_set.code,
            version=choice_set.version,
            items=[ChoiceOptionOut.model_validate(option) for option in items],
            next_cursor=next_cursor,
        )

    async def create_option(
        self, set_code: str, data: ChoiceOptionCreateIn
    ) -> ChoiceOptionMutationOut:
        choice_set = await self._require_expected_version(set_code, data.expected_version)
        if not choice_set.is_active:
            raise RuleViolationError(
                "비활성 선택지 집합에 새 선택지를 만들 수 없다",
                code="inactive_choice_set",
            )
        code, label = normalize_choice_option(data.code, data.label)
        if await self.repo.get_option(choice_set.id, code) is not None:
            raise _option_exists(set_code, code)
        option = ChoiceOption(
            choice_set_id=choice_set.id,
            code=code,
            label=label,
            sort_order=data.sort_order,
            is_active=data.is_active,
        )
        self.repo.add_option(option)
        choice_set.version += 1
        try:
            await self.repo.flush()
        except IntegrityError as exc:
            if not _is_integrity_violation(
                exc, "uq_choice_option_set_code", "choice_option.choice_set_id, choice_option.code"
            ):
                raise
            await self.repo.session.rollback()
            raise _option_exists(set_code, code) from None
        return ChoiceOptionMutationOut(
            choice_set=await self.repo.summary_by_id(choice_set.id),
            option=ChoiceOptionOut.model_validate(option),
        )

    async def patch_option(
        self,
        set_code: str,
        option_code: str,
        data: ChoiceOptionPatchIn,
    ) -> ChoiceOptionMutationOut:
        choice_set = await self._require_expected_version(set_code, data.expected_version)
        option = await self.repo.get_option(choice_set.id, option_code)
        if option is None:
            raise NotFoundError(f"선택지를 찾을 수 없다: {set_code}/{option_code}")
        fields = data.model_fields_set
        if "label" in fields:
            if data.label is None:
                raise RuleViolationError("선택지 label을 null로 바꿀 수 없다")
            option.label = normalize_choice_label(data.label)
        if "sort_order" in fields:
            if data.sort_order is None:
                raise RuleViolationError("선택지 sort_order를 null로 바꿀 수 없다")
            option.sort_order = data.sort_order
        if "is_active" in fields:
            if data.is_active is None:
                raise RuleViolationError("선택지 활성 상태를 null로 바꿀 수 없다")
            if data.is_active and not option.is_active and not choice_set.is_active:
                raise RuleViolationError(
                    "비활성 선택지 집합의 선택지를 활성화할 수 없다",
                    code="inactive_choice_set",
                )
            option.is_active = data.is_active
        await self._bump(choice_set)
        return ChoiceOptionMutationOut(
            choice_set=await self.repo.summary_by_id(choice_set.id),
            option=ChoiceOptionOut.model_validate(option),
        )

    async def reorder_options(
        self, set_code: str, data: ChoiceOptionOrderIn
    ) -> ChoiceSetSummaryOut:
        choice_set = await self._require_expected_version(set_code, data.expected_version)
        options = await self.repo.all_options(choice_set.id)
        by_code = {option.code: option for option in options}
        validate_complete_order(data.ordered_codes, set(by_code))
        for sort_order, code in enumerate(data.ordered_codes):
            by_code[code].sort_order = sort_order
        await self._bump(choice_set)
        return await self.repo.summary_by_id(choice_set.id)

    async def import_preview(
        self, set_code: str, data: ChoiceImportIn
    ) -> ChoiceImportPreviewOut:
        choice_set = await self._require_expected_version(set_code, data.expected_version)
        plan = await self._import_plan(choice_set, data.csv_text)
        return ChoiceImportPreviewOut(
            set_code=choice_set.code,
            base_version=choice_set.version,
            created_count=plan.created_count,
            updated_count=plan.updated_count,
            error_count=plan.error_count,
            rows=_row_outputs(plan.rows),
        )

    async def import_apply(
        self, set_code: str, data: ChoiceImportIn
    ) -> ChoiceImportApplyOut:
        choice_set = await self._require_expected_version(set_code, data.expected_version)
        existing_rows = await self.repo.all_options(choice_set.id)
        existing = {
            option.code: {
                "label": option.label,
                "sort_order": option.sort_order,
                "is_active": option.is_active,
            }
            for option in existing_rows
        }
        plan = _validated_import_plan(choice_set, data.csv_text, existing)
        if plan.error_count:
            raise RuleViolationError(
                "CSV에 오류 행이 있어 적용하지 않았다",
                code="invalid_choice_import",
            )

        by_code = {option.code: option for option in existing_rows}
        for row in plan.rows:
            assert row.payload is not None
            payload = row.payload
            option = by_code.get(payload.code)
            if option is None:
                option = ChoiceOption(choice_set_id=choice_set.id, code=payload.code)
                self.repo.add_option(option)
                by_code[payload.code] = option
            option.label = payload.label
            option.sort_order = payload.sort_order
            option.is_active = payload.is_active

        await self._bump(choice_set)
        return ChoiceImportApplyOut(
            choice_set=await self.repo.summary_by_id(choice_set.id),
            created_count=plan.created_count,
            updated_count=plan.updated_count,
            rows=_row_outputs(plan.rows),
        )

    async def _import_plan(self, choice_set: ChoiceSet, csv_text: str) -> ChoiceImportPlan:
        return _validated_import_plan(
            choice_set,
            csv_text,
            await self.repo.existing_options(choice_set.id),
        )

    async def _require_expected_version(
        self, set_code: str, expected: int
    ) -> ChoiceSet:
        choice_set = await self.repo.get_set_for_update(set_code)
        if choice_set is None:
            raise NotFoundError(f"선택지 집합을 찾을 수 없다: {set_code}")
        if choice_set.version != expected:
            await self._raise_version_conflict(choice_set, expected)
        return choice_set

    async def _raise_version_conflict(self, choice_set: ChoiceSet, expected: int) -> None:
        summary = await self.repo.summary_by_id(choice_set.id)
        raise ConflictError(
            "선택지 집합이 다른 관리자에 의해 변경되었습니다.",
            code="choice_set_changed",
            details={
                "set_code": choice_set.code,
                "expected_version": expected,
                "actual_version": choice_set.version,
                "choice_set": summary.model_dump(mode="json"),
            },
        )

    async def _bump(self, choice_set: ChoiceSet) -> None:
        choice_set.version += 1
        await self.repo.flush()


def _row_outputs(rows: list[ChoiceImportRow]) -> list[ChoiceImportRowOut]:
    return [
        ChoiceImportRowOut(
            line=row.line,
            code=row.code,
            action=row.action,
            message=row.message,
        )
        for row in rows
    ]


def _set_exists(code: str) -> ConflictError:
    return ConflictError(
        f"이미 존재하는 선택지 집합 code: {code}",
        code="choice_set_exists",
        details={"set_code": code},
    )


def _option_exists(set_code: str, code: str) -> RuleViolationError:
    return RuleViolationError(
        f"이미 존재하는 선택지 code: {set_code}/{code}",
        code="duplicate_choice_option",
    )


def _validated_import_plan(
    choice_set: ChoiceSet,
    csv_text: str,
    existing: dict[str, dict[str, object]],
) -> ChoiceImportPlan:
    from app.domain.choices.csv_import import build_choice_import_plan

    plan = build_choice_import_plan(csv_text, existing=existing)
    if choice_set.is_active:
        return plan

    rows: list[ChoiceImportRow] = []
    for row in plan.rows:
        payload = row.payload
        current = existing.get(row.code)
        invalid_lifecycle = payload is not None and (
            current is None
            or (not bool(current["is_active"]) and payload.is_active)
        )
        if invalid_lifecycle:
            rows.append(
                ChoiceImportRow(
                    line=row.line,
                    code=row.code,
                    action="error",
                    message=(
                        "비활성 선택지 집합에 선택지를 "
                        "추가하거나 활성화할 수 없다"
                    ),
                )
            )
        else:
            rows.append(row)
    return ChoiceImportPlan(rows=rows)


def _is_integrity_violation(
    exc: IntegrityError, constraint_name: str, sqlite_columns: str
) -> bool:
    """Recognize only the intended unique key on PostgreSQL or SQLite."""
    candidates: list[object] = [exc.orig]
    cause = getattr(exc.orig, "__cause__", None)
    if cause is not None:
        candidates.append(cause)
    if any(
        getattr(candidate, "constraint_name", None) == constraint_name
        for candidate in candidates
    ):
        return True
    message = str(exc.orig)
    return (
        f'constraint "{constraint_name}"' in message
        or f"UNIQUE constraint failed: {sqlite_columns}" in message
    )
