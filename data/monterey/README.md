# Monterey vis training data

Numeric-only extract from the Monterey County Dive Reports pack (Facebook group, 2017–2026).

- `labeled-vis.csv` — date, site bucket, vis low/high/mid. No report prose.
- `meteo-daily.json` — Open-Meteo archive join cache.
- `train-metrics.json` — holdout MAE after `scripts/train_monterey_vis.py`.

This is a **beta** model for the demo Monterey page. It is not validated for public accuracy claims. It does not read or write the La Jolla pickle.
