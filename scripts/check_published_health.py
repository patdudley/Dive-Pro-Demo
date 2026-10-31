#!/usr/bin/env python3
"""Fail the publishing run when upstream feeds stop producing current data."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo


def timestamp(value):
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed


def health_errors(root: Path, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()
    errors = []
    feeds = (
        ("Forecast", "model_outputs/latest_forecast.json", "generated_at", 36),
        ("Camera capture", "camera-snapshots/scripps-pier-latest-attempt.json", "captured_at_utc", 26),
    )
    for label, path, key, hours in feeds:
        try:
            data = json.loads((root / path).read_text())
            age = now - timestamp(data[key])
            if age > dt.timedelta(hours=hours):
                errors.append(f"{label} is {age.total_seconds() / 3600:.1f} hours old; check upstream GitHub Actions and account usage limits.")
            elif age < -dt.timedelta(minutes=10):
                errors.append(f"{label} timestamp is in the future.")
            if label == "Camera capture" and data.get("capture_ok") is not True:
                errors.append("Latest camera capture failed; the site is retaining the last verified image.")
        except (OSError, ValueError, KeyError, TypeError) as error:
            errors.append(f"{label} is unavailable: {error}")
    try:
        days = json.loads((root / "model_outputs/forecast_10day.json").read_text())
        if not any(row.get("date") == today and row.get("grade") for row in days):
            errors.append(f"No visibility forecast covers today ({today}).")
    except (OSError, ValueError, AttributeError, TypeError):
        errors.append("The ten-day forecast cannot be read.")
    return errors


if __name__ == "__main__":
    failures = health_errors(Path(__file__).resolve().parents[1])
    for failure in failures:
        print(f"::error::{failure}")
    if not failures:
        print("Forecast and camera feeds are current.")
    raise SystemExit(bool(failures))
