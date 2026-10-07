#!/usr/bin/env python3
"""Safely mirror generated site data and refresh crawler-visible HTML."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any
from zoneinfo import ZoneInfo


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$")
PACIFIC = ZoneInfo("America/Los_Angeles")
VALID_GRADES = {"A+", "A", "B", "C", "D", "F"}
FORECAST_FILES = (
    pathlib.Path("model_outputs/latest_forecast.json"),
    pathlib.Path("model_outputs/forecast_10day.json"),
    pathlib.Path("model_outputs/spots/la-jolla.json"),
)


class ArtifactValidationError(RuntimeError):
    """Upstream generated data is missing, malformed, or internally inconsistent."""


def pacific_today() -> dt.date:
    return dt.datetime.now(PACIFIC).date()


def freshness_values(value: Any, keys: set[str], key: str = "") -> list[str]:
    values: list[str] = []
    if isinstance(value, dict):
        for child_key, child in value.items():
            values.extend(freshness_values(child, keys, child_key))
    elif isinstance(value, list):
        for child in value:
            values.extend(freshness_values(child, keys, key))
    elif isinstance(value, str) and key in keys and DATE_RE.match(value):
        values.append(value)
    return values


def load_json(path: pathlib.Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_artifact_json(path: pathlib.Path) -> Any:
    try:
        return load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        raise ArtifactValidationError(f"Cannot read upstream artifact {path}: {error}") from error


def newest_value(value: Any) -> str:
    generated = freshness_values(value, {"generated_at", "updated_at"})
    if generated:
        return max(generated)
    dates = freshness_values(value, {"date", "forecast_date", "observation_date"})
    return max(dates, default="")


def parse_generated_at(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def validate_forecast_row(row: Any, label: str) -> None:
    if not isinstance(row, dict):
        raise ArtifactValidationError(f"{label} must be an object")
    try:
        dt.date.fromisoformat(str(row["date"]))
    except (KeyError, TypeError, ValueError) as error:
        raise ArtifactValidationError(f"{label} has an invalid date") from error
    if row.get("grade") not in VALID_GRADES:
        raise ArtifactValidationError(f"{label} has an invalid grade: {row.get('grade')!r}")
    visibility = row.get("estimated_visibility_range_ft")
    if (
        not isinstance(visibility, list)
        or len(visibility) != 2
        or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in visibility)
        or visibility[0] < 0
        or visibility[1] < visibility[0]
    ):
        raise ArtifactValidationError(f"{label} has an invalid visibility range")
    try:
        parse_generated_at(row["generated_at"])
    except (KeyError, TypeError, ValueError) as error:
        raise ArtifactValidationError(f"{label} has an invalid generated_at") from error


def validate_forecast_set(bundle: dict[pathlib.Path, Any]) -> dt.datetime:
    latest = bundle[FORECAST_FILES[0]]
    ten_day = bundle[FORECAST_FILES[1]]
    spot = bundle[FORECAST_FILES[2]]
    validate_forecast_row(latest, "latest_forecast.json")
    if not isinstance(ten_day, list) or not ten_day:
        raise ArtifactValidationError("forecast_10day.json must contain forecast rows")
    for index, row in enumerate(ten_day):
        validate_forecast_row(row, f"forecast_10day.json[{index}]")
    dates = [row["date"] for row in ten_day]
    if len(dates) != len(set(dates)):
        raise ArtifactValidationError("forecast_10day.json contains duplicate dates")
    if not isinstance(spot, dict) or not isinstance(spot.get("tenDay"), list):
        raise ArtifactValidationError("spots/la-jolla.json must contain latest and tenDay")
    validate_forecast_row(spot.get("latest"), "spots/la-jolla.json latest")
    for index, row in enumerate(spot["tenDay"]):
        validate_forecast_row(row, f"spots/la-jolla.json tenDay[{index}]")
    if spot["latest"]["date"] != latest["date"]:
        raise ArtifactValidationError("La Jolla latest forecast dates do not match")
    if [row["date"] for row in spot["tenDay"]] != dates:
        raise ArtifactValidationError("La Jolla 10-day forecast dates do not match")
    generated = [
        parse_generated_at(latest["generated_at"]),
        *(parse_generated_at(row["generated_at"]) for row in ten_day),
        parse_generated_at(spot["latest"]["generated_at"]),
        *(parse_generated_at(row["generated_at"]) for row in spot["tenDay"]),
    ]
    if max(generated) - min(generated) > dt.timedelta(minutes=10):
        raise ArtifactValidationError("Forecast files were not generated as one set")
    return max(generated)


def mirror_forecast_set(source_root: pathlib.Path, destination_root: pathlib.Path) -> list[pathlib.Path]:
    source_bundle = {relative: load_json(source_root / relative) for relative in FORECAST_FILES}
    source_generated = validate_forecast_set(source_bundle)
    destination_bundle = {
        relative: load_json(destination_root / relative)
        for relative in FORECAST_FILES
        if (destination_root / relative).exists()
    }
    if len(destination_bundle) == len(FORECAST_FILES):
        try:
            destination_generated = validate_forecast_set(destination_bundle)
        except RuntimeError:
            destination_generated = None
        if destination_generated is not None and source_generated < destination_generated:
            print(f"Skipping older forecast set: {source_generated.isoformat()} < {destination_generated.isoformat()}")
            return []
    if all(
        (destination_root / relative).exists()
        and (source_root / relative).read_bytes() == (destination_root / relative).read_bytes()
        for relative in FORECAST_FILES
    ):
        return []

    with tempfile.TemporaryDirectory(prefix="divepro-forecast-") as temporary:
        stage = pathlib.Path(temporary)
        for relative in FORECAST_FILES:
            staged = stage / relative
            staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_root / relative, staged)
        validate_forecast_set({relative: load_json(stage / relative) for relative in FORECAST_FILES})
        for relative in FORECAST_FILES:
            destination = destination_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(stage / relative, destination)
            print(f"Updated {relative}")
    return list(FORECAST_FILES)


def mirror_history(source_root: pathlib.Path, destination_root: pathlib.Path) -> list[pathlib.Path]:
    changed: list[pathlib.Path] = []

    source_history = source_root / "forecast_history.json"
    if source_history.exists():
        load_json(source_history)
        destination_history = destination_root / "forecast_history.json"
        source_data = load_json(source_history)
        destination_data = load_json(destination_history) if destination_history.exists() else None
        if destination_data is None or newest_value(source_data) >= newest_value(destination_data):
            if not destination_history.exists() or source_history.read_bytes() != destination_history.read_bytes():
                shutil.copy2(source_history, destination_history)
                changed.append(pathlib.Path("forecast_history.json"))
    return changed


def mirror_wind_data(source_root: pathlib.Path, destination_root: pathlib.Path) -> list[pathlib.Path]:
    relative_root = pathlib.Path("data/wind-cropped")
    source_wind = source_root / relative_root
    manifest_path = source_wind / "wind-san-diego-manifest.json"
    manifest = load_artifact_json(manifest_path)
    if not isinstance(manifest, dict) or not manifest.get("generated_utc") or not isinstance(manifest.get("frames"), list):
        raise ArtifactValidationError("Wind manifest is missing generated_utc or frames")
    try:
        source_generated = parse_generated_at(manifest["generated_utc"])
    except (TypeError, ValueError) as error:
        raise ArtifactValidationError("Wind manifest has an invalid generated_utc") from error
    destination_manifest = destination_root / relative_root / "wind-san-diego-manifest.json"
    if destination_manifest.exists():
        destination_data = load_json(destination_manifest)
        destination_generated = parse_generated_at(destination_data["generated_utc"])
        if source_generated < destination_generated:
            print(f"Skipping older wind data: {source_generated.isoformat()} < {destination_generated.isoformat()}")
            return []
    source_files = sorted(source_wind.glob("*.json"))
    if not source_files:
        raise ArtifactValidationError("No wind data files found")
    for source in source_files:
        load_artifact_json(source)
    for frame in manifest["frames"]:
        frame_path = source_root / str(frame.get("path", ""))
        if not frame_path.is_file() or source_wind not in frame_path.parents:
            raise ArtifactValidationError(f"Wind manifest references a missing file: {frame_path}")
    changed = []
    for source in source_files:
        relative = source.relative_to(source_root)
        destination = destination_root / relative
        if destination.exists() and source.read_bytes() == destination.read_bytes():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        changed.append(relative)
    if changed:
        print(f"Updated {len(changed)} wind data files")
    return changed


def parse_timestamp(forecast: dict[str, Any]) -> dt.datetime | None:
    raw = forecast.get("generated_at") or forecast.get("updated_at")
    if raw:
        try:
            parsed = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc)
        except ValueError:
            pass
    date = forecast.get("date")
    if date:
        try:
            parsed_date = dt.date.fromisoformat(str(date))
            return dt.datetime.combine(parsed_date, dt.time(23, 59), PACIFIC).astimezone(dt.timezone.utc)
        except ValueError:
            pass
    return None


def select_forecast_for_today(
    latest: dict[str, Any],
    ten_day: list[dict[str, Any]],
    today: dt.date,
) -> dict[str, Any]:
    latest_date = dt.date.fromisoformat(str(latest["date"]))
    if latest_date < today:
        exact = next((row for row in ten_day if row.get("date") == today.isoformat()), None)
        if exact is not None:
            return exact
    return latest


def replace_marker(text: str, name: str, replacement: str) -> str:
    pattern = re.compile(
        rf"(?s)([ \t]*)<!-- DIVEPRO_{name}_START -->.*?<!-- DIVEPRO_{name}_END -->"
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"Missing DIVEPRO_{name} markers in index.html")
    indent = match.group(1)
    block = "\n".join(indent + line if line else line for line in replacement.splitlines())
    return text[: match.start()] + block + text[match.end() :]


def render_homepage(root: pathlib.Path) -> None:
    latest = load_json(root / "model_outputs/latest_forecast.json")
    ten_day = load_json(root / "model_outputs/forecast_10day.json")
    if not isinstance(latest, dict) or not isinstance(ten_day, list):
        raise RuntimeError("latest_forecast.json must contain an object")
    today = dt.datetime.now(PACIFIC).date()
    forecast = select_forecast_for_today(latest, ten_day, today)
    generated = parse_timestamp(forecast)
    now = dt.datetime.now(dt.timezone.utc)
    stale = generated is None or now - generated > dt.timedelta(hours=36)
    date = html.escape(str(forecast.get("date") or "unavailable"))
    updated = generated.astimezone(PACIFIC).strftime("%b %-d, %-I:%M %p") if generated else "time unavailable"
    grade = html.escape(str(forecast.get("grade") or "N/A"))
    visibility = forecast.get("estimated_visibility_range_ft")
    range_text = (
        f"{html.escape(str(visibility[0]))}–{html.escape(str(visibility[1]))} ft"
        if isinstance(visibility, list) and len(visibility) >= 2
        else "Unavailable"
    )
    if stale:
        grade = "N/A"
        range_text = "Forecast out of date"
    if stale:
        status = "Forecast out of date"
    elif forecast.get("date") == today.isoformat():
        status = "Today's La Jolla forecast"
    else:
        status = f"La Jolla forecast for {date}"
    forecast_block = f'''<!-- DIVEPRO_FORECAST_START -->
<article class="home-cond-page home-static-forecast{' is-stale' if stale else ''}" id="homeLaJollaForecast" data-slug="la-jolla" aria-label="La Jolla conditions">
  <div class="home-cond-spot">
    <div><h3 id="homeForecastStatus">{status}</h3><p id="homeForecastDate">Forecast date {date} · Updated {html.escape(updated)}</p></div>
    <span class="home-cond-grade" id="homeForecastGrade">{grade}</span>
  </div>
  <div class="home-cond-metrics">
    <div class="home-cond-metric"><span class="home-cond-label">Estimated visibility</span><strong id="homeForecastVisibility">{range_text}</strong></div>
    <a class="home-forecast-link" href="la-jolla.html">Full forecast</a>
  </div>
</article>
<!-- DIVEPRO_FORECAST_END -->'''

    index_path = root / "index.html"
    text = index_path.read_text(encoding="utf-8")
    text = replace_marker(text, "FORECAST", forecast_block)
    index_path.write_text(text, encoding="utf-8")


CANONICAL_PAGES = [
    ("index.html", "/"),
    ("la-jolla.html", "/la-jolla.html"),
    ("monterey.html", "/monterey.html"),
    ("monterey-mcabee.html", "/monterey-mcabee.html"),
    ("monterey-lovers.html", "/monterey-lovers.html"),
    ("monterey-lobos.html", "/monterey-lobos.html"),
    ("monterey-monastery.html", "/monterey-monastery.html"),
    ("catalina-wrigley.html", "/catalina-wrigley.html"),
    ("anacapa-ocean.html", "/anacapa-ocean.html"),
    ("map.html", "/map.html"),
    ("feedback.html", "/feedback.html"),
    ("blog/index.html", "/blog/"),
    ("blog/noaa-el-nino-weekly-24-aug-2026/index.html", "/blog/noaa-el-nino-weekly-24-aug-2026/"),
]


def git_lastmod(root: pathlib.Path, relative: str) -> str:
    today = pacific_today().isoformat()
    try:
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", relative],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if dirty:
            return today
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", relative],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if result:
            return result
    except (OSError, subprocess.CalledProcessError):
        pass
    return today


def write_sitemap(root: pathlib.Path) -> None:
    today = pacific_today().isoformat()
    rows = []
    for relative, url_path in CANONICAL_PAGES:
        if not (root / relative).exists():
            raise RuntimeError(f"Sitemap page does not exist: {relative}")
        lastmod = today if relative in {"index.html", "la-jolla.html"} else git_lastmod(root, relative)
        rows.append(
            "  <url>\n"
            f"    <loc>https://diveproca.com{url_path}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            "  </url>"
        )
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    xml += "\n".join(rows)
    xml += "\n</urlset>\n"
    (root / "sitemap.xml").write_text(xml, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--destination", type=pathlib.Path, default=pathlib.Path.cwd())
    parser.add_argument("--component", choices=("all", "forecast", "wind"), default="all")
    args = parser.parse_args()
    destination = args.destination.resolve()
    source = args.source.resolve()
    try:
        if args.component in {"all", "forecast"}:
            source_bundle = {relative: load_artifact_json(source / relative) for relative in FORECAST_FILES}
            validate_forecast_set(source_bundle)
            source_history = source / "forecast_history.json"
            if source_history.exists():
                load_artifact_json(source_history)
            mirror_forecast_set(source, destination)
            mirror_history(source, destination)
            render_homepage(destination)
            write_sitemap(destination)
        if args.component in {"all", "wind"}:
            mirror_wind_data(source, destination)
    except ArtifactValidationError as error:
        print(f"{args.component} artifact validation failed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
