"""Pure scope predicates shared by relation-rule consumers."""

from app.domain.validation.types import LayerInput, ProjectContext, ValidationScope


def scope_applies_to_project(scope: ValidationScope, context: ProjectContext) -> bool:
    """Return whether all configured project filters accept the context."""
    return (not scope.line_ids or context.line_id in scope.line_ids) and (
        not scope.process_ids or context.process_id in scope.process_ids
    )


def scope_applies_to_layer(scope: ValidationScope, layer: LayerInput) -> bool:
    """Return whether all configured layer filters accept the current layer."""
    return (
        (not scope.layer_ids or layer.layer_id in scope.layer_ids)
        and (not scope.step_seqs or layer.step_seq in scope.step_seqs)
        and (not scope.eqp_types or layer.eqp_type in scope.eqp_types)
        and (not scope.area_names or layer.area_name in scope.area_names)
    )
