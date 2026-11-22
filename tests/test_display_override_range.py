import importlib.util
import pathlib

SPEC = importlib.util.spec_from_file_location(
    "sync_published_data",
    pathlib.Path(__file__).resolve().parents[1] / "scripts" / "sync_published_data.py",
)
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)

OVERRIDES = [
    {"date": "2026-11-22", "grade": "A", "visibility_range_ft": [20, 30], "basis": "owner_observed", "reason": "r"}
]


def row(date, grade="C", rng=None):
    return {"date": date, "grade": grade, "estimated_visibility_range_ft": rng or [10, 14]}


def test_range_and_grade_applied_on_exact_date():
    r = row("2026-11-22")
    sync.apply_display_overrides_to_row(r, OVERRIDES)
    assert r["grade"] == "A"
    assert r["estimated_visibility_range_ft"] == [20, 30]
    assert r["display_override"]["model_visibility_range_ft"] == [10, 14]
    assert r["display_override"]["basis"] == "owner_observed"


def test_other_dates_untouched():
    r = row("2026-11-25")
    sync.apply_display_overrides_to_row(r, OVERRIDES)
    assert r["grade"] == "C"
    assert r["estimated_visibility_range_ft"] == [10, 14]
    assert "display_override" not in r


def test_grade_only_entry_keeps_range():
    r = row("2026-11-22")
    sync.apply_display_overrides_to_row(r, [{"date": "2026-11-22", "grade": "A", "reason": "r"}])
    assert r["grade"] == "A"
    assert r["estimated_visibility_range_ft"] == [10, 14]
