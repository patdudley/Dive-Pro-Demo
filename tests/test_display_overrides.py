import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("sync_published_data", ROOT / "scripts" / "sync_published_data.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def row(date, grade="C"):
    return {
        "date": date,
        "grade": grade,
        "estimated_visibility_range_ft": [10, 14],
        "generated_at": "2026-11-22T20:31:23+00:00",
        "report_text": f"Dive Pro's beta model estimates 10-14 ft of visibility for {date}, a {grade} grade. Forecast.",
    }


def bundle():
    ten = [row("2026-11-22"), row("2026-11-23"), row("2026-11-24", "B")]
    return {
        sync.FORECAST_FILES[0]: copy.deepcopy(ten[0]),
        sync.FORECAST_FILES[1]: copy.deepcopy(ten),
        sync.FORECAST_FILES[2]: {"spot": {}, "latest": copy.deepcopy(ten[0]), "tenDay": copy.deepcopy(ten)},
    }


class DisplayOverrideTests(unittest.TestCase):
    def test_override_applies_only_to_its_date(self):
        b = bundle()
        sync.apply_display_overrides(b, [{"date": "2026-11-22", "grade": "A", "reason": "owner"}])
        latest, ten, spot = (b[f] for f in sync.FORECAST_FILES)
        self.assertEqual(latest["grade"], "A")
        self.assertEqual(ten[0]["grade"], "A")
        self.assertEqual(spot["latest"]["grade"], "A")
        self.assertEqual(spot["tenDay"][0]["grade"], "A")
        self.assertEqual([r["grade"] for r in ten[1:]], ["C", "B"])
        self.assertEqual(latest["display_override"]["model_grade"], "C")
        self.assertIn("an A display grade", latest["report_text"])
        self.assertEqual(latest["estimated_visibility_range_ft"], [10, 14])
        sync.validate_forecast_set(b)

    def test_no_override_leaves_data_untouched(self):
        b = bundle()
        before = copy.deepcopy(b)
        sync.apply_display_overrides(b, [])
        self.assertEqual(b, before)
        sync.apply_display_overrides(b, [{"date": "2026-12-01", "grade": "A"}])
        self.assertEqual(b, before)

    def test_load_rejects_invalid_grade_and_missing_file(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            self.assertEqual(sync.load_display_overrides(root), [])
            (root / "display_overrides.json").write_text(json.dumps({"overrides": [{"date": "2026-11-22", "grade": "Z"}]}))
            with self.assertRaises(sync.ArtifactValidationError):
                sync.load_display_overrides(root)
            (root / "display_overrides.json").write_text(json.dumps({"overrides": [{"date": "2026-11-22", "grade": "A"}]}))
            self.assertEqual(len(sync.load_display_overrides(root)), 1)

    def test_mirror_applies_override_end_to_end(self):
        with tempfile.TemporaryDirectory() as s, tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(s), pathlib.Path(d)
            b = bundle()
            for rel, data in b.items():
                (src / rel).parent.mkdir(parents=True, exist_ok=True)
                (src / rel).write_text(json.dumps(data))
            (dst / "display_overrides.json").write_text(json.dumps({"overrides": [{"date": "2026-11-22", "grade": "A", "reason": "owner"}]}))
            sync.mirror_forecast_set(src, dst)
            out = json.loads((dst / sync.FORECAST_FILES[0]).read_text())
            self.assertEqual(out["grade"], "A")
            self.assertEqual(json.loads((src / sync.FORECAST_FILES[0]).read_text())["grade"], "C")


if __name__ == "__main__":
    unittest.main()
