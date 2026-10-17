#!/usr/bin/env python3
"""Renderer checks for the published homepage card and La Jolla static summary."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import json
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from sync_published_data import (  # noqa: E402
    describe_forecast,
    render_homepage,
    render_la_jolla,
    validate_forecast_set,
    FORECAST_FILES,
    load_json,
)


INDEX_HTML = """<!doctype html>
<html><head><title>Home</title></head><body>
<!-- DIVEPRO_FORECAST_START -->
<p>placeholder</p>
<!-- DIVEPRO_FORECAST_END -->
</body></html>
"""

LA_JOLLA_HTML = """<!doctype html>
<html><head>
<!-- DIVEPRO_LAJOLLA_JSONLD_START -->
<script type="application/ld+json">{"@type":"WebPage","dateModified":""}</script>
<!-- DIVEPRO_LAJOLLA_JSONLD_END -->
</head><body>
<h1>La Jolla Dive Visibility Today</h1>
<!-- DIVEPRO_LAJOLLA_SUMMARY_START -->
<p id="forecastUpdated">Forecast date loading</p>
<strong id="grade">--</strong>
<strong id="visibility">-- ft</strong>
<!-- DIVEPRO_LAJOLLA_SUMMARY_END -->
</body></html>
"""


def write_forecast(root: Path, latest: dict, ten_day: list) -> None:
    (root / "model_outputs").mkdir(parents=True)
    (root / "model_outputs" / "latest_forecast.json").write_text(json.dumps(latest), encoding="utf-8")
    (root / "model_outputs" / "forecast_10day.json").write_text(json.dumps(ten_day), encoding="utf-8")
    (root / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (root / "la-jolla.html").write_text(LA_JOLLA_HTML, encoding="utf-8")


def row(day: str, grade: str, generated: str, low: int = 10, high: int = 14) -> dict:
    return {
        "date": day,
        "grade": grade,
        "estimated_visibility_range_ft": [low, high],
        "generated_at": generated,
    }


class SyncPublishedDataTests(unittest.TestCase):
    def test_live_forecast_set_still_validates(self):
        bundle = {relative: load_json(ROOT / relative) for relative in FORECAST_FILES}
        generated = validate_forecast_set(bundle)
        self.assertIsNotNone(generated)

    def test_renders_static_la_jolla_summary_and_homepage_card(self):
        now = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            latest = row("2026-10-16", "D", "2026-10-16T21:50:29")
            today_row = row("2026-10-17", "C", "2026-10-16T21:50:29", 8, 12)
            write_forecast(root, latest, [latest, today_row])
            render_homepage(root, today=date(2026, 10, 17), now=now)
            render_la_jolla(root, today=date(2026, 10, 17), now=now)
            home = (root / "index.html").read_text(encoding="utf-8")
            page = (root / "la-jolla.html").read_text(encoding="utf-8")

        self.assertIn('id="homeForecastGrade">C<', home)
        self.assertIn("Forecast date 2026-10-17", home)
        self.assertIn("8–12 ft", home)
        self.assertIn('id="homeLaJollaForecast"', home)
        self.assertNotIn("Forecast date loading", page)
        self.assertNotIn('id="grade">--<', page)
        self.assertIn('id="grade">C<', page)
        self.assertIn('id="visibility">8–12 ft<', page)
        self.assertIn('datetime="2026-10-16T14:50:29-07:00"', page)
        self.assertIn(">Oct 16, 2:50 PM</time>", page)
        self.assertIn('"spatialCoverage"', page)
        self.assertIn('"name": "La Jolla"', page)
        self.assertEqual(page.count('"dateModified": "2026-10-16T14:50:29-07:00"'), 2)
        self.assertIn('"@type": "WebPage"', page)
        self.assertIn('"@type": "Dataset"', page)
        self.assertIn("<h1>La Jolla Dive Visibility Today</h1>", page)

    def test_stale_forecast_hides_grade_and_range(self):
        fields = describe_forecast(
            row("2026-10-01", "A", "2026-10-01T12:00:00"),
            date(2026, 10, 17),
            now=datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc),
        )
        self.assertTrue(fields["stale"])
        self.assertEqual(fields["grade"], "N/A")
        self.assertEqual(fields["range_text"], "Forecast out of date")
        self.assertLess(
            datetime.fromisoformat(fields["updated_iso"]),
            datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc) - timedelta(hours=36),
        )

    def test_missing_markers_raise(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_forecast(root, row("2026-10-17", "C", "2026-10-17T12:00:00"), [])
            (root / "la-jolla.html").write_text("<html></html>", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                render_la_jolla(root, today=date(2026, 10, 17))


if __name__ == "__main__":
    raise SystemExit(unittest.main())
