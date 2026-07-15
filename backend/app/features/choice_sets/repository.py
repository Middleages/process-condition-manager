"""ChoiceSet persistence, locking, aggregate summaries, and indexed resolution."""

from collections.abc import Collection
from typing import Any

from sqlalchemy import and_, func, or_, select, tuple_
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.choices.constants import PROFILE_CHOICE_SET_FIELDS
from app.domain.choices.cursor import ChoiceCursor
from app.domain.choices.rules import ResolvedChoice
from app.domain.errors import RuleViolationError
from app.features.choice_sets.schema import ChoiceSetSummaryOut
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter

ChoiceKey = tuple[str, str]


class ChoiceSetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def flush(self) -> None:
        await self.session.flush()

    def add_set(self, choice_set: ChoiceSet) -> None:
        self.session.add(choice_set)

    def add_option(self, option: ChoiceOption) -> None:
        self.session.add(option)

    async def get_set_by_code(self, code: str) -> ChoiceSet | None:
        stmt = select(ChoiceSet).where(ChoiceSet.code == code)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_set_for_update(self, code: str) -> ChoiceSet | None:
        stmt = (
            select(ChoiceSet)
            .where(ChoiceSet.code == code)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_option(self, choice_set_id: int, code: str) -> ChoiceOption | None:
        stmt = select(ChoiceOption).where(
            ChoiceOption.choice_set_id == choice_set_id,
            ChoiceOption.code == code,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def all_options(self, choice_set_id: int) -> list[ChoiceOption]:
        stmt = (
            select(ChoiceOption)
            .where(ChoiceOption.choice_set_id == choice_set_id)
            .order_by(ChoiceOption.sort_order, ChoiceOption.code)
        )
        return list((await self.session.execute(stmt)).scalars())

    async def existing_options(
        self, choice_set_id: int
    ) -> dict[str, dict[str, object]]:
        stmt = select(
            ChoiceOption.code,
            ChoiceOption.label,
            ChoiceOption.sort_order,
            ChoiceOption.is_active,
        ).where(ChoiceOption.choice_set_id == choice_set_id)
        return {
            row.code: {
                "label": row.label,
                "sort_order": row.sort_order,
                "is_active": row.is_active,
            }
            for row in (await self.session.execute(stmt)).all()
        }

    async def list_options(
        self,
        choice_set_id: int,
        *,
        q: str | None,
        include_inactive: bool,
        cursor: ChoiceCursor | None,
        limit: int,
    ) -> tuple[list[ChoiceOption], bool]:
        stmt = select(ChoiceOption).where(ChoiceOption.choice_set_id == choice_set_id)
        if not include_inactive:
            stmt = stmt.where(ChoiceOption.is_active.is_(True))
        if q is not None and (search := q.strip()):
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            stmt = stmt.where(
                or_(
                    ChoiceOption.code.ilike(pattern, escape="\\"),
                    ChoiceOption.label.ilike(pattern, escape="\\"),
                )
            )
        if cursor is not None:
            stmt = stmt.where(
                or_(
                    ChoiceOption.sort_order > cursor.sort_order,
                    and_(
                        ChoiceOption.sort_order == cursor.sort_order,
                        ChoiceOption.code > cursor.code,
                    ),
                )
            )
        stmt = stmt.order_by(ChoiceOption.sort_order, ChoiceOption.code).limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars())
        return rows[:limit], len(rows) > limit

    async def summary_by_id(self, choice_set_id: int) -> ChoiceSetSummaryOut:
        stmt = self._summary_stmt().where(ChoiceSet.id == choice_set_id)
        row = (await self.session.execute(stmt)).one()
        return self._summary_from_row(row)

    async def summary_by_code(self, code: str) -> ChoiceSetSummaryOut | None:
        stmt = self._summary_stmt().where(ChoiceSet.code == code)
        row = (await self.session.execute(stmt)).one_or_none()
        return None if row is None else self._summary_from_row(row)

    async def list_summaries(
        self, *, include_inactive: bool = False
    ) -> list[ChoiceSetSummaryOut]:
        stmt = self._summary_stmt().order_by(ChoiceSet.code)
        if not include_inactive:
            stmt = stmt.where(ChoiceSet.is_active.is_(True))
        rows = (await self.session.execute(stmt)).all()
        return [self._summary_from_row(row) for row in rows]

    async def summaries_by_ids(
        self, set_ids: Collection[int]
    ) -> dict[int, ChoiceSetSummaryOut]:
        ids = set(set_ids)
        if not ids:
            return {}
        stmt = self._summary_stmt().where(ChoiceSet.id.in_(ids))
        rows = (await self.session.execute(stmt)).all()
        return {int(row._mapping["choice_set_id"]): self._summary_from_row(row) for row in rows}

    async def resolve_option(
        self,
        set_code: str,
        option_code: str,
        *,
        include_inactive: bool = True,
        for_write: bool = False,
    ) -> ResolvedChoice | None:
        key = (set_code, option_code)
        return (
            await self.resolve_options(
                [key], include_inactive=include_inactive, for_write=for_write
            )
        ).get(key)

    async def resolve_options(
        self,
        keys: Collection[ChoiceKey],
        *,
        include_inactive: bool = True,
        for_write: bool = False,
        prelocked_set_codes: Collection[str] | None = None,
    ) -> dict[ChoiceKey, ResolvedChoice]:
        unique_keys = set(keys)
        if not unique_keys:
            return {}
        query_keys = unique_keys
        if for_write:
            if prelocked_set_codes is None:
                locked_sets = await self._lock_sets(
                    {set_code for set_code, _ in unique_keys}
                )
                locked_set_codes = set(locked_sets)
            else:
                locked_set_codes = set(prelocked_set_codes)
            query_keys = {
                key for key in unique_keys if key[0] in locked_set_codes
            }
            if not query_keys:
                return {}
        elif prelocked_set_codes is not None:
            raise ValueError("prelocked_set_codes requires for_write=True")

        stmt = (
            select(
                ChoiceSet.code.label("set_code"),
                ChoiceOption.code.label("option_code"),
                ChoiceOption.label,
                ChoiceSet.is_active.label("set_is_active"),
                ChoiceOption.is_active.label("option_is_active"),
            )
            .join(ChoiceOption, ChoiceOption.choice_set_id == ChoiceSet.id)
            .where(tuple_(ChoiceSet.code, ChoiceOption.code).in_(sorted(query_keys)))
        )
        if not include_inactive:
            stmt = stmt.where(
                ChoiceSet.is_active.is_(True), ChoiceOption.is_active.is_(True)
            )
        rows = (await self.session.execute(stmt)).all()
        return {
            (row.set_code, row.option_code): ResolvedChoice(
                set_code=row.set_code,
                option_code=row.option_code,
                label=row.label,
                set_is_active=row.set_is_active,
                option_is_active=row.option_is_active,
            )
            for row in rows
        }

    async def resolve_active_options(
        self,
        keys: Collection[ChoiceKey],
        *,
        for_write: bool = True,
        prelocked_set_codes: Collection[str] | None = None,
    ) -> dict[ChoiceKey, ResolvedChoice]:
        unique_keys = set(keys)
        resolved = await self.resolve_options(
            unique_keys,
            include_inactive=True,
            for_write=for_write,
            prelocked_set_codes=prelocked_set_codes,
        )
        invalid = sorted(
            key
            for key in unique_keys
            if key not in resolved or not resolved[key].effective_is_active
        )
        if invalid:
            identities = ", ".join(f"{set_code}/{option_code}" for set_code, option_code in invalid)
            raise RuleViolationError(
                f"활성 선택지가 아니다: {identities}", code="invalid_active_choice"
            )
        return resolved

    async def lock_sets_for_write(
        self, codes: Collection[str]
    ) -> dict[str, ChoiceSet]:
        """Acquire a caller-defined parent-set union once in global code order."""
        return await self._lock_sets(codes)

    async def lock_active_sets_for_write(
        self, codes: Collection[str]
    ) -> dict[str, ChoiceSet]:
        unique_codes = set(codes)
        if not unique_codes:
            return {}
        locked = await self._lock_sets(unique_codes)
        invalid = sorted(
            code for code in unique_codes if code not in locked or not locked[code].is_active
        )
        if invalid:
            raise RuleViolationError(
                f"활성 선택지 집합이 아니다: {', '.join(invalid)}",
                code="invalid_active_choice_set",
            )
        return locked

    async def _lock_sets(self, codes: Collection[str]) -> dict[str, ChoiceSet]:
        if not codes:
            return {}
        stmt = (
            select(ChoiceSet)
            .where(ChoiceSet.code.in_(set(codes)))
            .order_by(ChoiceSet.code)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        rows = list((await self.session.execute(stmt)).scalars())
        return {row.code: row for row in rows}

    @staticmethod
    def _summary_stmt():
        option_count = (
            select(func.count(ChoiceOption.id))
            .where(ChoiceOption.choice_set_id == ChoiceSet.id)
            .correlate(ChoiceSet)
            .scalar_subquery()
        )
        active_option_count = (
            select(func.count(ChoiceOption.id))
            .where(
                ChoiceOption.choice_set_id == ChoiceSet.id,
                ChoiceOption.is_active.is_(True),
            )
            .correlate(ChoiceSet)
            .scalar_subquery()
        )
        parameter_usage_count = (
            select(func.count(Parameter.id))
            .where(Parameter.choice_set_id == ChoiceSet.id)
            .correlate(ChoiceSet)
            .scalar_subquery()
        )
        return select(
            ChoiceSet.id.label("choice_set_id"),
            ChoiceSet.code,
            ChoiceSet.display_name,
            ChoiceSet.description,
            ChoiceSet.is_active,
            ChoiceSet.version,
            ChoiceSet.created_at,
            ChoiceSet.updated_at,
            option_count.label("option_count"),
            active_option_count.label("active_option_count"),
            parameter_usage_count.label("parameter_usage_count"),
        )

    @staticmethod
    def _summary_from_row(row: Row[Any]) -> ChoiceSetSummaryOut:
        data = row._mapping
        code = str(data["code"])
        profile_field = PROFILE_CHOICE_SET_FIELDS.get(code)
        return ChoiceSetSummaryOut(
            code=code,
            display_name=str(data["display_name"]),
            description=data["description"],
            is_active=bool(data["is_active"]),
            version=int(data["version"]),
            option_count=int(data["option_count"]),
            active_option_count=int(data["active_option_count"]),
            parameter_usage_count=int(data["parameter_usage_count"]),
            profile_usage_fields=[] if profile_field is None else [profile_field],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
        )
