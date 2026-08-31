#!/usr/bin/env python3
"""Train a Monterey-only beta vis model. Does not read or write the La Jolla pickle."""

from __future__ import annotations

import argparse
import csv
import json
import math
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

PACIFIC = ZoneInfo("America/Los_Angeles")
BETA_NOTE = (
    "Monterey beta vis model — development data only. Not validated for public "
    "accuracy claims. Trained on numbered Facebook group reports (Monterey County "
    "Dive Reports, 2017–2026). La Jolla weights were not used."
)
FEATURE_NAMES = [
    "month",
    "doy",
    "swell_ft",
    "swell_period_s",
    "wave_ft",
    "wind_wave_ft",
    "wind_mph",
    "rain_in",
    "rain_3day_in",
    "sst_f",
    "site_bay_shore",
    "site_lobos",
    "site_carmel_shore",
    "site_boat",
    "date_approx",
]
SITE_COLUMNS = {
    "bay_shore": "site_bay_shore",
    "lobos": "site_lobos",
    "carmel_shore": "site_carmel_shore",
    "boat": "site_boat",
}


def _get_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "DivePro-MontereyBeta/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def meters_to_feet(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return value * 3.28084


def celsius_to_f(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return value * 9.0 / 5.0 + 32.0


def mm_to_inches(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return value / 25.4


def kmh_to_mph(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return value * 0.621371


def grade_from_vis(mid: float) -> tuple[str, int, list[int]]:
    if mid >= 35:
        return "A+", 94, [35, 40]
    if mid >= 25:
        return "A", 88, [25, 35]
    if mid >= 15:
        return "B", 75, [15, 24]
    if mid >= 10:
        return "C", 55, [10, 14]
    if mid >= 5:
        return "D", 40, [5, 9]
    return "F", 20, [0, 4]


def load_labeled(path: Path) -> list[dict]:
    rows = []
    with path.open(newline="") as handle:
        for raw in csv.DictReader(handle):
            try:
                mid = float(raw["vis_ft_mid"])
                day = date.fromisoformat(raw["date"])
            except (KeyError, ValueError):
                continue
            if not math.isfinite(mid) or mid < 0 or mid > 80:
                continue
            rows.append(
                {
                    "date": day,
                    "site_bucket": raw.get("site_bucket") or "bay_shore",
                    "date_approx": int(raw.get("date_approx") or 0),
                    "vis_ft_mid": mid,
                    "vis_ft_low": float(raw.get("vis_ft_low") or mid),
                    "vis_ft_high": float(raw.get("vis_ft_high") or mid),
                }
            )
    return rows


def fetch_daily_weather(start: date, end: date, cache: Path) -> dict[str, dict]:
    if cache.exists():
        payload = json.loads(cache.read_text())
        if payload.get("start") == start.isoformat() and payload.get("end") == end.isoformat():
            return {row["date"]: row for row in payload["days"]}

    weather_qs = urllib.parse.urlencode(
        {
            "latitude": 36.6011,
            "longitude": -121.8946,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "daily": "precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
            "timezone": "America/Los_Angeles",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
        }
    )
    marine_qs = urllib.parse.urlencode(
        {
            "latitude": 36.64,
            "longitude": -121.80,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "daily": "wave_height_max,swell_wave_height_max,swell_wave_period_max,wind_wave_height_max,sea_surface_temperature_mean",
            "timezone": "America/Los_Angeles",
        }
    )
    weather = _get_json(f"https://archive-api.open-meteo.com/v1/archive?{weather_qs}")
    try:
        marine = _get_json(f"https://marine-api.open-meteo.com/v1/marine?{marine_qs}")
    except Exception:
        marine = {"daily": {}}

    w_daily = weather.get("daily") or {}
    m_daily = marine.get("daily") or {}
    by_date: dict[str, dict] = {}
    for index, day in enumerate(w_daily.get("time") or []):
        by_date[day] = {
            "date": day,
            "rain_in": _finite(w_daily.get("precipitation_sum"), index),
            "wind_mph": _finite(w_daily.get("wind_speed_10m_max"), index),
        }
    for index, day in enumerate(m_daily.get("time") or []):
        row = by_date.setdefault(day, {"date": day})
        row["wave_ft"] = meters_to_feet(_finite(m_daily.get("wave_height_max"), index))
        row["swell_ft"] = meters_to_feet(_finite(m_daily.get("swell_wave_height_max"), index))
        row["swell_period_s"] = _finite(m_daily.get("swell_wave_period_max"), index)
        row["wind_wave_ft"] = meters_to_feet(_finite(m_daily.get("wind_wave_height_max"), index))
        row["sst_f"] = celsius_to_f(_finite(m_daily.get("sea_surface_temperature_mean"), index))

    dates = sorted(by_date)
    rain_by_date = {key: by_date[key].get("rain_in") or 0.0 for key in dates}
    for index, key in enumerate(dates):
        window = dates[max(0, index - 2) : index + 1]
        by_date[key]["rain_3day_in"] = round(sum(rain_by_date[item] for item in window), 3)

    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"start": start.isoformat(), "end": end.isoformat(), "days": [by_date[k] for k in dates]}))
    return by_date


def fetch_forecast_weather(days: int = 10) -> list[dict]:
    weather_qs = urllib.parse.urlencode(
        {
            "latitude": 36.6011,
            "longitude": -121.8946,
            "forecast_days": days,
            "daily": "precipitation_sum,wind_speed_10m_max",
            "timezone": "America/Los_Angeles",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
        }
    )
    marine_qs = urllib.parse.urlencode(
        {
            "latitude": 36.64,
            "longitude": -121.80,
            "forecast_days": days,
            "daily": "wave_height_max,swell_wave_height_max,swell_wave_period_max,wind_wave_height_max,sea_surface_temperature_mean",
            "timezone": "America/Los_Angeles",
        }
    )
    weather = _get_json(f"https://api.open-meteo.com/v1/forecast?{weather_qs}")
    marine = _get_json(f"https://marine-api.open-meteo.com/v1/marine?{marine_qs}")
    w_daily = weather.get("daily") or {}
    m_daily = marine.get("daily") or {}
    marine_by_date = {day: index for index, day in enumerate(m_daily.get("time") or [])}
    rows = []
    rains = []
    for index, day in enumerate(w_daily.get("time") or []):
        rain = _finite(w_daily.get("precipitation_sum"), index) or 0.0
        rains.append(rain)
        m_index = marine_by_date.get(day)
        rows.append(
            {
                "date": day,
                "rain_in": rain,
                "rain_3day_in": round(sum(rains[max(0, index - 2) : index + 1]), 3),
                "wind_mph": _finite(w_daily.get("wind_speed_10m_max"), index),
                "wave_ft": meters_to_feet(_finite(m_daily.get("wave_height_max"), m_index)) if m_index is not None else None,
                "swell_ft": meters_to_feet(_finite(m_daily.get("swell_wave_height_max"), m_index)) if m_index is not None else None,
                "swell_period_s": _finite(m_daily.get("swell_wave_period_max"), m_index) if m_index is not None else None,
                "wind_wave_ft": meters_to_feet(_finite(m_daily.get("wind_wave_height_max"), m_index)) if m_index is not None else None,
                "sst_f": celsius_to_f(_finite(m_daily.get("sea_surface_temperature_mean"), m_index)) if m_index is not None else None,
            }
        )
    return rows


def _finite(values: list | None, index: int | None) -> float | None:
    if values is None or index is None or index < 0 or index >= len(values):
        return None
    try:
        number = float(values[index])
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def row_features(day: date, meteo: dict, site_bucket: str, date_approx: int = 0) -> list[float]:
    features = {
        "month": float(day.month),
        "doy": float(day.timetuple().tm_yday),
        "swell_ft": meteo.get("swell_ft") if meteo.get("swell_ft") is not None else 3.0,
        "swell_period_s": meteo.get("swell_period_s") if meteo.get("swell_period_s") is not None else 10.0,
        "wave_ft": meteo.get("wave_ft") if meteo.get("wave_ft") is not None else 3.5,
        "wind_wave_ft": meteo.get("wind_wave_ft") if meteo.get("wind_wave_ft") is not None else 1.0,
        "wind_mph": meteo.get("wind_mph") if meteo.get("wind_mph") is not None else 8.0,
        "rain_in": meteo.get("rain_in") or 0.0,
        "rain_3day_in": meteo.get("rain_3day_in") or 0.0,
        "sst_f": meteo.get("sst_f") if meteo.get("sst_f") is not None else 55.0,
        "site_bay_shore": 1.0 if site_bucket == "bay_shore" else 0.0,
        "site_lobos": 1.0 if site_bucket == "lobos" else 0.0,
        "site_carmel_shore": 1.0 if site_bucket == "carmel_shore" else 0.0,
        "site_boat": 1.0 if site_bucket == "boat" else 0.0,
        "date_approx": float(date_approx),
    }
    return [float(features[name]) for name in FEATURE_NAMES]


def build_matrix(labeled: list[dict], meteo_by_date: dict[str, dict]) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    xs = []
    ys = []
    kept = []
    for row in labeled:
        meteo = meteo_by_date.get(row["date"].isoformat())
        if not meteo:
            continue
        xs.append(row_features(row["date"], meteo, row["site_bucket"], row["date_approx"]))
        ys.append(row["vis_ft_mid"])
        kept.append(row)
    return np.asarray(xs, dtype=float), np.asarray(ys, dtype=float), kept


def display_range(mid: float, mae: float) -> list[int]:
    half = max(3.0, min(8.0, mae + 1.0))
    low = max(0, int(round(mid - half)))
    high = max(low + 3, int(round(mid + half)))
    return [low, high]


def report_text(mid: float, low: int, high: int, grade: str, meteo: dict) -> str:
    swell = meteo.get("swell_ft")
    wind = meteo.get("wind_mph")
    rain = meteo.get("rain_3day_in") or 0.0
    bits = [
        f"The Monterey beta model expects {low}-{high} ft of visibility at the inner-bay shore sites (Breakwater / McAbee / Lovers), a {grade} grade.",
    ]
    if swell is not None:
        bits.append(f"Open-Meteo swell is about {swell:.1f} ft.")
    if wind is not None:
        bits.append(f"Wind tops out near {wind:.0f} mph.")
    if rain >= 0.15:
        bits.append("Recent rain is a negative signal for Breakwater via the San Carlos storm drain.")
    bits.append(BETA_NOTE)
    return " ".join(bits)


def predict_day(model, day: date, meteo: dict, mae: float, site_bucket: str = "bay_shore") -> dict:
    mid = float(model.predict([row_features(day, meteo, site_bucket)])[0])
    mid = max(0.0, min(70.0, mid))
    low, high = display_range(mid, mae)
    grade, score, _band = grade_from_vis(mid)
    return {
        "date": day.isoformat(),
        "spot_slug": "monterey",
        "spot_name": "Monterey",
        "location": "Monterey Bay",
        "region": "California",
        "numeric_score_0_100": score,
        "grade": grade,
        "estimated_visibility_range_ft": [low, high],
        "estimated_visibility_mid_ft": round(mid, 1),
        "raw_expected_vis_ft": round(mid, 2),
        "confidence": "low",
        "best_window": "Early morning to late morning before afternoon wind",
        "model_source": "monterey_beta_hgb",
        "is_unavailable": False,
        "is_beta": True,
        "calibration_note": BETA_NOTE,
        "report_text": report_text(mid, low, high, grade, meteo),
        "explanation": BETA_NOTE,
        "features": {
            "date": day.isoformat(),
            "surf_height_max_ft": meteo.get("wave_ft"),
            "swell_wave_height_max_ft": meteo.get("swell_ft"),
            "swell_wave_period_max_s": meteo.get("swell_period_s"),
            "wind_speed_max_mph": meteo.get("wind_mph"),
            "wind_wave_height_max_ft": meteo.get("wind_wave_ft"),
            "water_temp_estimate_f": meteo.get("sst_f"),
            "rain_target_day_forecast_in": meteo.get("rain_in"),
            "rain_prior_3day_in": meteo.get("rain_3day_in"),
        },
    }


def train(root: Path) -> dict:
    labeled = load_labeled(root / "data/monterey/labeled-vis.csv")
    if len(labeled) < 50:
        raise SystemExit(f"Need labeled vis rows, found {len(labeled)}")
    start = min(row["date"] for row in labeled)
    end = max(row["date"] for row in labeled)
    meteo = fetch_daily_weather(start, end, root / "data/monterey/meteo-daily.json")
    x, y, kept = build_matrix(labeled, meteo)
    cutoff = date(2025, 1, 1)
    train_mask = np.array([row["date"] < cutoff for row in kept])
    test_mask = ~train_mask
    if train_mask.sum() < 40 or test_mask.sum() < 10:
        train_mask = np.ones(len(kept), dtype=bool)
        train_mask[-max(20, len(kept) // 5) :] = False
        test_mask = ~train_mask

    model = HistGradientBoostingRegressor(
        max_depth=4,
        learning_rate=0.06,
        max_iter=250,
        min_samples_leaf=12,
        l2_regularization=0.1,
        random_state=42,
    )
    model.fit(x[train_mask], y[train_mask])
    train_mae = float(mean_absolute_error(y[train_mask], model.predict(x[train_mask])))
    test_mae = float(mean_absolute_error(y[test_mask], model.predict(x[test_mask]))) if test_mask.any() else train_mae

    models_dir = root / "models"
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "monterey_vis_beta.joblib"
    joblib.dump(
        {
            "model": model,
            "feature_names": FEATURE_NAMES,
            "train_mae_ft": train_mae,
            "test_mae_ft": test_mae,
            "n_labeled": int(len(kept)),
            "n_train": int(train_mask.sum()),
            "n_test": int(test_mask.sum()),
            "site": "monterey",
        },
        model_path,
    )

    forecast_days = fetch_forecast_weather(10)
    today = datetime.now(PACIFIC).date()
    ten_day = []
    for row in forecast_days:
        day = date.fromisoformat(row["date"])
        ten_day.append(predict_day(model, day, row, test_mae))
    latest = next((item for item in ten_day if item["date"] == today.isoformat()), ten_day[0])

    metrics = {
        "schema_version": "monterey-vis-beta-v1",
        "n_labeled": int(len(kept)),
        "n_train": int(train_mask.sum()),
        "n_test": int(test_mask.sum()),
        "train_mae_ft": round(train_mae, 2),
        "test_mae_ft": round(test_mae, 2),
        "date_start": start.isoformat(),
        "date_end": end.isoformat(),
        "inference_site_bucket": "bay_shore",
        "la_jolla_pickle_touched": False,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (root / "data/monterey/train-metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    payload = {
        "spot": {
            "slug": "monterey",
            "name": "Monterey",
            "menu_name": "Monterey",
            "location": "Monterey Bay",
            "region": "California",
            "lat": 36.6011,
            "lon": -121.8946,
            "timezone": "America/Los_Angeles",
            "tide_label": "NOAA Monterey 9413450",
            "description": "Monterey Bay dive visibility beta — Breakwater / McAbee / Lovers. Not validated for public accuracy claims.",
            "calibration_note": BETA_NOTE,
        },
        "latest": {
            **latest,
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        },
        "ten_day": ten_day,
        "metrics": metrics,
    }
    out = root / "model_outputs/spots/monterey.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(metrics, indent=2))
    print(f"latest {latest['date']} {latest['grade']} {latest['estimated_visibility_range_ft']} ft")
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    train(args.root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
