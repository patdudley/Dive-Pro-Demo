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


def test_report_text_rewritten_for_observation_and_forecast():
    base = "Dive Pro's beta model estimates 10-14 ft of visibility for {d}, a C grade. This is a forecast, not a measured visibility report. Rest."
    r = row("2026-11-22")
    r["report_text"] = base.format(d="2026-11-22")
    sync.apply_display_overrides_to_row(r, OVERRIDES)
    assert "diver observation reported 20-30 ft" in r["report_text"]
    assert "10-14 ft" in r["report_text"]
    assert "not a Dive Pro measurement" in r["report_text"]
    assert r["report_text"].endswith("Rest.")
    r2 = row("2026-11-23")
    r2["report_text"] = base.format(d="2026-11-23")
    f = [{"date": "2026-11-23", "grade": "A", "visibility_range_ft": [20, 30], "basis": "owner_directed_forecast", "reason": "r"}]
    sync.apply_display_overrides_to_row(r2, f)
    assert "displayed forecast for 2026-11-23 is 20-30 ft" in r2["report_text"]
    assert "This is a forecast" in r2["report_text"]
