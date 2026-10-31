function forecastDateKey(forecast) {
  return String(forecast?.date || forecast?.features?.date || "");
}

function forecastRows(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.tenDay)) return source.tenDay;
  if (Array.isArray(source?.ten_day)) return source.ten_day;
  if (Array.isArray(source?.forecast_10day)) return source.forecast_10day;
  if (Array.isArray(source?.forecasts)) return source.forecasts;
  return [];
}

export function selectForecastForToday(source, publishedLatest, today) {
  const rows = forecastRows(source)
    .filter((forecast) => forecast && forecastDateKey(forecast))
    .sort((a, b) => forecastDateKey(a).localeCompare(forecastDateKey(b)));
  const latest = publishedLatest || source?.latest || (forecastDateKey(source) ? source : null);
  if (forecastDateKey(latest) === today) return latest;
  return rows.find((forecast) => forecastDateKey(forecast) === today) || latest || rows[0] || null;
}
