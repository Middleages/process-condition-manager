"""Atomic cell normalization, managed-choice validation, and change audit."""

import uuid
from dataclasses import dataclass

from app.core.errors import DomainValidationError, NotFoundError
from app.domain.decimal_values import normalize_optional_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellOut, CellsPatchIn, CellsPatchOut
from app.features.choice_sets.repository import ChoiceKey, ChoiceSetRepository
from app.models.parameter import Parameter
from app.models.project import CellValue, ChangeEvent, ChangeEventType


@dataclass(frozen=True, slots=True)
class NormalizedCellUpdate:
    condition_id: int
    parameter_code: str
    value: str | None
    old_value: str | None
    old_label: str | None = None
    new_label: str | None = None


def _trim_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _violation(update: NormalizedCellUpdate, reason: str) -> dict[str, str | int]:
    assert update.value is not None
    return {
        "condition_id": update.condition_id,
        "parameter_code": update.parameter_code,
        "value": update.value,
        "reason": reason,
    }


class CellService:
    def __init__(self, repo: CellRepository) -> None:
        self.repo = repo
        self.choice_sets = ChoiceSetRepository(repo.session)

    async def patch_cells(
        self, project_id: int, data: CellsPatchIn, *, actor: str
    ) -> CellsPatchOut:
        batch_id = uuid.uuid4().hex
        if not data.cells:
            return CellsPatchOut(cells=[], batch_id=batch_id)

        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")

        requested_ids = {cell.condition_id for cell in data.cells}
        valid_ids = await self.repo.condition_ids_in_project(project_id, requested_ids)
        invalid_ids = requested_ids - valid_ids
        if invalid_ids:
            raise DomainValidationError(
                "이 프로젝트 소속이 아닌 조건 행이 요청에 있다",
                details={"invalid_condition_ids": sorted(invalid_ids)},
            )

        layer_key_by_condition_id = await self.repo.condition_layer_keys(requested_ids)

        # Existing rows must be known before validating choices: a known inactive code
        # is legal only as a no-op against the simulated current batch value.
        cell_by_key: dict[tuple[int, str], CellValue] = {
            (cell.condition_id, cell.parameter_code): cell
            for cell in await self.repo.load_cell_values(requested_ids)
        }
        params_by_code = await self.repo.active_parameters_by_code(
            {cell.parameter_code for cell in data.cells}
        )
        normalized, violations, choice_keys = self._normalize_candidates(
            data, cell_by_key, params_by_code
        )

        # One indexed resolution acquires every distinct parent lock in sorted order.
        # The router transaction retains those locks through the final commit.
        resolved = await self.choice_sets.resolve_options(
            choice_keys,
            include_inactive=True,
            for_write=True,
        )
        validated: list[NormalizedCellUpdate] = []
        for update in normalized:
            parameter = params_by_code.get(update.parameter_code)
            if parameter is None or parameter.value_type is not ValueType.CHOICE:
                validated.append(update)
                continue
            choice_set = parameter.choice_set
            if choice_set is None:
                if update.value is not None:
                    violations.append(_violation(update, "invalid_choice"))
                validated.append(update)
                continue

            old_choice = (
                resolved.get((choice_set.code, update.old_value))
                if update.old_value is not None
                else None
            )
            new_choice = (
                resolved.get((choice_set.code, update.value))
                if update.value is not None
                else None
            )
            validated_update = NormalizedCellUpdate(
                condition_id=update.condition_id,
                parameter_code=update.parameter_code,
                value=update.value,
                old_value=update.old_value,
                old_label=old_choice.label if old_choice is not None else None,
                new_label=new_choice.label if new_choice is not None else None,
            )
            if update.value is not None:
                is_known_inactive_noop = (
                    update.value == update.old_value and new_choice is not None
                )
                is_active_new_value = (
                    update.value != update.old_value
                    and new_choice is not None
                    and new_choice.effective_is_active
                )
                if not is_known_inactive_noop and not is_active_new_value:
                    violations.append(_violation(validated_update, "invalid_choice"))
            validated.append(validated_update)

        if violations:
            raise DomainValidationError(
                "레지스트리 타입에 맞지 않는 셀 값이 요청에 있다",
                details={"invalid_cells": violations},
            )

        out_cells: list[CellOut] = []
        for update in validated:
            key = (update.condition_id, update.parameter_code)
            existing = cell_by_key.get(key)
            if update.old_value != update.value:
                self._apply_change(cell_by_key, key, existing, update.value)
                payload: dict[str, str | None] = {
                    "batch_id": batch_id,
                    "origin": data.origin,
                }
                parameter = params_by_code.get(update.parameter_code)
                if parameter is not None and parameter.value_type is ValueType.CHOICE:
                    payload["old_label"] = update.old_label
                    payload["new_label"] = update.new_label
                self.repo.add_event(
                    ChangeEvent(
                        project_id=project_id,
                        event_type=ChangeEventType.CELL_UPDATE,
                        actor=actor,
                        condition_id=update.condition_id,
                        parameter_code=update.parameter_code,
                        old_value=update.old_value,
                        new_value=update.value,
                        layer_key=layer_key_by_condition_id[update.condition_id],
                        batch_id=batch_id,
                        origin=data.origin,
                        source_project_id=None,
                        source_layer_key=None,
                        payload=payload,
                    )
                )
            out_cells.append(
                CellOut(
                    condition_id=update.condition_id,
                    parameter_code=update.parameter_code,
                    value=update.value,
                )
            )

        await self.repo.flush()
        return CellsPatchOut(cells=out_cells, batch_id=batch_id)

    def _normalize_candidates(
        self,
        data: CellsPatchIn,
        cell_by_key: dict[tuple[int, str], CellValue],
        params_by_code: dict[str, Parameter],
    ) -> tuple[
        list[NormalizedCellUpdate],
        list[dict[str, str | int]],
        set[ChoiceKey],
    ]:
        simulated = {
            key: cell.value_text
            for key, cell in cell_by_key.items()
        }
        normalized: list[NormalizedCellUpdate] = []
        violations: list[dict[str, str | int]] = []
        choice_keys: set[ChoiceKey] = set()

        for incoming in data.cells:
            key = (incoming.condition_id, incoming.parameter_code)
            old_value = simulated.get(key)
            parameter = params_by_code.get(incoming.parameter_code)
            value = _trim_optional(incoming.value)
            invalid_number = False
            if parameter is not None and parameter.value_type is ValueType.NUMBER:
                try:
                    value = normalize_optional_decimal(incoming.value)
                except RuleViolationError:
                    invalid_number = True

            update = NormalizedCellUpdate(
                condition_id=incoming.condition_id,
                parameter_code=incoming.parameter_code,
                value=value,
                old_value=old_value,
            )
            normalized.append(update)
            simulated[key] = value
            if invalid_number and value is not None:
                violations.append(_violation(update, "invalid_number"))

            if (
                parameter is not None
                and parameter.value_type is ValueType.CHOICE
                and parameter.choice_set is not None
            ):
                if old_value is not None:
                    choice_keys.add((parameter.choice_set.code, old_value))
                if value is not None:
                    choice_keys.add((parameter.choice_set.code, value))
        return normalized, violations, choice_keys

    def _apply_change(
        self,
        cell_by_key: dict[tuple[int, str], CellValue],
        key: tuple[int, str],
        existing: CellValue | None,
        new_value: str | None,
    ) -> None:
        if existing is not None:
            existing.value_text = new_value
            return
        created = CellValue(
            condition_id=key[0],
            parameter_code=key[1],
            value_text=new_value,
        )
        self.repo.add_cell_value(created)
        cell_by_key[key] = created
