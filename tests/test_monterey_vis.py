#!/usr/bin/env python3
"""Monterey beta helpers. Does not load the La Jolla pickle."""

from datetime import date
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from train_monterey_vis import (  # noqa: E402
    FEATURE_NAMES,
    display_range,
    grade_from_vis,
    load_labeled,
    row_features,
)


class MontereyVisTests(unittest.TestCase):
    def test_labeled_rows_are_numeric_only(self):
        rows = load_labeled(ROOT / "data/monterey/labeled-vis.csv")
        self.assertGreaterEqual(len(rows), 600)
        self.assertTrue(all("source_quote" not in row for row in rows))
        self.assertTrue(all(0 <= row["vis_ft_mid"] <= 80 for row in rows))

    def test_grade_and_range_shape(self):
        grade, score, band = grade_from_vis(12)
        self.assertEqual(grade, "C")
        self.assertEqual(score, 55)
        self.assertEqual(band, [10, 14])
        self.assertEqual(display_range(12, 6)[0] <= 12 <= display_range(12, 6)[1], True)

    def test_feature_vector_length(self):
        vector = row_features(date(2026, 8, 29), {"swell_ft": 3.2, "wind_mph": 9}, "bay_shore")
        self.assertEqual(len(vector), len(FEATURE_NAMES))
        self.assertEqual(vector[FEATURE_NAMES.index("site_bay_shore")], 1.0)
        self.assertEqual(vector[FEATURE_NAMES.index("site_lobos")], 0.0)


if __name__ == "__main__":
    raise SystemExit(unittest.main())
