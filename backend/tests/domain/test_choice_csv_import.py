from app.domain.choices.csv_import import build_choice_import_plan

CSV = """code,label,sort_order,is_active
FOUNDRY,Foundry,10,true
SPECIAL,Special customer,20,false
"""


def test_choice_csv_preview_classifies_create_and_update() -> None:
    plan = build_choice_import_plan(
        CSV,
        existing={"FOUNDRY": {"label": "Old", "sort_order": 0, "is_active": True}},
    )
    assert [(row.line, row.code, row.action) for row in plan.rows] == [
        (2, "FOUNDRY", "update"),
        (3, "SPECIAL", "create"),
    ]
    assert (plan.created_count, plan.updated_count, plan.error_count) == (1, 1, 0)


def test_choice_csv_duplicate_and_bad_bool_are_row_errors() -> None:
    plan = build_choice_import_plan(
        "code,label,sort_order,is_active\nA,Alpha,1,true\nA,Again,2,yes\n",
        existing={},
    )
    assert plan.error_count == 1
    assert plan.rows[1].action == "error"
