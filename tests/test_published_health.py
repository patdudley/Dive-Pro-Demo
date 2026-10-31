import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from check_published_health import health_errors
from sync_published_data import ArtifactValidationError, validate_forecast_row, select_forecast_for_today


class FeedHealthTests(unittest.TestCase):
    def test_stopped_upstream_cannot_pass_with_well_formed_old_data(self):
        now = dt.datetime(2026, 10, 31, 23, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                'model_outputs/latest_forecast.json': {'generated_at': '2026-10-28T23:00:00Z'},
                'camera-snapshots/scripps-pier-latest-attempt.json': {'captured_at_utc': '2026-10-28T23:00:00Z', 'capture_ok': True},
                'model_outputs/forecast_10day.json': [{'date': '2026-10-31', 'grade': 'C'}],
            }
            for path, data in files.items():
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(data))
            self.assertEqual(len(health_errors(root, now)), 2)
            for path, data in files.items():
                if isinstance(data, dict):
                    key = next(iter(data))
                    data[key] = now.isoformat()
                    (root / path).write_text(json.dumps(data))
            self.assertEqual(health_errors(root, now), [])

    def test_rejects_non_finite_visibility(self):
        for value in [float('nan'), float('inf')]:
            with self.assertRaises(ArtifactValidationError):
                validate_forecast_row({'date': '2026-10-31', 'grade': 'C', 'generated_at': '2026-10-31T23:00:00Z', 'estimated_visibility_range_ft': [1, value]}, 'fixture')

    def test_static_page_uses_today_even_if_latest_is_future(self):
        today = {'date': '2026-10-31', 'grade': 'C'}
        self.assertIs(select_forecast_for_today({'date': '2026-11-01'}, [today], dt.date(2026, 10, 31)), today)
